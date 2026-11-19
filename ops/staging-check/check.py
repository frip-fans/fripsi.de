"""Read-only staging acceptance. Emit only fixed step names, status codes and results."""
import http.client
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
from http.cookies import SimpleCookie

HOST = "staging.fripsi.de"
CREDENTIALS = Path.home() / ".config/fripside/staging-agent.env"
WORKER = Path(__file__).with_name("browser.mjs").resolve()


def credentials():
    with os.fdopen(os.open(CREDENTIALS, os.O_RDONLY | os.O_NOFOLLOW)) as source:
        info = os.fstat(source.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError()
        values = {}
        for line in source:
            key, sep, value = line.strip().partition("=")
            if sep:
                values[key] = value
    return {"CF-Access-Client-Id": values["FRIP_STAGING_ACCESS_CLIENT_ID"],
            "CF-Access-Client-Secret": values["FRIP_STAGING_ACCESS_CLIENT_SECRET"]}


def authenticate(connection, headers):
    # HTTPSConnection never follows redirects. No URL or host override accepts secrets.
    connection.request("GET", "/healthz", headers=headers)
    response = connection.getresponse()
    if response.status != 200:
        print(f"auth http={int(response.status)} failed")
        return None
    if json.loads(response.read(4096)).get("ok") is not True:
        raise ValueError()
    cookies = SimpleCookie()
    for name, value in response.getheaders():
        if name.lower() == "set-cookie":
            cookies.load(value)
    return cookies["CF_Authorization"].value if "CF_Authorization" in cookies else ""


def run_browser(cookie, path, selector, worker=WORKER, timeout=45):
    node = shutil.which("node")
    if not node:
        raise ValueError()
    # Isolate the profile, downloads, browser crash state and Playwright scratch files.
    with tempfile.TemporaryDirectory(dir="/dev/shm") as scratch:
        env = {"PATH": os.defpath, "HOME": scratch, "TMPDIR": scratch,
               "XDG_CACHE_HOME": scratch, "XDG_CONFIG_HOME": scratch,
               "PLAYWRIGHT_BROWSERS_PATH": str(Path.home() / ".cache/ms-playwright")}
        proc = subprocess.Popen([node, worker], stdin=subprocess.PIPE, cwd=scratch,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                env=env, start_new_session=True)
        try:
            proc.communicate(json.dumps([cookie, path, selector]).encode(), timeout=timeout)
            return proc.returncode == 0
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()


def main(args):
    if len(args) not in (0, 2) or (args and not re.fullmatch(r"/(?!/)[^\\\s#]*", args[0])):
        print("usage: python3 -I ops/staging-check/check.py [/path css-selector]")
        return 2
    stage = "auth"
    try:
        conn = http.client.HTTPSConnection(HOST, timeout=12)
        try:
            cookie = authenticate(conn, credentials())
        finally:
            conn.close()
        if cookie is None:
            return 1
        if not args:
            print("health http=200 passed")
            return 0
        if not cookie:
            print("auth session-cookie unavailable")
            return 1
        stage = "browser"
        if run_browser(cookie, *args):
            print("browser visible-assertion passed")
            return 0
    except (Exception, KeyboardInterrupt):
        pass  # Exceptions and third-party error objects can contain raw credentials.
    print(f"{stage} failed")
    return 1


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupt)
    sys.exit(main(sys.argv[1:]))
