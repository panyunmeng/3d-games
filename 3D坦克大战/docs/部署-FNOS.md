# 部署到 FNOS（或任意 Linux / Docker 环境）

> **本机 NAS 已完成部署（2026-11-17）**
>
> - 地址：`http://panyunmeng.cn:8080/`（局域网：`http://192.168.1.100:8080/`）
> - 主机路径：`/home/panyunmeng/tank3d`，容器名 `tank3d`，镜像 `tank3d:1.0.0`，端口 `8080 → 3000`
> - 重建方式见文末「更新已部署实例」

游戏是**单进程单端口**：同一个 Node 进程既提供静态页面，也提供 WebSocket 联机。所以部署只需要跑一个容器（或一个 node 进程），不需要 nginx 之外的额外服务。

## 方式一：Docker Compose（推荐）

镜像构建命令与本地 `npm run build` / `npm start` 完全一致，容器内没有额外魔法。

```bash
# 在项目目录里
docker compose up -d --build
docker compose ps
curl http://<NAS-IP>:8080/healthz     # 期望返回 ok
```

浏览器打开 `http://<NAS-IP>:8080/` 即可。联机时两台电脑访问同一个地址，一人创建房间、另一人用房间码加入。

改端口：编辑 `docker-compose.yml` 里 `ports` 的左边那一位（右边 `3000` 是容器内端口，不要动）。

## 方式二：不用 Docker，直接 node

FNOS 上装了 Node 20+ 也可以直接跑（不需要 `docker`）：

```bash
git clone http://panyunmeng.cn:3000/panyunmeng/3d-tan-ke-da-zhan.git
cd 3d-tan-ke-da-zhan
npm ci
npm run build
PORT=8080 npm start
```

想要开机自启可以用 FNOS 的计划任务 / systemd：

```ini
[Unit]
Description=tank3d
After=network.target

[Service]
WorkingDirectory=/opt/tank3d
Environment=PORT=8080
ExecStart=/usr/bin/node dist-server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

## 反向代理（可选）

如果已有 FNOS 的 Web 门户 / nginx，只需要把两个路径都转给容器：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
}
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

WebSocket 必须带 `Upgrade` / `Connection` 头，否则联机会连不上（页面能打开但点「创建房间」会提示连接失败）。

## 更新已部署实例

```bash
# 在 NAS 上（或把新源码同步过去之后）
cd /home/panyunmeng/tank3d
sudo env NPM_REGISTRY=https://registry.npmmirror.com docker compose build
sudo docker compose up -d
curl -s http://127.0.0.1:8080/healthz
```

## 本次实际部署记录（2026-11-17）

现场事实，照抄可复现：

| 项 | 值 |
|---|---|
| NAS | FNOS（Dell R730），Docker 28.5.2 / Compose v2.40.3，数据根 `/vol2/docker` |
| 端口 | **8080**（NAS 的 3000 已被 Gitea 占用，必须换端口） |
| 代码位置 | `/home/panyunmeng/tank3d`（源码从 Windows 侧打包 scp 过去，未在 NAS 上 clone） |
| 构建 | `sudo env NPM_REGISTRY=https://registry.npmmirror.com docker compose build`，NAS 直连 npmjs 太慢，走 npmmirror |
| 基础镜像 | `node:22-alpine` 通过 daemon 已配置的镜像源（`docker.fnnas.com`）拉取成功 |
| 镜像体积 | 171 MB；构建耗时约 25 s（56 核） |
| 验收 | `/healthz` 200；`net-smoke` 打到 NAS：3 s 收 62 帧快照、双端各推进 15.25 m、同 tick 一致 62/62；浏览器实机双人同屏可玩 |

踩到的两个坑：

1. **`npm ci` 失败**：本地 `package.json` 改过依赖分组（`three` 移到 devDependencies）但没有重新生成 `package-lock.json`，容器里 `npm ci` 严格校验直接报错。修法：本地 `npm install --package-lock-only` 同步锁文件后再打镜像。
2. **终端里 `docker` 报 permission denied**：`panyunmeng` 不在 docker 组，所有 docker 命令都要 `sudo -S`。想省事可执行 `sudo usermod -aG docker panyunmeng` 后重新登录（本次没改，避免动用户组）。

容器内无持久化数据（存档在玩家浏览器 localStorage 里），所以重建容器不影响任何人的进度。

## 排查

| 现象 | 原因 |
|---|---|
| 页面能开，点联机提示「无法连接服务器」 | 反代没转发 `/ws`，或没带 Upgrade 头 |
| 两人连不上同一个房间 | 房间码输错 / 房间已满（最多 2 人）/ 服务重启后旧房间已清空 |
| 别人能连、你连不上 | 检查是否走了 https 但 WebSocket 用了 ws（客户端会自动按页面协议选 ws/wss） |
| 画面卡但能动 | 客户端渲染帧率问题，先看 `?debug=1` 的 fps 与 draw call |
| 联机两边不同步 | 正常应以服务器为准；若持续不同步，看服务端日志是否有客户端频繁断连 |

健康检查端点是 `/healthz`，只返回 `ok`，可用于 FNOS 的容器健康状态与探活。

## 资源占用

- 容器镜像约 180 MB（node:22-alpine + 构建产物 + `ws`）
- 空闲内存约 40 MB；一局双人联机的仿真开销可以忽略（60 Hz 推进 ~10 个实体）
- 不需要数据库、不需要持久化卷
