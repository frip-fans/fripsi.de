import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

pack=module('package-release')
install=module('install-release')

class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.source=self.root/'build'
        (self.source/'server').mkdir(parents=True)
        (self.source/'client').mkdir()
        (self.source/'server/entry.mjs').write_text('console.log("hello")')
        (self.source/'client/site.css').write_text('body{}')
        self.sha='a'*40
        self.archive=self.root/'release.tgz'

    def test_manifest_and_source_identity(self):
        pack.package(self.source,self.archive,self.sha)
        out=self.root/'verified';out.mkdir()
        manifest=install.verify(self.archive,out,self.sha)
        self.assertEqual(manifest['sha'],self.sha)
        other=self.root/'other';other.mkdir()
        with self.assertRaisesRegex(ValueError,'identity'):
            install.verify(self.archive,other,'b'*40)

    def test_database_is_never_packaged(self):
        (self.source/'server/disguised.bin').write_bytes(b'SQLite format 3\x00'+b'secret')
        with self.assertRaisesRegex(ValueError,'SQLite'):
            pack.package(self.source,self.archive,self.sha)

    def test_rejects_path_traversal_and_symlink(self):
        for name,kind in [('../escape',tarfile.REGTYPE),('server/link',tarfile.SYMTYPE)]:
            with self.subTest(name=name):
                with tarfile.open(self.archive,'w:gz') as archive:
                    entry=tarfile.TarInfo(name);entry.type=kind;entry.linkname='/etc/passwd'
                    archive.addfile(entry,io.BytesIO())
                out=self.root/'out';out.mkdir(exist_ok=True)
                with self.assertRaises(ValueError): install.verify(self.archive,out,self.sha)

    def test_rejects_modified_payload(self):
        pack.package(self.source,self.archive,self.sha)
        with tarfile.open(self.archive,'r:gz') as archive: archive.extractall(self.root/'edit',filter='data')
        (self.root/'edit/server/entry.mjs').write_text('tampered')
        with tarfile.open(self.archive,'w:gz') as archive:
            for path in (self.root/'edit').rglob('*'):
                archive.add(path,arcname=str(path.relative_to(self.root/'edit')),recursive=False)
        out=self.root/'out';out.mkdir()
        with self.assertRaisesRegex(ValueError,'checksum'): install.verify(self.archive,out,self.sha)

if __name__=='__main__': unittest.main()
