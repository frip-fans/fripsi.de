import contextlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

migrate=module('migrate')
REPO_MIGRATIONS=Path(__file__).resolve().parents[2]/'migrations'
SHA='c'*40

class MigrateTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.release=self.root/'release';(self.release/'migrations').mkdir(parents=True)
        (self.release/'REVISION').write_text(SHA+'\n')
        self.db=self.root/'data'/'site.sqlite';self.db.parent.mkdir()
        with contextlib.closing(sqlite3.connect(self.db)) as db:
            db.executescript('''
              CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
              CREATE TABLE songs(id TEXT PRIMARY KEY, title TEXT NOT NULL);
              INSERT INTO songs VALUES ('s1', 'only my railgun');
              INSERT INTO d1_migrations(name) VALUES ('0001_initial.sql');
            ''')
        self.write('0001_initial.sql','CREATE TABLE songs(id TEXT PRIMARY KEY, title TEXT NOT NULL);')
        self.logs=[]

    def write(self,name,sql):
        (self.release/'migrations'/name).write_text(sql)

    def run_mode(self,mode,**kwargs):
        return migrate.run(self.release,SHA,mode,str(self.db),log=self.logs.append,**kwargs)

    def query(self,sql):
        with contextlib.closing(sqlite3.connect(self.db)) as db: return db.execute(sql).fetchall()

    def test_up_to_date_and_missing_directory_are_no_ops(self):
        self.assertEqual(self.run_mode('check'),0)
        for path in (self.release/'migrations').iterdir(): path.unlink()
        (self.release/'migrations').rmdir()
        self.assertEqual(self.run_mode('apply'),0)
        self.assertIn('no migrations directory',self.logs[-1])

    def test_check_reports_pending_without_touching_the_database(self):
        self.write('0002_song_phase.sql','ALTER TABLE songs ADD COLUMN phase_mask INTEGER;')
        self.assertEqual(self.run_mode('check'),migrate.EXIT_PENDING)
        self.assertNotIn('phase_mask',[c[1] for c in self.query('PRAGMA table_info(songs)')])
        self.assertFalse((self.db.parent/'migration-backups').exists())

    def test_apply_snapshots_then_records_additive_migrations_in_order(self):
        self.write('0002_song_phase.sql','-- comment; with a semicolon\nALTER TABLE songs ADD COLUMN phase_mask INTEGER CHECK (phase_mask BETWEEN 1 AND 7);')
        self.write('0003_index.sql','PRAGMA foreign_keys = ON;\nCREATE INDEX idx_songs_phase ON songs (phase_mask);')
        self.assertEqual(self.run_mode('apply'),0)
        self.assertEqual([r[0] for r in self.query('SELECT name FROM d1_migrations ORDER BY id')],['0001_initial.sql','0002_song_phase.sql','0003_index.sql'])
        self.assertEqual(self.query("SELECT title FROM songs"),[('only my railgun',)])
        snapshots=list((self.db.parent/'migration-backups').glob('*.sqlite'))
        self.assertEqual(len(snapshots),1)
        self.assertEqual(snapshots[0].stat().st_mode & 0o077,0)
        with contextlib.closing(sqlite3.connect(snapshots[0])) as old:
            self.assertNotIn('phase_mask',[c[1] for c in old.execute('PRAGMA table_info(songs)')])
        self.assertEqual(self.run_mode('apply'),0)
        self.assertEqual(self.logs[-1],'Schema is up to date')

    def test_refuses_non_additive_migrations_unless_an_administrator_allows_them(self):
        self.write('0002_rewrite.sql',"UPDATE songs SET title = 'x';")
        self.assertEqual(self.run_mode('apply'),migrate.EXIT_UNSAFE)
        self.assertEqual(self.query('SELECT title FROM songs'),[('only my railgun',)])
        self.assertEqual(self.run_mode('apply',allow_unsafe=True),0)
        self.assertEqual(self.query('SELECT title FROM songs'),[('x',)])

    def test_failed_migration_rolls_back_completely(self):
        self.write('0002_broken.sql','ALTER TABLE songs ADD COLUMN phase_mask INTEGER;\nCREATE INDEX idx_missing ON nope (x);')
        with self.assertRaises(sqlite3.Error): self.run_mode('apply')
        self.assertNotIn('phase_mask',[c[1] for c in self.query('PRAGMA table_info(songs)')])
        self.assertEqual(len(self.query('SELECT name FROM d1_migrations')),1)

    def test_rejects_unknown_applied_out_of_order_and_mismatched_releases(self):
        self.write('0003_later.sql','CREATE TABLE later(id TEXT);')
        with contextlib.closing(sqlite3.connect(self.db)) as db:
            db.execute("INSERT INTO d1_migrations(name) VALUES ('0003_later.sql')");db.commit()
        self.write('0002_skipped.sql','CREATE TABLE skipped(id TEXT);')
        with self.assertRaisesRegex(migrate.MigrationError,'older than an applied'): self.run_mode('apply')
        (self.release/'migrations'/'0003_later.sql').unlink()
        with self.assertRaisesRegex(migrate.MigrationError,'does not ship'): self.run_mode('apply')
        with self.assertRaisesRegex(migrate.MigrationError,'does not match'):
            migrate.run(self.release,'d'*40,'apply',str(self.db),log=self.logs.append)

    def test_snapshots_are_pruned(self):
        backups=self.db.parent/'migration-backups';backups.mkdir()
        for i in range(migrate.BACKUP_KEEP+2): (backups/f'2026010{i}T000000Z-old.sqlite').write_bytes(b'')
        self.write('0002_t.sql','CREATE TABLE t(id TEXT);')
        self.assertEqual(self.run_mode('apply'),0)
        self.assertEqual(len(list(backups.glob('*.sqlite'))),migrate.BACKUP_KEEP)

    def test_statement_splitting_honors_quotes_and_comments(self):
        self.assertEqual(migrate.statements("INSERT INTO a VALUES ('x;--y', 'it''s'); /* c; */ SELECT 1"),
                         ["INSERT INTO a VALUES ('x;--y', 'it''s')",'SELECT 1'])

    def test_repository_migrations_classify_as_expected(self):
        manual={'0004_structured_locations.sql','0006_journey_coordinate_data.sql'}
        for path in sorted(REPO_MIGRATIONS.glob('*.sql')):
            with self.subTest(path.name):
                safe=all(migrate.is_safe(s) for s in migrate.statements(path.read_text()))
                self.assertEqual(safe,path.name not in manual)

if __name__=='__main__': unittest.main()
