import contextlib
import datetime as dt
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import boto3
from moto import mock_aws
import sqlite_backup as b
import staging_refresh as r

SECRET = 'pasted-secret-transcript'


def make_db(path, marker):
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(sqlite3.connect(path)) as db:
        db.execute('PRAGMA journal_mode=WAL')
        for table in b.TABLES:
            extra = ', chat_session_id TEXT' if table == 'change_sets' else ''
            db.execute(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY, value TEXT{extra})')
            db.executemany(f'INSERT INTO {table} (value) VALUES (?)', [(marker,), ('two',)])
        db.execute("UPDATE change_sets SET chat_session_id = 'session-1' WHERE id = 1")
        db.execute('CREATE TABLE admin_chat_sessions (id TEXT PRIMARY KEY, actor_id TEXT)')
        db.execute('CREATE TABLE admin_chat_messages (id TEXT PRIMARY KEY, session_id TEXT, body TEXT)')
        db.execute('CREATE TABLE comment_blocks (source_hash TEXT PRIMARY KEY)')
        db.execute('CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, source_hash TEXT NOT NULL)')
        db.execute("INSERT INTO admin_chat_sessions VALUES ('session-1', 'owner@example.com')")
        db.execute("INSERT INTO admin_chat_messages VALUES ('message-1', 'session-1', ?)", (SECRET * 40,))
        db.execute("INSERT INTO comment_blocks VALUES ('visitor-hash-blocked')")
        db.execute("INSERT INTO comments (body, source_hash) VALUES ('hello', 'visitor-hash-1')")
        db.execute('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)')
        db.execute("INSERT INTO d1_migrations VALUES (1, '0001_initial.sql', '2026-11-08')")
        db.commit()


def first_event(path):
    with contextlib.closing(sqlite3.connect(path)) as db:
        return db.execute('SELECT value FROM events WHERE id = 1').fetchone()[0]


class StagingRefreshTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.production = self.root / 'production' / 'site.sqlite'
        make_db(self.production, 'production-event')
        self.live = self.root / 'staging' / 'site.sqlite'
        make_db(self.live, 'staging-event')
        self.identity = self.root / 'staging-age-key.txt'
        result = subprocess.run(['age-keygen', '-o', str(self.identity)], capture_output=True, check=True, text=True)
        (self.root / 'REVISION').write_text('a' * 40)
        release = self.root / 'releases' / ('b' * 40)
        release.mkdir(parents=True)
        (release / 'REVISION').write_text('b' * 40)
        (self.root / 'current').symlink_to(release)
        self.env = self.root / 'web.env'
        self.env.write_text('SITE_URL=https://staging.example\nAPP_ENV=staging\n')
        self.migrate_log = self.root / 'migrate.log'
        self.migrate_bin = self.root / 'fake-migrate'
        self.set_migrate_exit(0)
        common = {'bucket': 'staging-refresh-test', 'prefix': 'sqlite/staging-refresh/'}
        self.export_c = {**common, 'database': str(self.production), 'release_sha_file': str(self.root / 'REVISION'),
                         'state_dir': str(self.root / 'export-state'), 'age_recipient': result.stderr.strip().split()[-1]}
        self.apply_c = {**common, 'environment': 'staging', 'database': str(self.live), 'env_file': str(self.env),
                        'work_dir': str(self.root / 'apply-work'), 'identity_file': str(self.identity),
                        'release_link': str(self.root / 'current'), 'migrate_bin': str(self.migrate_bin),
                        'owner': 'nobody', 'status_file': str(self.root / 'staging' / 'refresh-status.json')}
        self.mock = mock_aws()
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.s3 = boto3.client('s3', region_name='us-east-1', aws_access_key_id='test', aws_secret_access_key='test')
        self.s3.create_bucket(Bucket=common['bucket'])
        self.calls = []
        for name, replacement in (('systemctl', lambda *a: self.calls.append(a)), ('is_active', lambda unit: True)):
            patcher = patch.object(r, name, replacement)
            patcher.start()
            self.addCleanup(patcher.stop)

    def set_migrate_exit(self, code):
        self.migrate_bin.write_text(f'#!/bin/sh\necho "$@" >> "{self.migrate_log}"\nexit {code}\n')
        self.migrate_bin.chmod(0o700)

    def export(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return r.export(self.export_c, self.s3)

    def apply(self, healthy=True, **kwargs):
        with patch.object(r, 'healthy', lambda c: healthy), contextlib.redirect_stdout(io.StringIO()):
            return r.apply(self.apply_c, self.s3, **kwargs)

    def assert_staging_untouched(self):
        self.assertEqual(first_event(self.live), 'staging-event')
        self.assertFalse((self.live.parent / 'refresh-incoming').exists())

    def test_export_removes_production_only_data_and_leaves_production_alone(self):
        manifest = self.export()
        self.assertEqual((manifest['kind'], manifest['scrubbed'], manifest['app_commit_sha']), ('staging-refresh', True, 'a' * 40))
        with tempfile.TemporaryDirectory() as temp:
            restored, details = b.fetch_payload(self.s3, self.export_c['bucket'], manifest, self.identity, Path(temp))
            self.assertEqual(details['table_counts']['events'], 2)
            with contextlib.closing(sqlite3.connect(restored)) as db:
                count = lambda sql: db.execute(sql).fetchone()[0]
                self.assertEqual(count('SELECT count(*) FROM admin_chat_messages'), 0)
                self.assertEqual(count('SELECT count(*) FROM admin_chat_sessions'), 0)
                self.assertEqual(count('SELECT count(*) FROM comment_blocks'), 0)
                self.assertEqual(count('SELECT count(*) FROM change_sets WHERE chat_session_id IS NOT NULL'), 0)
                self.assertEqual(db.execute('SELECT body, source_hash FROM comments').fetchall(), [('hello', 'scrubbed')])
                self.assertEqual(count('SELECT count(*) FROM change_sets'), 2)
            # Deleted rows must not survive in freed pages of the file that leaves production.
            raw = restored.read_bytes()
            for needle in (SECRET, 'visitor-hash', 'owner@example.com'):
                self.assertNotIn(needle.encode(), raw)
        with contextlib.closing(sqlite3.connect(self.production)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM admin_chat_messages').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT source_hash FROM comments').fetchone()[0], 'visitor-hash-1')
        self.assertFalse(list(Path(self.export_c['state_dir']).glob('refresh-*/')))

    def test_export_stops_at_a_table_nobody_classified(self):
        with contextlib.closing(sqlite3.connect(self.production)) as db:
            db.execute('CREATE TABLE visitor_emails (email TEXT)')
            db.commit()
        with self.assertRaisesRegex(r.RefreshError, 'visitor_emails'):
            self.export()
        self.assertNotIn('Contents', self.s3.list_objects_v2(Bucket=self.export_c['bucket']))

    def test_every_table_in_the_repository_migrations_is_classified(self):
        names = set()
        for path in sorted((Path(__file__).resolve().parents[2] / 'migrations').glob('*.sql')):
            names.update(re.findall(r'CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)', path.read_text(), re.I))
        self.assertGreater(len(names), 30)
        self.assertEqual(sorted(names - r.KEPT - set(r.EMPTIED)), [])

    def test_apply_swaps_in_the_newest_export_and_keeps_the_previous_database(self):
        self.export()
        with contextlib.closing(sqlite3.connect(self.production)) as db:
            db.execute("UPDATE events SET value = 'newer-production-event' WHERE id = 1")
            db.commit()
        newest = self.export()
        status = self.apply()
        self.assertEqual(first_event(self.live), 'newer-production-event')
        self.assertEqual(stat.S_IMODE(self.live.stat().st_mode), 0o600)
        self.assertEqual((status['object_key'], status['production_commit_sha'], status['staging_commit_sha']),
                         (newest['object_key'], 'a' * 40, 'b' * 40))
        self.assertEqual(json.loads(Path(self.apply_c['status_file']).read_text())['table_counts']['events'], 2)
        saved = list((self.live.parent / 'refresh-previous').glob('*.sqlite'))
        self.assertEqual([first_event(path) for path in saved], ['staging-event'])
        self.assertFalse((self.live.parent / 'refresh-incoming').exists())
        self.assertFalse(Path(str(self.live) + '-wal').exists())
        # Migrated as a candidate first, then: pause sync, stop web, start web, resume sync.
        self.assertRegex(self.migrate_log.read_text(), r'--mode apply --db \S+refresh-incoming/site\.sqlite')
        self.assertEqual(self.calls, [('stop', 'fripside-sync.timer'), ('stop', 'fripside-web.service'),
                                      ('start', 'fripside-web.service'), ('start', 'fripside-sync.timer')])

    def test_apply_restores_the_previous_database_when_the_site_does_not_come_back(self):
        self.export()
        with self.assertRaisesRegex(r.RefreshError, 'healthy'):
            self.apply(healthy=False)
        self.assert_staging_untouched()
        self.assertEqual(self.calls[-3:], [('stop', 'fripside-web.service'), ('start', 'fripside-web.service'),
                                           ('start', 'fripside-sync.timer')])
        self.assertFalse(Path(self.apply_c['status_file']).exists())

    def test_apply_refuses_anything_but_staging_before_touching_the_host(self):
        self.export()
        for label, change in (('config', lambda: self.apply_c.pop('environment')),
                              ('production env', lambda: self.env.write_text('APP_ENV=production\n')),
                              ('ambiguous env', lambda: self.env.write_text('APP_ENV=staging\nAPP_ENV=production\n')),
                              ('missing env', lambda: self.env.unlink())):
            with self.subTest(label):
                change()
                with self.assertRaises(r.RefreshError):
                    self.apply()
                self.assert_staging_untouched()
                self.assertEqual(self.calls, [])
                self.assertFalse(self.migrate_log.exists())
                self.apply_c['environment'] = 'staging'
                self.env.write_text('APP_ENV=staging\n')

    def test_apply_leaves_staging_running_when_the_snapshot_cannot_be_migrated(self):
        self.export()
        for code, message in ((4, 'non-additive'), (1, 'could not be migrated')):
            with self.subTest(code):
                self.set_migrate_exit(code)
                with self.assertRaisesRegex(r.RefreshError, message):
                    self.apply()
                self.assert_staging_untouched()
                self.assertEqual(self.calls, [])

    def test_apply_rejects_stale_foreign_and_unscrubbed_exports(self):
        with self.assertRaisesRegex(r.RefreshError, 'No finished export'):
            self.apply()
        manifest = self.export()
        key = manifest['object_key'] + '.json'

        def republish(**changes):
            self.s3.put_object(Bucket=self.apply_c['bucket'], Key=key, Body=json.dumps({**manifest, **changes}).encode())

        republish(created_at=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=40)).isoformat())
        with self.assertRaisesRegex(r.RefreshError, 'too old'):
            self.apply()
        for changes in ({'kind': None}, {'scrubbed': False}):
            republish(**changes)
            with self.assertRaisesRegex(r.RefreshError, 'scrubbed staging export'):
                self.apply()
        with self.assertRaisesRegex(r.RefreshError, 'configured prefix'):
            self.apply(manifest_key='sqlite/production/20260101T000000.000000Z-x.sqlite.gz.age.json')
        republish(sha256='0' * 64)
        with self.assertRaises(ValueError):
            self.apply()
        # A payload that claims to be scrubbed but is not: staging checks for itself.
        with patch.object(r, 'scrub', lambda path: None):
            self.export()
        with self.assertRaisesRegex(r.RefreshError, 'production-only data'):
            self.apply()
        self.assert_staging_untouched()
        self.assertEqual(self.calls, [])

    def test_apply_does_not_overlap_a_deployment(self):
        self.export()
        self.apply_c['deploy_lock'] = str(self.root / 'deploy.lock')
        with b.lock(self.apply_c['deploy_lock']):
            with self.assertRaisesRegex(r.RefreshError, 'deployment'):
                self.apply()
        self.assert_staging_untouched()
        self.apply()
        self.assertEqual(first_event(self.live), 'production-event')

    def test_failures_report_the_reason_without_sdk_text_or_configuration(self):
        config = self.root / 'apply.json'
        config.write_text(json.dumps({**self.apply_c, 'endpoint': 'https://' + 'a' * 32 + '.r2.cloudflarestorage.com',
                                      'access_key_id': 'key-id-value', 'secret_access_key': 'secret-key-value',
                                      'environment': 'production'}))
        config.chmod(0o600)
        self.identity.chmod(0o600)
        errors = io.StringIO()
        with patch.object(b, 's3_client', lambda c: self.s3), contextlib.redirect_stderr(errors):
            self.assertEqual(r.main(['--config', str(config), 'apply']), 1)
        self.assertEqual(errors.getvalue().strip(), 'staging refresh apply failed: This configuration is not marked as staging')
        config.chmod(0o644)
        with contextlib.redirect_stderr(errors):
            self.assertEqual(r.main(['--config', str(config), 'apply']), 1)
        self.assertNotIn('secret-key-value', errors.getvalue())
        self.assert_staging_untouched()


if __name__ == '__main__':
    unittest.main()
