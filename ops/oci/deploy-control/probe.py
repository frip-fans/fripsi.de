#!/usr/bin/env python3
"""Private hosted runner: staging follows the main branch head, production the newest release tag."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

SOURCE='frip-fans/fripsi.de'
CONTROL='frip-fans/fripside-deploy'
MAIN='master'

def api(path,method='GET',data=None):
    request=urllib.request.Request('https://api.github.com/'+path,method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)

TAG=re.compile(r'v\d+(\.\d+)*')

def version(tag):
    return tuple(int(part) for part in tag[1:].split('.'))

def release_tag():
    """Newest production tag by version number, so re-releasing an older commit under a new tag rolls back."""
    tags=[];page=1
    while True:
        refs=api(f'repos/{SOURCE}/git/matching-refs/tags/v?per_page=100&page={page}')
        tags+=[ref['ref'][len('refs/tags/'):] for ref in refs]
        if len(refs)<100: break
        page+=1
    tags=[tag for tag in tags if TAG.fullmatch(tag)]
    return max(tags,key=version) if tags else None

def deployed(environment,sha,ever=False):
    """Whether sha is the running release, or with ever=True whether it was among the last 100 deployments."""
    for deployment in api(f'repos/{CONTROL}/deployments?environment={environment}&per_page={100 if ever else 20}'):
        statuses=api(f'repos/{CONTROL}/deployments/{deployment["id"]}/statuses?per_page=1')
        if statuses and statuses[0]['state']=='success':
            if deployment.get('payload',{}).get('source_sha')==sha: return True
            if not ever: return False
    return False

def ready(environment):
    if environment=='staging':
        ref='heads/'+MAIN
    else:
        tag=release_tag()
        if not tag:
            print('production: no release tag')
            return None
        ref='tags/'+tag
    sha=api(f'repos/{SOURCE}/commits/{ref}')['sha']
    try:
        api(f'repos/{SOURCE}/contents/ops/oci/package-release.py?ref={sha}')
    except urllib.error.HTTPError as error:
        if error.code==404: return None
        raise
    if deployed(environment,sha):
        print(f'{environment}: already deployed {sha}')
        return None
    runs=api(f'repos/{SOURCE}/actions/workflows/ci.yml/runs?event=push&head_sha={sha}&branch={MAIN}&per_page=10')['workflow_runs']
    if not runs or runs[0]['conclusion']!='success' or runs[0]['head_repository']['full_name']!=SOURCE:
        print(f'{environment}: {ref} has no successful {MAIN} push CI')
        return None
    if environment=='production':
        if api(f'repos/{SOURCE}/compare/{sha}...{MAIN}')['behind_by']!=0:
            print(f'production: {ref} is not on {MAIN}')
            return None
        if not deployed('staging',sha,ever=True):
            print(f'production: {ref} was never deployed to staging')
            return None
    return {'environment':environment,'ref':ref,'sha':sha,'runner':'fripside-'+environment,'ci_run':runs[0]['id']}

if __name__=='__main__':
    selected=os.environ.get('REQUEST_ENVIRONMENT','all') or 'all'
    if selected not in ('all','staging','production'): raise ValueError('Invalid environment')
    planned=[]
    for environment in ('staging','production'):
        if selected in ('all',environment):
            item=ready(environment)
            if item: planned.append(item)
    with open(os.environ['GITHUB_OUTPUT'],'a') as output:
        output.write('matrix='+json.dumps({'include':planned},separators=(',',':'))+'\n')
        output.write('changed='+str(bool(planned)).lower()+'\n')
