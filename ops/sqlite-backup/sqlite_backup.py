#!/usr/bin/env python3
"""Host scheduled SQLite snapshots. Never restore over a running database."""
import argparse
import contextlib
import datetime as dt
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

TABLES = ('events', 'songs', 'releases', 'setlists', 'change_sets', 'audit_logs')
UTC = dt.timezone.utc


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read_config(path):
    path = Path(path)
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise ValueError('Configuration must have mode 0600 or stricter')
    c = json.loads(path.read_text())
    if not re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', c['endpoint']):
        raise ValueError('Expected the account R2 S3 HTTPS endpoint')
    if not c['bucket'] or not c.get('notify_url', '').startswith('https://'):
        raise ValueError('Bucket and HTTPS notification webhook are required')
    prefix = c.get('prefix', 'sqlite/production/').strip('/') + '/'
    if '..' in prefix or prefix.startswith('/'):
        raise ValueError('Invalid object prefix')
    c['prefix'] = prefix
    return c


def s3_client(c):
    import boto3
    from botocore.config import Config
    # Explicit keys prevent falling back to an instance role or unrelated AWS profile.
    return boto3.client('s3', endpoint_url=c['endpoint'], region_name='auto',
                        aws_access_key_id=c['access_key_id'],
                        aws_secret_access_key=c['secret_access_key'],
                        config=Config(connect_timeout=10, read_timeout=60,
                                      retries={'max_attempts': 3, 'mode': 'standard'},
                                      request_checksum_calculation='when_required',
                                      response_checksum_validation='when_required'))


def notify(c, message):
    req = urllib.request.Request(c['notify_url'],
        data=json.dumps({'title': 'fripsi.de database backup', 'body': message}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=15) as response:
        if response.status >= 300:
            raise RuntimeError('Notification rejected')


def inspect_db(path):
    with contextlib.closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('SQLite integrity_check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise ValueError('SQLite foreign_key_check failed')
        counts = {t: db.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in TABLES}
        migrations = [dict(zip(('id', 'name', 'applied_at'), r)) for r in
                      db.execute('SELECT id, name, applied_at FROM d1_migrations ORDER BY id')]
        if not migrations:
            raise ValueError('Migration history is empty')
    return {'table_counts': counts, 'migrations': migrations}


def snapshot(source, dest, timeout=300):
    # Online Backup API includes committed WAL pages while writers stay online.
    deadline = time.monotonic() + timeout
    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError('Online snapshot exceeded time limit')
    with contextlib.closing(sqlite3.connect(Path(source).resolve().as_uri() + '?mode=ro', uri=True)) as src:
        with contextlib.closing(sqlite3.connect(dest)) as out:
            src.backup(out, pages=256, progress=progress, sleep=0.05)
            out.execute('PRAGMA journal_mode=DELETE')
    return inspect_db(dest)


@contextlib.contextmanager
def lock(path):
    with open(path, 'a') as f:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def atomic_json(path, data):
    temp = path.with_suffix('.new')
    with open(temp, 'w') as f:
        json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)


def backup(c, client):
    state = Path(c['state_dir'])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with lock(state / 'backup.lock'):
        release = Path(c['release_sha_file']).read_text().strip()
        if not re.fullmatch('[0-9a-f]{40}', release):
            raise ValueError('Expected a complete application commit SHA')
        now = dt.datetime.now(UTC)
        run = now.strftime('%Y%m%dT%H%M%S.%fZ') + '-' + uuid.uuid4().hex
        key = c['prefix'] + run + '.sqlite.gz.age'
        with tempfile.TemporaryDirectory(prefix='snapshot-', dir=state) as temp:
            temp = Path(temp)
            db = temp / 'snapshot.sqlite'
            details = snapshot(c['database'], db)
            if Path(c['release_sha_file']).read_text().strip() != release:
                raise ValueError('Application release changed during snapshot; retry after deployment')
            raw_sha = digest(db)
            zipped = temp / 'snapshot.sqlite.gz'
            with open(db, 'rb') as src, gzip.open(zipped, 'wb', compresslevel=6) as dst:
                shutil.copyfileobj(src, dst)
            encrypted = temp / 'snapshot.sqlite.gz.age'
            subprocess.run(['age', '--recipient', c['age_recipient'], '--output', str(encrypted), str(zipped)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
            manifest = {'format': 1, 'created_at': now.isoformat(), 'app_commit_sha': release,
                        'object_key': key, 'sqlite_bytes': db.stat().st_size,
                        'gzip_bytes': zipped.stat().st_size, 'encrypted_bytes': encrypted.stat().st_size,
                        'sha256': digest(encrypted), 'sqlite_sha256': raw_sha, **details}
            with open(encrypted, 'rb') as body:
                client.put_object(Bucket=c['bucket'], Key=key, Body=body,
                                  ContentType='application/octet-stream', StorageClass='STANDARD',
                                  IfNoneMatch='*', Metadata={'sha256': manifest['sha256']})
            head = client.head_object(Bucket=c['bucket'], Key=key)
            if head['ContentLength'] != manifest['encrypted_bytes'] or head['Metadata'].get('sha256') != manifest['sha256']:
                raise ValueError('Uploaded object metadata does not match')
            # Publish manifest last. A payload without a manifest is an incomplete run.
            client.put_object(Bucket=c['bucket'], Key=key + '.json',
                              Body=json.dumps(manifest, sort_keys=True).encode(),
                              ContentType='application/json', StorageClass='STANDARD', IfNoneMatch='*')
            atomic_json(state / 'last-success.json', manifest)
            print(json.dumps({'status': 'uploaded', 'key': key, 'sha256': manifest['sha256']}), flush=True)
            # TemporaryDirectory cleanup happens only after remote commit + local success record.
            return manifest


def manifests(c, client):
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=c['bucket']):
        for obj in page.get('Contents', []):
            yield obj


def monitor(c, client):
    total = 0
    latest = None
    for obj in manifests(c, client):
        total += obj['Size']
        if obj['Key'].startswith(c['prefix']) and obj['Key'].endswith('.sqlite.gz.age.json'):
            if latest is None or obj['Key'] > latest:
                latest = obj['Key']
    if latest is None:
        raise ValueError('No committed remote backup exists')
    manifest = json.loads(client.get_object(Bucket=c['bucket'], Key=latest)['Body'].read())
    created = dt.datetime.fromisoformat(manifest['created_at'])
    age = (dt.datetime.now(UTC) - created).total_seconds()
    if age < -300 or age > 86400:
        raise ValueError('No successful backup in the past 24 hours')
    head = client.head_object(Bucket=c['bucket'], Key=manifest['object_key'])
    if head['ContentLength'] != manifest['encrypted_bytes'] or head['Metadata'].get('sha256') != manifest['sha256']:
        raise ValueError('Latest backup payload missing or invalid')
    if total > c.get('capacity_warn_bytes', 1024**3):
        raise ValueError('Backup prefix capacity threshold exceeded')
    print(json.dumps({'status': 'healthy', 'bytes': total, 'age_seconds': round(age)}))


def restore(c, client, key, output, identity, isolation_root):
    # No default backup; require an explicit manifest and a new isolation directory.
    if not key.startswith(c['prefix']) or not key.endswith('.sqlite.gz.age.json') or '..' in key:
        raise ValueError('Specify an exact manifest key in the configured prefix')
    root = Path(isolation_root).resolve()
    out = Path(output).resolve()
    live = Path(c['database']).resolve()
    if root == live.parent or root in live.parents or live.parent in root.parents:
        raise ValueError('Isolation directory must be outside the live database tree')
    if out.parent != root or out.exists() or root.exists():
        raise ValueError('Use a new isolation directory and output database')
    manifest = json.loads(client.get_object(Bucket=c['bucket'], Key=key)['Body'].read())
    if manifest['object_key'] + '.json' != key:
        raise ValueError('Manifest payload key mismatch')
    root.mkdir(mode=0o700, parents=True)
    try:
        with tempfile.TemporaryDirectory(dir=root) as temp:
            temp = Path(temp)
            encrypted = temp / 'payload.age'
            with open(encrypted, 'wb') as f:
                client.download_fileobj(c['bucket'], manifest['object_key'], f)
            if encrypted.stat().st_size != manifest['encrypted_bytes'] or digest(encrypted) != manifest['sha256']:
                raise ValueError('Downloaded backup SHA-256 or size mismatch')
            zipped = temp / 'payload.gz'
            subprocess.run(['age', '--decrypt', '--identity', str(identity), '--output', str(zipped), str(encrypted)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
            restored = temp / 'restored.sqlite'
            with gzip.open(zipped, 'rb') as src, open(restored, 'xb') as dst:
                # Bound expansion using the recorded snapshot size.
                remaining = manifest['sqlite_bytes']
                while chunk := src.read(min(1024 * 1024, remaining + 1)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError('Decompressed backup exceeds manifest size')
                    dst.write(chunk)
            if remaining or digest(restored) != manifest['sqlite_sha256']:
                raise ValueError('Restored SQLite SHA-256 or size mismatch')
            details = inspect_db(restored)
            if any(details[k] != manifest[k] for k in ('table_counts', 'migrations')):
                raise ValueError('Restored database does not match manifest')
            # Link is exclusive; even a concurrent creator cannot be overwritten.
            os.link(restored, out)
        atomic_json(root / 'restore-manifest.json', manifest)
        print(json.dumps({'status': 'isolated-restore-verified', 'database': str(out), **details}))
    except Exception:
        # Do not leave an unvalidated database behind after a failed restore.
        if not out.exists():
            shutil.rmtree(root)
        raise


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('backup')
    sub.add_parser('monitor')
    r = sub.add_parser('restore')
    r.add_argument('--manifest', required=True)
    r.add_argument('--output', required=True)
    r.add_argument('--identity', required=True)
    r.add_argument('--isolation-root', required=True)
    args = parser.parse_args()
    c = None
    try:
        c = read_config(args.config)
        client = s3_client(c)
        if args.command == 'backup':
            backup(c, client)
        elif args.command == 'monitor':
            monitor(c, client)
        else:
            restore(c, client, args.manifest, args.output, args.identity, args.isolation_root)
        return 0
    except Exception as error:
        # Never print SDK exceptions, config values, webhook URLs, or subprocess stderr.
        message = f'{args.command} failed ({type(error).__name__}); inspect host configuration and service status'
        print(message, file=sys.stderr)
        if c is not None and args.command != 'restore':
            try:
                notify(c, message)
            except Exception:
                print('Backup notification delivery failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
