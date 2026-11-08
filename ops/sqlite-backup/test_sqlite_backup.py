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


if __name__ == '__main__':
    unittest.main()
