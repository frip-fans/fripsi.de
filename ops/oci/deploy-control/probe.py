#!/usr/bin/env python3
"""Private hosted runner: select only protected source heads with passing CI."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

SOURCE='frip-fans/fripsi.de'
CONTROL='frip-fans/fripside-deploy'

def api(path,method='GET',data=None):
    request=urllib.request.Request('https://api.github.com/'+path,method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.urlopen(request,timeout=30) as response:
        return json.load(response)

def ready(environment,branch):
    sha=api(f'repos/{SOURCE}/commits/{branch}')['sha']
    try:
        api(f'repos/{SOURCE}/contents/ops/oci/package-release.py?ref={sha}')
    except urllib.error.HTTPError as error:
        if error.code==404: return None
        raise
    runs=api(f'repos/{SOURCE}/actions/workflows/ci.yml/runs?event=push&head_sha={sha}&branch={branch}&per_page=10')['workflow_runs']
    if not runs or runs[0]['conclusion']!='success' or runs[0]['head_repository']['full_name']!=SOURCE:
        print(f'{environment}: waiting for successful source push CI')
        return None
    deployments=api(f'repos/{CONTROL}/deployments?environment={environment}&per_page=20')
    for deployment in deployments:
        statuses=api(f'repos/{CONTROL}/deployments/{deployment["id"]}/statuses?per_page=1')
        if statuses and statuses[0]['state']=='success':
            if deployment.get('payload',{}).get('source_sha')==sha:
                print(f'{environment}: already deployed {sha}')
                return None
            break
    return {'environment':environment,'branch':branch,'sha':sha,'runner':'fripside-'+environment,'ci_run':runs[0]['id']}

if __name__=='__main__':
    selected=os.environ.get('REQUEST_ENVIRONMENT','all') or 'all'
    if selected not in ('all','staging','production'): raise ValueError('Invalid environment')
    planned=[]
    for environment,branch in [('staging','staging'),('production','master')]:
        if selected in ('all',environment):
            item=ready(environment,branch)
            if item: planned.append(item)
    with open(os.environ['GITHUB_OUTPUT'],'a') as output:
        output.write('matrix='+json.dumps({'include':planned},separators=(',',':'))+'\n')
        output.write('changed='+str(bool(planned)).lower()+'\n')
