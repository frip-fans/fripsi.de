#!/usr/bin/env python3
"""Refresh the staging database from a scrubbed production snapshot.

`export` runs on the production host: it snapshots the live database, removes what must not leave
production, and uploads the result encrypted to the staging host's own age key.
`apply` runs on the staging host: it downloads the newest export, verifies it, migrates it to the
schema of the staging release and swaps it in. It refuses to run anywhere but staging.
"""
import argparse
import contextlib
import datetime as dt
import gzip
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

import sqlite_backup as base

UTC = dt.timezone.utc
KIND = 'staging-refresh'
SUFFIX = '.sqlite.gz.age'
SCRUBBED_SOURCE = 'scrubbed'
# Emptied before a snapshot leaves production: chat transcripts with whatever maintainers pasted into
# them, and the identifiers that tie comments and blocks to a visitor.
EMPTIED = ('admin_chat_messages', 'admin_chat_sessions', 'comment_blocks')
# Every table has to be classified. An export stops at a table it does not know, so a new migration
# cannot start shipping data to staging without someone deciding whether it may.
KEPT = frozenset('''
    d1_migrations
    events event_sources event_venues event_channels change_sets audit_logs operation_receipts import_jobs
    administrative_areas administrative_area_codes administrative_area_aliases
    venues venue_aliases venue_external_ids location_migration_backlog tours
    songs song_aliases song_versions song_version_relations releases release_aliases release_tracks
    release_external_ids release_track_external_ids setlists setlist_entries catalog_sources
    quiz_puzzles quiz_answers app_settings comments comment_notification_state
    official_sync_runs official_sync_lease official_sync_changes official_sync_sources
    official_sync_run_sources official_sync_reviews official_sync_source_reviews official_sync_budgets
    official_sync_usage official_sync_reservations official_sync_evaluations
    official_sync_notification_state official_sync_notifications
'''.split())


class RefreshError(Exception):
    """A failure whose message is safe to print: it never carries SDK text, keys or URLs."""


def connect(path):
    return contextlib.closing(sqlite3.connect(path, isolation_level=None))


def table_names(db):
    # SQLite's own bookkeeping (sqlite_sequence, sqlite_stat1) holds no application data.
    return {name for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            if not name.startswith('sqlite_')}


def scrub(path):
    """Remove what must stay on production, then rebuild the file so freed pages hold no remnants."""
    with connect(path) as db:
        unknown = sorted(table_names(db) - KEPT - set(EMPTIED))
        if unknown:
            raise RefreshError('Unclassified tables, decide whether they may reach staging: ' + ', '.join(unknown))
        present = table_names(db)
        db.execute('BEGIN IMMEDIATE')
        try:
            if 'change_sets' in present and has_column(db, 'change_sets', 'chat_session_id'):
                db.execute('UPDATE change_sets SET chat_session_id = NULL')
            for table in EMPTIED:
                if table in present:
                    db.execute(f'DELETE FROM "{table}"')
            if 'comments' in present:
                db.execute('UPDATE comments SET source_hash = ?', (SCRUBBED_SOURCE,))
            db.execute('COMMIT')
        except BaseException:
            db.execute('ROLLBACK')
            raise
        db.execute('VACUUM')
    assert_scrubbed(path)


def has_column(db, table, column):
    return any(row[1] == column for row in db.execute(f'PRAGMA table_info("{table}")'))


def assert_scrubbed(path):
    """Checked on both hosts: production before uploading, staging before trusting a download."""
    with contextlib.closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        present = table_names(db)
        checks = [(f'SELECT count(*) FROM "{table}"', table) for table in EMPTIED if table in present]
        if 'comments' in present:
            checks.append((f"SELECT count(*) FROM comments WHERE source_hash <> '{SCRUBBED_SOURCE}'", 'comments.source_hash'))
        if 'change_sets' in present and has_column(db, 'change_sets', 'chat_session_id'):
            checks.append(('SELECT count(*) FROM change_sets WHERE chat_session_id IS NOT NULL', 'change_sets.chat_session_id'))
        for sql, label in checks:
            if db.execute(sql).fetchone()[0]:
                raise RefreshError(f'Snapshot still holds production-only data in {label}')


def export(c, client):
    state = Path(c['state_dir'])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with base.lock(state / 'refresh-export.lock'):
        release = Path(c['release_sha_file']).read_text().strip()
        if not re.fullmatch('[0-9a-f]{40}', release):
            raise RefreshError('Expected a complete application commit SHA')
        now = dt.datetime.now(UTC)
        key = c['prefix'] + now.strftime('%Y%m%dT%H%M%S.%fZ') + '-' + uuid.uuid4().hex + SUFFIX
        with tempfile.TemporaryDirectory(prefix='refresh-', dir=state) as temp:
            temp = Path(temp)
            db = temp / 'snapshot.sqlite'
            base.snapshot(c['database'], db)
            scrub(db)
            details = base.inspect_db(db)
            zipped = temp / 'snapshot.sqlite.gz'
            with open(db, 'rb') as src, gzip.open(zipped, 'wb', compresslevel=6) as dst:
                shutil.copyfileobj(src, dst)
            encrypted = temp / ('snapshot' + SUFFIX)
            subprocess.run(['age', '--recipient', c['age_recipient'], '--output', str(encrypted), str(zipped)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
            manifest = {'format': 1, 'kind': KIND, 'scrubbed': True, 'created_at': now.isoformat(),
                        'app_commit_sha': release, 'object_key': key, 'sqlite_bytes': db.stat().st_size,
                        'gzip_bytes': zipped.stat().st_size, 'encrypted_bytes': encrypted.stat().st_size,
                        'sha256': base.digest(encrypted), 'sqlite_sha256': base.digest(db), **details}
            with open(encrypted, 'rb') as body:
                client.put_object(Bucket=c['bucket'], Key=key, Body=body, ContentType='application/octet-stream',
                                  StorageClass='STANDARD', IfNoneMatch='*', Metadata={'sha256': manifest['sha256']})
            head = client.head_object(Bucket=c['bucket'], Key=key)
            if head['ContentLength'] != manifest['encrypted_bytes'] or head['Metadata'].get('sha256') != manifest['sha256']:
                raise RefreshError('Uploaded object metadata does not match')
            # The manifest goes last: a payload without one is an unfinished export and is never applied.
            client.put_object(Bucket=c['bucket'], Key=key + '.json', Body=json.dumps(manifest, sort_keys=True).encode(),
                              ContentType='application/json', StorageClass='STANDARD', IfNoneMatch='*')
        print(json.dumps({'status': 'exported', 'key': key, 'table_counts': details['table_counts']}), flush=True)
        return manifest


def latest_manifest_key(c, client):
    latest = None
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=c['bucket'], Prefix=c['prefix']):
        for obj in page.get('Contents', []):
            # Keys start with a UTC timestamp, so the greatest key is the newest export.
            if obj['Key'].endswith(SUFFIX + '.json') and (latest is None or obj['Key'] > latest):
                latest = obj['Key']
    if latest is None:
        raise RefreshError('No finished export exists; run the export on production first')
    return latest


def require_staging(c):
    """The one guard that keeps this off production: the config and the web environment must both say staging."""
    if c.get('environment') != 'staging':
        raise RefreshError('This configuration is not marked as staging')
    try:
        lines = Path(c['env_file']).read_text().splitlines()
    except OSError:
        raise RefreshError('Cannot read the web environment file to confirm this host is staging') from None
    values = [line.split('=', 1)[1].strip().strip('"\'') for line in lines if line.strip().startswith('APP_ENV=')]
    if values != ['staging']:
        raise RefreshError('The web environment is not APP_ENV=staging; refusing to replace this database')


def own(c, path):
    """Hand a file to the database owner. A no-op unless running as root, which keeps tests unprivileged."""
    if os.geteuid() == 0:
        shutil.chown(path, user=c['owner'], group=c.get('group') or pwd.getpwnam(c['owner']).pw_gid)


def migrate(c, candidate):
    """Bring the candidate to the schema of the release staging runs, before anything live is touched."""
    release = Path(c['release_link']).resolve()
    sha = (release / 'REVISION').read_text().strip()
    command = [c.get('migrate_bin', '/usr/local/bin/fripside-migrate'), '--release', str(release), '--sha', sha,
               '--mode', 'apply', '--db', str(candidate)]
    identity = {}
    if os.geteuid() == 0:
        account = pwd.getpwnam(c['owner'])
        identity = {'user': account.pw_uid, 'group': account.pw_gid, 'extra_groups': []}
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600, **identity)
    if result.returncode == 4:
        raise RefreshError('Staging has a non-additive migration pending; an administrator must apply it by hand')
    if result.returncode != 0:
        raise RefreshError('The snapshot could not be migrated to the staging release')
    return sha


def systemctl(*arguments):
    subprocess.run(['/usr/bin/systemctl', *arguments], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


def is_active(unit):
    return subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', unit], timeout=30).returncode == 0


def healthy(c, attempts=30):
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(c.get('health_url', 'http://127.0.0.1:3000/healthz'), timeout=2) as response:
                if json.load(response).get('ok') is True:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def place(c, source, live):
    for suffix in ('', '-wal', '-shm'):
        Path(str(live) + suffix).unlink(missing_ok=True)
    os.replace(source, live)
    os.chmod(live, 0o600)
    own(c, live)


def swap(c, candidate):
    """Stop the site, keep the database it had, put the candidate in its place and prove the site reads it."""
    live = Path(c['database'])
    keep = live.parent / 'refresh-previous'
    keep.mkdir(mode=0o700, exist_ok=True)
    saved = keep / (dt.datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ') + '.sqlite')
    web = c.get('web_service', 'fripside-web.service')
    paused = [unit for unit in c.get('pause_units', ['fripside-sync.timer']) if is_active(unit)]
    for unit in paused:
        systemctl('stop', unit)
    try:
        systemctl('stop', web)
        try:
            # Nothing live has changed yet; if this fails the site simply comes back as it was.
            base.snapshot(live, saved)
        except BaseException:
            saved.unlink(missing_ok=True)
            systemctl('start', web)
            raise
        try:
            place(c, candidate, live)
            systemctl('start', web)
            if not healthy(c):
                raise RefreshError('The site did not come back healthy on the refreshed database')
        except BaseException:
            systemctl('stop', web)
            restored = live.parent / 'refresh-rollback.sqlite'
            shutil.copyfile(saved, restored)
            place(c, restored, live)
            systemctl('start', web)
            raise
    finally:
        for unit in paused:
            systemctl('start', unit)
    for stale in sorted(keep.glob('*.sqlite'))[:-int(c.get('keep_previous', 2))]:
        stale.unlink()
    return saved


def apply(c, client, manifest_key=None):
    require_staging(c)
    work = Path(c['work_dir'])
    work.mkdir(mode=0o700, parents=True, exist_ok=True)
    with contextlib.ExitStack() as stack:
        try:
            stack.enter_context(base.lock(work / 'refresh.lock'))
            if c.get('deploy_lock'):
                # A deployment migrates and restarts the same database; the two must not interleave.
                stack.enter_context(base.lock(c['deploy_lock']))
        except BlockingIOError:
            raise RefreshError('Another refresh or a deployment is running; try again afterwards') from None
        key = manifest_key or latest_manifest_key(c, client)
        if not key.startswith(c['prefix']) or not key.endswith(SUFFIX + '.json') or '..' in key:
            raise RefreshError('The manifest is not an export in the configured prefix')
        manifest = json.loads(client.get_object(Bucket=c['bucket'], Key=key)['Body'].read())
        if manifest.get('kind') != KIND or manifest.get('scrubbed') is not True or manifest['object_key'] + '.json' != key:
            raise RefreshError('The manifest does not describe a scrubbed staging export')
        age_hours = (dt.datetime.now(UTC) - dt.datetime.fromisoformat(manifest['created_at'])).total_seconds() / 3600
        if age_hours < -0.1 or age_hours > float(c.get('max_age_hours', 36)):
            raise RefreshError('The newest export is too old; run the export on production first')
        live = Path(c['database'])
        # Beside the live database, so the final swap is a rename on one filesystem.
        incoming = live.parent / 'refresh-incoming'
        shutil.rmtree(incoming, ignore_errors=True)
        incoming.mkdir(mode=0o700)
        own(c, incoming)
        try:
            candidate = incoming / 'site.sqlite'
            with tempfile.TemporaryDirectory(prefix='download-', dir=work) as temp:
                restored, _ = base.fetch_payload(client, c['bucket'], manifest, c['identity_file'], Path(temp))
                assert_scrubbed(restored)
                shutil.copyfile(restored, candidate)
            os.chmod(candidate, 0o600)
            own(c, candidate)
            release = migrate(c, candidate)
            details = base.inspect_db(candidate)
            saved = swap(c, candidate)
        finally:
            shutil.rmtree(incoming, ignore_errors=True)
        status = {'format': 1, 'refreshed_at': dt.datetime.now(UTC).isoformat(), 'snapshot_created_at': manifest['created_at'],
                  'production_commit_sha': manifest['app_commit_sha'], 'staging_commit_sha': release,
                  'object_key': manifest['object_key'], 'table_counts': details['table_counts'],
                  'latest_migration': details['migrations'][-1]['name']}
        if c.get('status_file'):
            base.atomic_json(Path(c['status_file']), status, mode=0o644)
        print(json.dumps({'status': 'refreshed', **status, 'previous_database': str(saved)}), flush=True)
        return status


def read_apply_config(path):
    path = Path(path)
    if path.stat().st_mode & 0o077:
        raise RefreshError('Configuration must have mode 0600 or stricter')
    c = json.loads(path.read_text())
    if not re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', c['endpoint']):
        raise RefreshError('Expected the account R2 S3 HTTPS endpoint')
    c['prefix'] = c['prefix'].strip('/') + '/'
    for name in ('database', 'work_dir', 'identity_file', 'env_file', 'release_link'):
        if not Path(c[name]).is_absolute():
            raise RefreshError(f'{name} must be an absolute path')
    if Path(c['identity_file']).stat().st_mode & 0o077:
        raise RefreshError('The staging identity must have mode 0600 or stricter')
    return c


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('export')
    a = sub.add_parser('apply')
    a.add_argument('--manifest', help='Exact manifest key; the newest finished export when omitted')
    args = parser.parse_args(argv)
    c = None
    try:
        if args.command == 'export':
            c = base.read_config(args.config)
            export(c, base.s3_client(c))
        else:
            c = read_apply_config(args.config)
            apply(c, base.s3_client(c), args.manifest)
        return 0
    except Exception as error:
        # Only our own messages are printed; SDK errors, config values and subprocess output never are.
        reason = str(error) if isinstance(error, RefreshError) else type(error).__name__
        message = f'staging refresh {args.command} failed: {reason}'
        print(message, file=sys.stderr)
        if c is not None and c.get('notify_url'):
            try:
                base.notify(c, message)
            except Exception:
                print('Refresh notification delivery failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
