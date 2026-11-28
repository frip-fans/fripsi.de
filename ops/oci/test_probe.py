import importlib.util
import io
from contextlib import redirect_stdout
from pathlib import Path
import unittest
import urllib.error

spec=importlib.util.spec_from_file_location('probe',Path(__file__).parent/'deploy-control/probe.py')
probe=importlib.util.module_from_spec(spec);spec.loader.exec_module(probe)

A='a'*40
B='b'*40

class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.tags={}
        self.master=B
        self.behind={}
        self.ci={A:'success',B:'success'}
        self.deployments={'staging':[],'production':[]}
        self.original=probe.api
        probe.api=self.api
        self.addCleanup(lambda:setattr(probe,'api',self.original))

    def api(self,path,method='GET',data=None):
        source='repos/frip-fans/fripsi.de/'
        control='repos/frip-fans/fripside-deploy/'
        if path.startswith(source+'git/matching-refs/tags/v'):
            return [{'ref':'refs/tags/'+tag} for tag in self.tags]
        if path==source+'commits/heads/master': return {'sha':self.master}
        if path.startswith(source+'commits/tags/'):
            return {'sha':self.tags[path.rsplit('/',1)[1]]}
        if path.startswith(source+'contents/'): return {}
        if path.startswith(source+'actions/workflows/ci.yml/runs'):
            self.assertIn('branch=master',path)
            sha=path.split('head_sha=')[1].split('&')[0]
            if sha not in self.ci: return {'workflow_runs':[]}
            return {'workflow_runs':[{'id':7,'conclusion':self.ci[sha],'head_repository':{'full_name':'frip-fans/fripsi.de'}}]}
        if path.startswith(source+'compare/'):
            return {'behind_by':self.behind.get(path.split('compare/')[1].split('...')[0],0)}
        if path.startswith(control+'deployments?environment='):
            environment=path.split('environment=')[1].split('&')[0]
            return [{'id':f'{environment}-{index}','payload':{'source_sha':sha}} for index,(sha,_) in enumerate(self.deployments[environment])]
        if path.startswith(control+'deployments/'):
            environment,index=path.split('deployments/')[1].split('/')[0].split('-')
            return [{'state':self.deployments[environment][int(index)][1]}]
        raise AssertionError(path)

    def ready(self,environment):
        with redirect_stdout(io.StringIO()) as output:
            return probe.ready(environment),output.getvalue()

    def test_staging_follows_master_head(self):
        item,_=self.ready('staging')
        self.assertEqual((item['ref'],item['sha'],item['runner']),('heads/master',B,'fripside-staging'))
        self.deployments['staging']=[(B,'success')]
        self.assertIsNone(self.ready('staging')[0])

    def test_production_waits_for_a_tag(self):
        item,output=self.ready('production')
        self.assertIsNone(item)
        self.assertIn('no release tag',output)

    def test_production_deploys_newest_tag_by_version(self):
        self.tags={'v2026.11.28':A,'v2026.11.28.2':B,'v2026.9.30':A,'vnext':A,'v1-rc':A}
        self.deployments['staging']=[(B,'success'),(A,'success')]
        item,_=self.ready('production')
        self.assertEqual((item['ref'],item['sha'],item['runner']),('tags/v2026.11.28.2',B,'fripside-production'))

    def test_newer_tag_on_older_commit_rolls_back(self):
        self.tags={'v2026.11.28':B,'v2026.11.29':A}
        self.deployments['staging']=[(B,'success'),(A,'success')]
        self.deployments['production']=[(B,'success'),(A,'success')]
        self.assertEqual(self.ready('production')[0]['sha'],A)

    def test_production_skips_running_release_and_ignores_failed_attempts(self):
        self.tags={'v1':A}
        self.deployments['staging']=[(A,'success')]
        self.deployments['production']=[(B,'failure'),(A,'success')]
        self.assertIsNone(self.ready('production')[0])

    def test_tag_must_be_on_master_with_ci_and_staging_deployment(self):
        self.tags={'v1':A}
        item,output=self.ready('production')
        self.assertIsNone(item)
        self.assertIn('never deployed to staging',output)
        self.deployments['staging']=[(B,'success'),(A,'failure')]
        self.assertIsNone(self.ready('production')[0])
        self.deployments['staging']=[(B,'success'),(A,'success')]
        self.behind={A:1}
        self.assertIn('not on master',self.ready('production')[1])
        self.behind={}
        self.ci={B:'success'}
        self.assertIn('no successful master push CI',self.ready('production')[1])
        self.ci={A:'failure'}
        self.assertIsNone(self.ready('production')[0])
        self.ci={A:'success'}
        self.assertIsNotNone(self.ready('production')[0])

    def test_source_without_packaging_script_is_skipped(self):
        def missing(path,method='GET',data=None):
            if '/contents/' in path: raise urllib.error.HTTPError(path,404,'Not Found',{},None)
            return self.api(path,method,data)
        probe.api=missing
        self.assertIsNone(self.ready('staging')[0])

if __name__=='__main__':
    unittest.main()
