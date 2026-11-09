#!/usr/bin/env python3
"""Apply packaged schema migrations to the host SQLite database before a release is activated.

Installed root-owned as /usr/local/bin/fripside-migrate and run as frip-app (the database owner)
through a single sudoers rule for frip-deploy. Only additive statements are applied automatically;
anything else stops the deployment and is left to an administrator over SSH.
"""
import argparse
import contextlib
import datetime as dt
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys

DEFAULT_DB = '/var/lib/fripside/site.sqlite'
RELEASES = Path('/opt/fripside/releases')
BACKUP_KEEP = 5
NAME = re.compile(r'\d{4}_[a-z0-9_]+\.sql')
# Additive DDL: existing rows and columns stay intact, so the previous release keeps working
# after a code rollback. Data rewrites, drops, renames and triggers need an administrator.
SAFE = [re.compile(p, re.I) for p in (
    r'CREATE TABLE (IF NOT EXISTS )?\S+\s*\(',
    r'CREATE (UNIQUE )?INDEX (IF NOT EXISTS )?\S+ ON ',
    r'ALTER TABLE \S+ ADD (COLUMN )?(?!.*\b(PRIMARY KEY|UNIQUE)\b)',
    r'CREATE VIEW (IF NOT EXISTS )?\S+ AS SELECT ',
    # A no-op inside the migration transaction; kept so existing files classify on their real content.
    r'PRAGMA foreign_keys\s*=\s*ON$',
)]
EXIT_PENDING = 3
EXIT_UNSAFE = 4


class MigrationError(Exception):
    pass


def statements(sql):
    """Split a script into statements without comments, honoring quotes."""
    out, current, i, quote = [], [], 0, None
    while i < len(sql):
        ch = sql[i]
        if quote:
            current.append(ch)
            if ch == quote:
                if sql[i + 1:i + 2] == quote:
                    current.append(sql[i + 1]); i += 1
                else:
                    quote = None
        elif ch in ('"', "'", '`'):
            quote = ch; current.append(ch)
        elif sql.startswith('--', i):
            end = sql.find('\n', i)
            i = len(sql) if end < 0 else end
            current.append(' ')
            continue
        elif sql.startswith('/*', i):
            end = sql.find('*/', i + 2)
            if end < 0:
                raise MigrationError('Unterminated block comment')
            i = end + 2
            current.append(' ')
            continue
        elif ch == ';':
            text = ' '.join(''.join(current).split())
            if text:
                out.append(text)
            current = []
        else:
            current.append(ch)
        i += 1
    if quote:
        raise MigrationError('Unterminated quoted string')
    text = ' '.join(''.join(current).split())
    if text:
        out.append(text)
    return out


def is_safe(statement):
    return any(pattern.match(statement) for pattern in SAFE)


def packaged(release):
    directory = Path(release) / 'migrations'
    if not directory.is_dir():
        return None
    files = sorted(p for p in directory.iterdir() if p.is_file())
    for path in files:
        if not NAME.fullmatch(path.name):
            raise MigrationError(f'Unexpected file in migrations: {path.name}')
    return files


def applied(db):
    row = db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations'").fetchone()
    if not row:
        raise MigrationError('Missing d1_migrations table; refusing to guess the schema version')
    return {name for (name,) in db.execute('SELECT name FROM d1_migrations')}


def plan(release, db):
    files = packaged(release)
    if files is None:
        return None
    done = applied(db)
    names = [p.name for p in files]
    unknown = sorted(done - set(names))
    if unknown:
        raise MigrationError('Database has migrations this release does not ship: ' + ', '.join(unknown))
    pending = [p for p in files if p.name not in done]
    # A gap means an older migration was skipped; applying later ones out of order is unsafe.
    if pending and any(p.name > pending[0].name for p in files if p.name in done):
        raise MigrationError(f'{pending[0].name} is older than an applied migration')
    return [(p.name, statements(p.read_text())) for p in pending]


def backup(db_path, db, label):
    directory = Path(db_path).parent / 'migration-backups'
    directory.mkdir(mode=0o700, exist_ok=True)
    size = Path(db_path).stat().st_size
    if shutil.disk_usage(directory).free < size * 2 + 64 * 1024 ** 2:
        raise MigrationError('Not enough free disk space for a pre-migration snapshot')
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = directory / f'{stamp}-{label}.sqlite'
    old = os.umask(0o077)
    try:
        with contextlib.closing(sqlite3.connect(target)) as snapshot:
            db.backup(snapshot)
            if snapshot.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise MigrationError('Pre-migration snapshot failed integrity_check')
    finally:
        os.umask(old)
    for stale in sorted(directory.glob('*.sqlite'))[:-BACKUP_KEEP]:
        stale.unlink()
    return target


def apply(db, name, sql_statements):
    db.execute('BEGIN IMMEDIATE')
    try:
        for statement in sql_statements:
            db.execute(statement)
        db.execute('INSERT INTO d1_migrations (name) VALUES (?)', (name,))
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            raise MigrationError(f'{name} left foreign key violations')
        db.execute('COMMIT')
    except BaseException:
        db.execute('ROLLBACK')
        raise


def run(release, sha, mode, db_path=DEFAULT_DB, allow_unsafe=False, log=print):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise MigrationError('Expected full source SHA')
    if (Path(release) / 'REVISION').read_text().strip() != sha:
        raise MigrationError('Release directory does not match the requested SHA')
    with contextlib.closing(sqlite3.connect(db_path, isolation_level=None, timeout=15)) as db:
        db.execute('PRAGMA busy_timeout = 15000')
        steps = plan(release, db)
        if steps is None:
            log('Release ships no migrations directory; nothing to check')
            return 0
        if not steps:
            log('Schema is up to date')
            return 0
        names = ', '.join(name for name, _ in steps)
        if mode == 'check':
            log(f'Pending migrations need approval before this release can run: {names}')
            return EXIT_PENDING
        unsafe = [(name, s) for name, items in steps for s in items if not is_safe(s)]
        if unsafe and not allow_unsafe:
            name, statement = unsafe[0]
            log(f'{name} needs an administrator (not additive): {statement[:160]}')
            return EXIT_UNSAFE
        snapshot = backup(db_path, db, f'{sha[:12]}-before-{steps[0][0][:4]}')
        log(f'Snapshot written: {snapshot}')
        for name, items in steps:
            apply(db, name, items)
            log(f'Applied {name}')
        return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True, help='Staged release directory under /opt/fripside/releases')
    parser.add_argument('--sha', required=True)
    parser.add_argument('--mode', choices=('check', 'apply'), required=True)
    parser.add_argument('--db', default=DEFAULT_DB)
    parser.add_argument('--allow-unsafe', action='store_true', help='Administrator use over SSH only')
    args = parser.parse_args(argv)
    release = Path(args.release).resolve()
    if args.db == DEFAULT_DB and release.parent != RELEASES:
        raise SystemExit('Release must be a staged directory under /opt/fripside/releases')
    if args.allow_unsafe and os.environ.get('SUDO_USER') == 'frip-deploy':
        raise SystemExit('The deployment runner cannot apply non-additive migrations')
    try:
        return run(release, args.sha, args.mode, args.db, args.allow_unsafe)
    except (MigrationError, sqlite3.Error) as error:
        print(f'Migration failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
