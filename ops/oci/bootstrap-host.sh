#!/usr/bin/env bash
set -euo pipefail
# Run as root over an administrative SSH connection. Never run in an Actions job.
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
getent group fripside >/dev/null || groupadd --system fripside
id frip-app >/dev/null 2>&1 || useradd --system --gid fripside --home-dir /var/lib/fripside --shell /usr/sbin/nologin frip-app
id frip-deploy >/dev/null 2>&1 || useradd --system --gid fripside --create-home --home-dir /var/lib/fripside-deploy --shell /bin/bash frip-deploy
install -d -o frip-deploy -g fripside -m 0750 /opt/fripside
install -d -o frip-deploy -g fripside -m 0750 /opt/fripside/releases
install -d -o frip-app -g fripside -m 0700 /var/lib/fripside
install -d -o frip-app -g fripside -m 0700 /var/lib/fripside/media
install -d -o root -g root -m 0700 /etc/fripside
install -d -o frip-deploy -g fripside -m 0700 /opt/actions-runner
if ! test -f /swapfile && ! swapon --show --noheadings | read -r _; then
  fallocate -l 2G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
curl --fail --silent --show-error --location --retry 3 -o node.tar.xz https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz
printf '%s  node.tar.xz\n' 48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75 | sha256sum --check
mkdir -p /opt/node-v24.22.2
tar -xJf node.tar.xz --strip-components=1 -C /opt/node-v24.22.2
ln -sfn /opt/node-v24.22.2/bin/node /usr/local/bin/node
curl --fail --silent --show-error --location --retry 3 -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-amd64.deb
printf '%s  cloudflared.deb\n' 70b1a1e0f46033ffc8d90b406e554044ba6cbf2e4360295ef1163aed31e09393 | sha256sum --check
dpkg --install cloudflared.deb
if ! test -f /opt/actions-runner/config.sh; then
  curl --fail --silent --show-error --location --retry 3 -o runner.tar.gz https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-linux-x64-2.338.2.tar.gz
  printf '%s  runner.tar.gz\n' baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40 | sha256sum --check
  tar -xzf runner.tar.gz -C /opt/actions-runner
  chown -R frip-deploy:fripside /opt/actions-runner
fi
printf 'frip-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart fripside-web.service\n' > /etc/sudoers.d/fripside-deploy
chmod 0440 /etc/sudoers.d/fripside-deploy
visudo -cf /etc/sudoers.d/fripside-deploy
/usr/local/bin/node --version
cloudflared --version
free -m
