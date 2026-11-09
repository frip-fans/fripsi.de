#!/usr/bin/env python3
"""Verify a hosted CI artifact, apply additive migrations, activate it, health-check and roll back code only."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

def verify(archive, output, sha):
    if not re.fullmatch('[0-9a-f]{40}',sha):
        raise ValueError('Expected full source SHA')
    with tarfile.open(archive,'r:gz') as tar:
        members=tar.getmembers()
        if len(members)>10000 or sum(x.size for x in members)>500*1024**2:
            raise ValueError('Artifact exceeds deployment limits')
        seen=set()
        for item in members:
            path=PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or item.name in seen:
                raise ValueError('Unsafe or duplicate artifact path')
            seen.add(item.name)
            if path.parts[0] not in ('server','client','migrations','REVISION','release.json') or not (item.isfile() or item.isdir()):
                raise ValueError('Artifact contains forbidden entries')
        tar.extractall(output,filter='data')
    output=Path(output)
    manifest=json.loads((output/'release.json').read_text())
    if manifest['format']!=1 or manifest['repository']!='frip-fans/fripsi.de' or manifest['sha']!=sha or (output/'REVISION').read_text().strip()!=sha:
        raise ValueError('Artifact source identity does not match workflow')
    actual={str(p.relative_to(output)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in output.rglob('*') if p.is_file() and p.relative_to(output).as_posix()!='release.json'}
    if actual!=manifest['files'] or not (output/'server/entry.mjs').is_file():
        raise ValueError('Artifact checksum manifest failed')
    for path in output.rglob('*'):
        path.chmod(0o750 if path.is_dir() else 0o640)
    output.chmod(0o750)
    return manifest

def migrate(target,sha,mode):
    """Run fripside-migrate as the database owner; pending or non-additive migrations stop activation."""
    if mode=='skip':
        return
    result=subprocess.run(['sudo','-n','-u','frip-app','/usr/local/bin/fripside-migrate','--release',str(target),'--sha',sha,'--mode',mode])
    if result.returncode==3:
        raise RuntimeError('Pending migrations: rerun the production deployment with apply_production_migrations')
    if result.returncode==4:
        raise RuntimeError('A migration is not additive; an administrator must apply it over SSH first')
    if result.returncode!=0:
        raise RuntimeError('Migration step failed')

def activate(archive,sha,migrate_mode='check'):
    root=Path('/opt/fripside')
    releases=root/'releases'
    with open('/var/lib/fripside-deploy/deploy.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        target=releases/sha
        with tempfile.TemporaryDirectory(prefix='incoming-',dir=releases) as temporary:
            verify(archive,temporary,sha)
            if target.exists():
                if (target/'release.json').read_bytes()!=(Path(temporary)/'release.json').read_bytes():
                    # Same source can have a different build timestamp; content hashes must match.
                    old=json.loads((target/'release.json').read_text())
                    new=json.loads((Path(temporary)/'release.json').read_text())
                    if old['files']!=new['files']:
                        raise ValueError('Existing release has different contents')
            else:
                shutil.copytree(temporary,target)
                target.chmod(0o750)
        # Schema first: only additive changes run here, so the previous code still works if
        # the health check below rolls the code back.
        migrate(target,sha,migrate_mode)
        current=root/'current'
        previous=current.resolve() if current.is_symlink() else None
        temporary_link=root/'current.new'
        temporary_link.unlink(missing_ok=True)
        temporary_link.symlink_to(target)
        os.replace(temporary_link,current)
        try:
            subprocess.run(['sudo','-n','/usr/bin/systemctl','restart','fripside-web.service'],check=True)
            for _ in range(30):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:3000/healthz',timeout=2) as response:
                        health=json.load(response)
                        if health.get('ok') is True and health.get('version')==sha:
                            print(json.dumps({'deployed':sha,'previous':str(previous) if previous else None}))
                            return
                except Exception:
                    pass
                time.sleep(1)
            raise RuntimeError('New release health check failed')
        except Exception:
            if previous:
                temporary_link.symlink_to(previous)
                os.replace(temporary_link,current)
                subprocess.run(['sudo','-n','/usr/bin/systemctl','restart','fripside-web.service'],check=True)
            raise

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',required=True)
    parser.add_argument('--sha',required=True)
    parser.add_argument('--migrate',choices=('skip','check','apply'),default='check',
        help='check refuses activation while migrations are pending; apply runs additive ones first')
    args=parser.parse_args()
    activate(args.archive,args.sha,args.migrate)
