#!/usr/bin/env bash
# 二期部署：构建并推送到 NAS 静态目录
#   ./tools/deploy-nas.sh [user@host] [远端目录]
# 默认：panyunmeng@panyunmeng.cn → /vol2/1000/web/mech-bastion/
set -euo pipefail

HOST="${1:-panyunmeng@panyunmeng.cn}"
DEST="${2:-/vol2/1000/web/mech-bastion/}"

cd "$(dirname "$0")/.."

echo "== 1/3 类型检查 + 构建"
pnpm build

echo "== 2/3 确保远端目录存在"
ssh "$HOST" "mkdir -p '$DEST'"

echo "== 3/3 同步 dist/ 到 $HOST:$DEST"
rsync -avz --delete dist/ "$HOST:$DEST"

echo
echo "完成。验证："
echo "  curl -I http://panyunmeng.cn/<端口>/<路径>/    # 应返回 200"
echo "  浏览器打开同一地址，检查主菜单、3D 背景、建塔、存档"
echo "回滚：保留上一版目录，切软链即可（见 docs/deploy-nas.md）"
