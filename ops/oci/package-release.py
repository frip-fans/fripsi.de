#!/usr/bin/env python3
"""Package only the standalone build, never databases or host configuration."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import tarfile
import tempfile
import shutil

def package(source, output, sha):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Expected full commit SHA')
    source = Path(source).resolve()
    output = Path(output).resolve()
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for name in ('server', 'client'):
            if not (source/name).is_dir():
                raise ValueError('Missing standalone build directory')
            for path in (source/name).rglob('*'):
                if path.is_symlink():
                    raise ValueError('Symlinks cannot be packaged')
                if path.is_file():
                    if path.name.startswith('.env') or any(x in path.name for x in ('.sqlite', '.agekey')) or path.suffix == '.db':
                        raise ValueError('Database or secret file in build output')
                    with path.open('rb') as f:
                        if f.read(16) == b'SQLite format 3\x00':
                            raise ValueError('SQLite database in build output')
            shutil.copytree(source/name, root/name)
        (root/'REVISION').write_text(sha+'\n')
        files = {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(root.rglob('*')) if p.is_file()}
        manifest = {'format':1,'repository':'frip-fans/fripsi.de','sha':sha,
                    'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':files}
        (root/'release.json').write_text(json.dumps(manifest,sort_keys=True))
        with tarfile.open(output,'w:gz') as archive:
            for path in sorted(root.rglob('*')):
                archive.add(path,arcname=str(path.relative_to(root)),recursive=False)
    print(hashlib.sha256(output.read_bytes()).hexdigest())

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',default='apps/web/dist-node')
    parser.add_argument('--output',required=True)
    parser.add_argument('--sha',required=True)
    args=parser.parse_args()
    package(args.source,args.output,args.sha)
