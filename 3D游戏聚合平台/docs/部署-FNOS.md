# 部署到 FNOS（fnOS）

合集打包成 **fnOS 原生应用**（`.fpk`），装完在应用中心里就是一个带图标的
「3D 游戏合集」，支持端口访问与统一网关两种入口。

## 当前线上状态（2026-11-17 已装好）

| 项 | 值 |
| --- | --- |
| 应用名 | `3d-games`，显示名「3D 游戏合集」 |
| 版本 | 1.0.0 |
| 安装位置 | `/vol1/@appcenter/3d-games`（`target` 指向它） |
| 端口访问 | `http://panyunmeng.cn:8081/`（局域网 `http://192.168.1.100:8081/`） |
| 网关访问 | `https://panyunmeng.cn:5667/app/3d-games`（需登录 fnOS） |
| 日志 | `/var/apps/3d-games/var/app.log` |
| 进程 | 由 `cmd/main` 管理，PID 在 `var/app.pid` |

改端口：fnOS 应用设置里改「服务端口」，`config_callback` 会自动重启生效。

## 一条命令部署

```bash
node scripts/pack.mjs      # 组装 fnapp + 打 tar.gz（约 1.7 MB）
node scripts/deploy.mjs    # 上传到 NAS + fnpack 打成 .fpk
```

`deploy.mjs` 只做到「产出 fpk」，不自动安装 —— 见下节原因。

## 安装 / 升级

命令行通道可用（`appcenter-cli`），但**升级不会覆盖已存在的文件**：fpk 里
`app.tgz` 解包到已有目录时，同名文件保留旧的。所以改了服务端代码后必须
先卸载再装，否则会看到「升级成功但行为没变」。

```bash
# 在 NAS 上
sudo appcenter-cli uninstall 3d-games
sudo appcenter-cli install-fpk 3d-games.fpk -e /tmp/inst.env -v 1
```

`/tmp/inst.env` 是安装向导的输入，格式是 **key=value**（不是 JSON）：

```ini
wizard_port=8081
wizard_enable_port=true
wizard_lan_only=false
```

也可以在 fnOS 应用中心「手动安装」上传 fpk，效果相同。

## 访问方式

### 端口直连

`http://<NAS>:8081/`。服务监听 `0.0.0.0`，向导里可改成只监听回环
（`wizard_lan_only`）。

### 统一网关

`app/ui/config` 里声明了 `gatewayPrefix: /app/3d-games` 与
`gatewaySocket: app.sock`，因此应用会挂在 fnOS 系统域名下：

```text
https://panyunmeng.cn:5667/app/3d-games
```

网关转发前会检查登录态，所以这条路径不需要自己再做鉴权。请求到达应用时
**带着 `/app/3d-games` 前缀**，服务端会剥掉它再查静态文件。

## 踩过的坑（都已在代码里处理）

1. **fnpack 只认 `app/` 目录**
   静态产物与服务端必须放 `app/www`、`app/server`。放包根目录时 fnpack 不报错、
   直接忽略，打出来的 fpk 只有 39 KB，装上后点开是空白。

2. **`switch` 的 `initValue` 必须是字符串**
   `"true"` 可以，JSON 布尔 `true` 会失败，而且 fnpack 把错误报成
   `File "config" is not valid`——实际出问题的是 `wizard/install`。
   `scripts/pack.mjs` 打包前会自动纠正。

3. **`config/resource` 的 `data-share` name 不能带连字符**
   本应用不需要共享目录，直接用 `{}`。

4. **`appname` 可以带连字符**，`3d-games` 实测可用。

5. **Node 找 `node_modules` 是从被 import 的文件位置向上找**
   坦克产物 external 了 `ws`，所以 `ws` 必须同时放在
   `server/node_modules/` 与 `www/games/tank/server/node_modules/`。
   只放一处时坦克会报 `Cannot find package 'ws'`，其余 6 个游戏不受影响
   （这是有意的降级：坦克挂不上不该拖垮其它游戏）。

6. **Windows 打 Linux 包的两个坑**
   GNU tar 会把 `D:\...` 的冒号当远程主机（要 `--force-local`）；
   NTFS 不保留执行位（脚本解到 Linux 变 644，fnOS 调 `cmd/main` 直接
   Permission denied）。解法是用 Python 的 `tarfile` 逐成员写 mode。

7. **`ssh-run.ps1` 有正文体积上限**
   实测脚本超过约 10～60 KB 后，pwsh 里 `& ssh ...` 会报
   `StandardErrorEncoding is only supported when standard error is redirected`。
   传大文件改用 `scripts/ssh-put.sh`（base64 经 stdin 直喂远端 `base64 -d`）。

8. **不能对同一个 `http.Server` 调两次 `listen()`**
   端口与网关 socket 是两个地址，必须建两个 Server 实例共享同一套请求处理。

## 卸载

```bash
sudo appcenter-cli uninstall 3d-games
```

`cmd/uninstall_init` 会先停服务并清掉 `app.sock`（留着会让下次安装绑不上）。
不动玩家数据 —— 最高分与进度都在浏览器的 localStorage 里，不在 NAS 上。

## 回滚

旧版本的 fpk 留在 NAS `/home/panyunmeng/3dgames-build/build/3d-games/`。
回滚就是卸载当前版本、装回旧 fpk。本仓库用 git 管版本，任何时候
`git checkout <旧提交> && node scripts/pack.mjs && node scripts/deploy.mjs`
都能重建出当时的包。
