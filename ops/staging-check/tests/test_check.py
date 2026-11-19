import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SECRET = "sentinel-long-lived-do-not-log"
COOKIE = "sentinel-session-do-not-log"

# Run the real supervisor as a separate process so unhandled exceptions and stderr
# are covered too. Only the fixed-host connection is replaced by a fixture.
HARNESS = """
import os, sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
import check
case = sys.argv[2]
check.CREDENTIALS = Path(sys.argv[3])
class Connection:
    def __init__(self, host, timeout):
        assert host == 'staging.fripsi.de'
    def request(self, method, path, headers):
        assert method == 'GET' and path == '/healthz'
        assert headers['CF-Access-Client-Secret'] == os.environ['FRIP_STAGING_ACCESS_CLIENT_SECRET']
        if case == 'timeout':
            raise TimeoutError(str(headers))
    def close(self): pass
    def getresponse(self): return self
    status = {'forbidden':403,'redirect':302}.get(case,200)
    def read(self, limit): return b'{"ok":true}'
    def getheaders(self):
        return [] if case == 'nocookie' else [('Set-Cookie', 'CF_Authorization='+sys.argv[4])]
run = check.run_browser
def fixture(cookie, path, selector):
    return run(cookie, path, selector, check.WORKER.parent/'tests/browser-fixture.mjs',
               timeout=3 if case == 'hang' else 20)
with patch.object(check.http.client, 'HTTPSConnection', Connection), patch.object(check,'run_browser',fixture):
    sys.exit(check.main([] if case == 'health' else ['/'+case, 'main h1']))
"""


class Acceptance(unittest.TestCase):
    def test_reporting(self):
        cases = {"health": "health http=200 passed", "success": "browser visible-assertion passed",
                 "timeout": "auth failed", "forbidden": "auth http=403 failed",
                 "redirect": "auth http=302 failed", "nocookie": "auth session-cookie unavailable",
                 "close": "browser failed", "hang": "browser failed", "permissions": "auth failed"}
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp, "credentials")
            source.write_text(f"FRIP_STAGING_ACCESS_CLIENT_ID=test\nFRIP_STAGING_ACCESS_CLIENT_SECRET={SECRET}\n")
            for case, expected in cases.items():
                with self.subTest(case=case):
                    source.chmod(0o644 if case == "permissions" else 0o600)
                    result = subprocess.run(
                        [sys.executable, "-I", "-c", HARNESS, str(ROOT), case, str(source), COOKIE],
                        cwd=tmp, env={**os.environ, "FRIP_STAGING_ACCESS_CLIENT_SECRET": SECRET,
                                      "DEBUG": "pw:*", "PWDEBUG": "1"},
                        capture_output=True, timeout=25)
                    # Use boolean assertions: even a failing test mustn't reprint captured streams.
                    self.assertTrue(result.stdout == (expected + "\n").encode())
                    self.assertTrue(result.stderr == b"")
                    self.assertEqual(result.returncode, 0 if case in ("health", "success") else 1)
                    self.assertEqual(list(Path(tmp).iterdir()), [source])
