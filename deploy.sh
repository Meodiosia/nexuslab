#!/usr/bin/env bash
# 在 Ubuntu 24.04 VPS 上一键部署 NEXUS LAB（systemd 常驻 + 可选 Caddy HTTPS）
# 用法：
#   sudo bash deploy.sh your.domain.com          # 用域名（自动 Caddy + HTTPS）
#   sudo bash deploy.sh                          # 无域名（之后用 ngrok / cloudflared 隧道）
#   sudo bash deploy.sh your.domain.com <git-repo-url>   # 代码直接从仓库克隆
# 前置：域名 A 记录已指向本机公网 IP（用域名时才需要）。

set -euo pipefail

DOMAIN="${1:-}"
REPO="${2:-}"
APP_DIR="/opt/nexuslab"
RUN_USER="${SUDO_USER:-$(whoami)}"

echo "==> [1/5] 系统依赖"
apt-get update -y
apt-get install -y python3 python3-venv python3-pip git curl

echo "==> [2/5] 项目代码 -> ${APP_DIR}"
mkdir -p "$APP_DIR"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR" 2>/dev/null || true
if [ ! -f "$APP_DIR/server.py" ]; then
  if [ -n "$REPO" ]; then
    git clone "$REPO" "$APP_DIR"
  else
    echo "!! ${APP_DIR}/server.py 不存在，且未提供仓库地址。"
    echo "   请先把项目放到该目录（例如从本地 scp/上传），再重新运行。"
    exit 1
  fi
fi

echo "==> [3/5] 虚拟环境 + waitress"
cd "$APP_DIR"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install waitress || echo "  (未安装 waitress，将回退标准库服务器)"

echo "==> [4/5] systemd 常驻服务"
cat > /etc/systemd/system/nexuslab.service <<EOF
[Unit]
Description=NEXUS LAB
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/.venv/bin/python3 server.py --host 127.0.0.1 --port 8000 --backup-minutes 60
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now nexuslab
systemctl restart nexuslab
sleep 1
if curl -sf http://127.0.0.1:8000/api/session >/dev/null; then
  echo "  -> 服务 OK (http://127.0.0.1:8000)"
else
  echo "  !! 服务未就绪，请看日志：" && journalctl -u nexuslab -n 40 --no-pager || true
fi

echo "==> [5/5] 公网入口"
if [ -n "$DOMAIN" ]; then
  echo "  安装 Caddy 并用域名 ${DOMAIN} 反向代理..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y >/dev/null
  apt-get install -y caddy >/dev/null
  cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:8000
}
EOF
  systemctl enable --now caddy >/dev/null 2>&1 || true
  systemctl reload caddy || true
  ufw allow 80,443/tcp 2>/dev/null || true
  echo "  -> 公网地址: https://${DOMAIN}"
else
  echo "  未提供域名（参数1）。可改用隧道作为公网入口（保持进程常驻）："
  echo "      ngrok http 8000          （推荐，免费有 1 个静态域名）"
  echo "      cloudflared tunnel --url http://127.0.0.1:8000"
fi

echo
echo "== 部署完成 =="
echo "  启动/查看: systemctl status nexuslab"
echo "  日志:      journalctl -u nexuslab -f"
echo "  公网开启前：第一个注册者=管理员；随后在『项目设置』开启『仅限邀请注册』并下发邀请码。"
echo "  更新:      cd ${APP_DIR} && sudo git pull && sudo systemctl restart nexuslab"
