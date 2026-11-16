# 二期部署：把构建产物放到 NAS 并提供联网访问

## 0. 前置事实（已实测）

- `vite.config.ts` 的 `base: './'`，`dist/` 内全是相对路径。
- 把 `dist/` 放在任意子路径（实测 `/game/`）下用静态服务器访问，页面、JS/CSS、localStorage 存档均正常。
- 产物自包含：无 CDN、无外链字体、无外部图片，断网也能跑。

## 1. 构建

```bash
cd "D:\MyProjects\X.AIProjects\3D塔防"
pnpm install
pnpm build          # 产出 dist/，约 650 KB JS + 13 KB CSS
```

## 2. 上传到 NAS

NAS 是 fnOS，数据盘 `/vol2`。建议目录：`/vol2/1000/web/mech-bastion/`（1000 是主用户）。

三种方式任选：

**A. rsync（推荐，增量）**

```bash
rsync -avz --delete dist/ panyunmeng@panyunmeng.cn:/vol2/1000/web/mech-bastion/
```

**B. scp（一次性）**

```bash
scp -r dist/* panyunmeng@panyunmeng.cn:/vol2/1000/web/mech-bastion/
```

**C. Windows 映射盘**

NAS 上开好 SMB 共享后，`\\panyunmeng.cn\<共享名>` 映射成盘符，直接把 `dist\` 整个拷进去。

> 当前阻塞：本机 `~/.ssh/id_ed25519` 未写入 NAS 的 `authorized_keys`，
> 非交互 `ssh` 返回 `Permission denied (publickey,password)`。
> 需要先执行一次：`ssh-copy-id -i ~/.ssh/id_ed25519.pub panyunmeng@panyunmeng.cn`
> （NAS 主机密钥 2026-11-17 已更新，旧记录已备份到 `~/.ssh/known_hosts.bak-*`）。

## 3. 让 HTTP 服务指向它

任选其一，取决于 NAS 上已经在跑什么：

**已有 nginx**

```nginx
location /mech-bastion/ {
    alias /vol2/1000/web/mech-bastion/;
    index index.html;
    location ~* \.(js|css|png)$ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location = /mech-bastion/index.html {
        add_header Cache-Control "no-store";
    }
}
```

**Caddy**

```caddy
handle_path /mech-bastion/* {
    root * /vol2/1000/web/mech-bastion
    encode gzip
    file_server
}
```

**fnOS 自带 Web 站点 / 反向代理面板**：新建一个静态站点，根目录指到上面的目录即可，
不用改任何前端配置。

## 4. 验证清单

1. `curl -I http://<nas>:<port>/mech-bastion/` 返回 200。
2. 打开页面：主菜单出现、背景是 3D 场景、帧率正常。
3. 进一关，建塔开波，确认击杀、金币、血量都在动。
4. 刷新页面：星级与设置仍在（localStorage 按站点源隔离，换端口会看不到旧进度）。
5. 手机/另一台机器访问同一 URL，确认可玩（触屏操作未专门适配，鼠标优先）。

## 5. 回滚

```bash
# 保留上一版目录，切软链即可秒回滚
ln -sfn /vol2/1000/web/mech-bastion-20261117 /vol2/1000/web/mech-bastion
```
