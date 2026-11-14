import contextlib
import datetime as dt
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import boto3
from botocore.exceptions import ClientError
from moto import mock_aws
import sqlite_backup as b


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'live' / 'site.sqlite'
        self.source.parent.mkdir()
        with sqlite3.connect(self.source) as db:
            db.execute('PRAGMA journal_mode=WAL')
            for table in b.TABLES:
                db.execute(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY, value TEXT)')
                db.executemany(f'INSERT INTO {table} (value) VALUES (?)', [('one',), ('two',)])
            db.execute('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)')
            db.execute("INSERT INTO d1_migrations VALUES (1, '0001_initial.sql', '2026-11-08')")
        self.identity = self.root / 'offline-age-key.txt'
        result = subprocess.run(['age-keygen', '-o', str(self.identity)], capture_output=True, check=True, text=True)
        recipient = result.stderr.strip().split()[-1]
        (self.root / 'REVISION').write_text('a' * 40)
        self.c = {'database': str(self.source), 'release_sha_file': str(self.root / 'REVISION'),
                  'state_dir': str(self.root / 'state'), 'prefix': 'sqlite/production/',
                  'bucket': 'private-backup-test', 'age_recipient': recipient,
                  'notify_url': 'https://notify.invalid/secret'}
        self.mock = mock_aws()
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.s3 = boto3.client('s3', region_name='us-east-1', aws_access_key_id='test', aws_secret_access_key='test')
        self.s3.create_bucket(Bucket=self.c['bucket'])

    def run_backup(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return b.backup(self.c, self.s3)

    def test_online_wal_write_upload_download_decrypt_restore(self):
        stop = threading.Event()
        started = threading.Event()
        errors = []
        def writer():
            try:
                with sqlite3.connect(self.source, timeout=5) as db:
                    i = 0
                    while not stop.is_set():
                        i += 1
                        db.execute('INSERT INTO events(value) VALUES (?)', (f'live-{i}',))
                        db.commit()
                        started.set()
                        time.sleep(0.001)
            except Exception as e:
                errors.append(e)
        thread = threading.Thread(target=writer)
        thread.start()
        try:
            self.assertTrue(started.wait(5))
            manifest = self.run_backup()
            self.assertTrue(thread.is_alive())
            self.assertGreater(manifest['table_counts']['events'], 2)
        finally:
            stop.set()
            thread.join(5)
        self.assertFalse(errors)
        isolated = self.root / 'isolated'
        output = isolated / 'site.sqlite'
        with contextlib.redirect_stdout(io.StringIO()):
            b.restore(self.c, self.s3, manifest['object_key']+'.json', output, self.identity, isolated)
        self.assertEqual(b.inspect_db(output)['table_counts'], manifest['table_counts'])
        with sqlite3.connect(output) as app:
            # Same SELECT shape used by public application reads, on restored DB only.
            self.assertEqual(app.execute('SELECT count(*) FROM songs').fetchone()[0], 2)
        self.assertTrue((Path(self.c['state_dir']) / 'last-success.json').exists())
        self.assertFalse(list(Path(self.c['state_dir']).glob('snapshot-*')))

    def test_unique_snapshots_and_no_overwrite(self):
        first = self.run_backup()
        second = self.run_backup()
        self.assertNotEqual(first['object_key'], second['object_key'])
        objects = self.s3.list_objects_v2(Bucket=self.c['bucket'])['Contents']
        self.assertEqual(len(objects), 4)
        with self.assertRaises(ClientError):
            self.s3.put_object(Bucket=self.c['bucket'], Key=first['object_key'], Body=b'replace', IfNoneMatch='*')

    def test_lock_rejects_overlapping_manual_run(self):
        state = Path(self.c['state_dir'])
        state.mkdir()
        with b.lock(state / 'backup.lock'):
            with self.assertRaises(BlockingIOError):
                self.run_backup()
        self.assertNotIn('Contents', self.s3.list_objects_v2(Bucket=self.c['bucket']))

    def test_failed_upload_keeps_previous_success(self):
        first = self.run_backup()
        state = Path(self.c['state_dir']) / 'last-success.json'
        for code in ('ServiceUnavailable', 'InvalidAccessKeyId', 'ExpiredToken'):
            with self.subTest(code=code):
                error = ClientError({'Error': {'Code': code, 'Message': 'secret-token-value'}}, 'PutObject')
                with patch.object(self.s3, 'put_object', side_effect=error):
                    with self.assertRaises(ClientError):
                        self.run_backup()
                self.assertEqual(json.loads(state.read_text())['object_key'], first['object_key'])

    def test_manifest_failure_not_reported_success(self):
        first = self.run_backup()
        original = self.s3.put_object
        def put(**kwargs):
            if kwargs['Key'].endswith('.json'):
                raise RuntimeError('upload rejected')
            return original(**kwargs)
        with patch.object(self.s3, 'put_object', side_effect=put):
            with self.assertRaises(RuntimeError):
                self.run_backup()
        self.assertEqual(json.loads((Path(self.c['state_dir']) / 'last-success.json').read_text())['object_key'], first['object_key'])

    def test_freshness_and_capacity_monitor(self):
        with self.assertRaisesRegex(ValueError, 'No committed'):
            b.monitor(self.c, self.s3)
        manifest = self.run_backup()
        with contextlib.redirect_stdout(io.StringIO()):
            b.monitor(self.c, self.s3)
        self.c['capacity_warn_bytes'] = 1
        with self.assertRaisesRegex(ValueError, 'capacity'):
            b.monitor(self.c, self.s3)
        self.c['capacity_warn_bytes'] = 1024**3
        manifest['created_at'] = (dt.datetime.now(b.UTC) - dt.timedelta(hours=25)).isoformat()
        self.s3.put_object(Bucket=self.c['bucket'], Key=manifest['object_key']+'.json', Body=json.dumps(manifest).encode())
        with self.assertRaisesRegex(ValueError, '24 hours'):
            b.monitor(self.c, self.s3)

    def test_restore_refuses_live_directory_and_existing_target(self):
        manifest = self.run_backup()
        with self.assertRaisesRegex(ValueError, 'live database tree'):
            b.restore(self.c, self.s3, manifest['object_key']+'.json', self.source, self.identity, self.source.parent)
        with self.assertRaisesRegex(ValueError, 'exact manifest'):
            b.restore(self.c, self.s3, 'latest', self.root/'isolated'/'site.sqlite', self.identity, self.root/'isolated')

    def test_restore_rejects_tampered_payload(self):
        manifest = self.run_backup()
        self.s3.put_object(Bucket=self.c['bucket'], Key=manifest['object_key'], Body=b'tampered')
        isolated = self.root / 'isolated'
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            b.restore(self.c, self.s3, manifest['object_key']+'.json', isolated/'site.sqlite', self.identity, isolated)
        self.assertFalse(isolated.exists())

    def test_cli_notifies_failure_without_leaking_sdk_secrets(self):
        config = self.root/'config.json'
        config.write_text('{}')
        with patch.object(b, 'read_config', return_value=self.c), patch.object(b, 's3_client', return_value=self.s3), \
             patch.object(b, 'backup', side_effect=RuntimeError('secret-token-value')), patch.object(b, 'notify') as notify, \
             patch.object(b.sys, 'argv', ['sqlite_backup.py','--config',str(config),'backup']), \
             contextlib.redirect_stderr(io.StringIO()) as logs:
            self.assertEqual(b.main(), 1)
        notify.assert_called_once()
        self.assertNotIn('secret-token-value', logs.getvalue())

    def test_config_rejects_open_permissions(self):
        path = self.root/'config.json'
        path.write_text('{}')
        path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, '0600'):
            b.read_config(path)

    def test_release_change_during_snapshot_is_rejected(self):
        original = b.snapshot
        def changed(*args):
            result = original(*args)
            (self.root / 'REVISION').write_text('b' * 40)
            return result
        with patch.object(b, 'snapshot', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'release changed'):
                self.run_backup()
        self.assertNotIn('Contents', self.s3.list_objects_v2(Bucket=self.c['bucket']))

    def test_restore_rejects_wrong_table_counts(self):
        manifest = self.run_backup()
        manifest['table_counts']['events'] += 1
        self.s3.put_object(Bucket=self.c['bucket'], Key=manifest['object_key']+'.json', Body=json.dumps(manifest).encode())
        isolated = self.root / 'isolated'
        with self.assertRaisesRegex(ValueError, 'does not match manifest'):
            b.restore(self.c, self.s3, manifest['object_key']+'.json', isolated/'site.sqlite', self.identity, isolated)
        self.assertFalse(isolated.exists())



class StatusFileTest(unittest.TestCase):
    MANIFEST = {'created_at': '2026-11-14T20:00:03+00:00', 'app_commit_sha': 'a' * 40,
                'object_key': 'sqlite/production/run.sqlite.gz.age', 'sqlite_bytes': 300, 'gzip_bytes': 200,
                'encrypted_bytes': 250, 'sha256': 'f' * 64, 'sqlite_sha256': 'e' * 64,
                'table_counts': {'events': 2},
                'migrations': [{'id': 1, 'name': '0001_initial.sql', 'applied_at': '2026-11-08'},
                               {'id': 2, 'name': '0002_more.sql', 'applied_at': '2026-11-09'}]}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'backup-status.json'
        self.c = {'status_file': str(self.path), 'notify_url': 'https://notify.invalid/secret'}

    def read(self):
        return json.loads(self.path.read_text())

    def test_success_is_readable_by_the_web_user_and_omits_hashes(self):
        os.umask(0o077)
        b.write_status(self.c, manifest=self.MANIFEST)
        status = self.read()
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o644)
        self.assertTrue(status['last_attempt_ok'])
        self.assertIsNone(status['last_error'])
        self.assertEqual(status['failures_since_success'], 0)
        self.assertEqual(status['last_success']['object_key'], self.MANIFEST['object_key'])
        self.assertEqual(status['last_success']['latest_migration'], '0002_more.sql')
        self.assertEqual(status['last_success']['migration_count'], 2)
        self.assertNotIn('f' * 64, self.path.read_text())

    def test_failures_keep_the_previous_success_and_count_up(self):
        b.write_status(self.c, manifest=self.MANIFEST)
        b.write_status(self.c, error='ClientError')
        b.write_status(self.c, error='TimeoutError')
        status = self.read()
        self.assertFalse(status['last_attempt_ok'])
        self.assertEqual(status['last_error'], 'TimeoutError')
        self.assertEqual(status['failures_since_success'], 2)
        self.assertEqual(status['last_success']['created_at'], self.MANIFEST['created_at'])
        b.write_status(self.c, manifest=self.MANIFEST)
        self.assertEqual(self.read()['failures_since_success'], 0)

    def test_failure_before_any_success_and_after_a_corrupt_file(self):
        self.path.write_text('not json')
        b.write_status(self.c, error='ValueError')
        status = self.read()
        self.assertIsNone(status['last_success'])
        self.assertEqual(status['failures_since_success'], 1)

    def test_unset_or_unwritable_status_file_never_raises(self):
        b.write_status({}, manifest=self.MANIFEST)
        self.assertFalse(self.path.exists())
        with contextlib.redirect_stderr(io.StringIO()) as logs:
            b.write_status({'status_file': str(self.path / 'missing-dir' / 'status.json')}, manifest=self.MANIFEST)
        self.assertIn('status file update failed', logs.getvalue())

    def test_cli_records_success_and_sanitised_failure(self):
        config = Path(self.temp.name) / 'config.json'
        config.write_text('{}')
        argv = ['sqlite_backup.py', '--config', str(config), 'backup']
        with patch.object(b, 'read_config', return_value=self.c), patch.object(b, 's3_client'), \
             patch.object(b, 'backup', return_value=self.MANIFEST), patch.object(b.sys, 'argv', argv):
            self.assertEqual(b.main(), 0)
        self.assertTrue(self.read()['last_attempt_ok'])
        with patch.object(b, 'read_config', return_value=self.c), patch.object(b, 's3_client'), \
             patch.object(b, 'backup', side_effect=RuntimeError('secret-token-value')), patch.object(b, 'notify'), \
             patch.object(b.sys, 'argv', argv), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(b.main(), 1)
        self.assertEqual(self.read()['last_error'], 'RuntimeError')
        self.assertNotIn('secret-token-value', self.path.read_text())

    def test_monitor_failure_does_not_touch_backup_status(self):
        config = Path(self.temp.name) / 'config.json'
        config.write_text('{}')
        with patch.object(b, 'read_config', return_value=self.c), patch.object(b, 's3_client'), \
             patch.object(b, 'monitor', side_effect=ValueError('stale')), patch.object(b, 'notify'), \
             patch.object(b.sys, 'argv', ['sqlite_backup.py', '--config', str(config), 'monitor']), \
             contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(b.main(), 1)
        self.assertFalse(self.path.exists())


if __name__ == '__main__':
    unittest.main()
