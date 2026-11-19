# Git 远端配置（单仓库 + 双远端）

> 2026-11-19 实测。这台机器上推 GitHub 有几个坑，记下来免得每次重查。

## 现状

| 远端 | 地址 | 可见性 | 备注 |
| --- | --- | --- | --- |
| `origin` | `http://panyunmeng.cn:3000/panyunmeng/3d-games.git` | 私有 | Gitea，主仓库 |
| `github` | `https://github.com/panyunmeng/3d-games.git` | 公开 | 走直连，见下 |

旧的 8 个仓库（`3d-game-collection`、`3d-jingdian-tanchishe` …）已在 Gitea
归档为只读，只作历史存档。

## 坑 1：`~/.gitconfig` 的 insteadOf 会把 GitHub 改写到 gh-proxy

机器上有这条：

```ini
[url "https://gh-proxy.com/https://github.com/"]
    insteadOf = https://github.com/
```

后果：任何 `https://github.com/...` 都会被改写成 `https://gh-proxy.com/https://github.com/...`。
而 **gh-proxy 那条凭据已失效**（`Bad credentials`），于是 push 报：

```
remote: Invalid username or token. Password authentication is not supported for Git operations.
```

注意错误里的 URL 是 `gh-proxy.com/...` —— 看到这句就说明是被改写了，不是 token 本身坏。

## 坑 2：加速器阻断 CRL 查询，schannel 默认会拒连

本机跑着 Steam++（`Steam++.Accelerator.exe`，监听 443 做本地加速）。直连
github.com 时 Git 用 Windows schannel，报：

```
schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012)
```

这不是「证书不受信任」，是**查不到证书吊销列表**（代理把 CRL 请求挡了）。
关掉撤销检查即可，证书链仍然验证：

```bash
git -c http.schannelCheckRevoke=false ...
```

## 正确的推法

用「带用户名的 URL」绕过 insteadOf：`https://github.com/` 这个前缀不匹配
`https://panyunmeng@github.com/`，所以不会被改写，凭据也从 `host=github.com`
那条取（那条是有效的）。

```bash
cd "/d/MyProjects/X.AIProjects/3D游戏合集"

# 一次性配置：只对 github.com 关撤销检查，不影响别的站点
git config http."https://github.com/".schannelCheckRevoke false

# 推（URL 带用户名）
git push https://panyunmeng@github.com/panyunmeng/3d-games.git main
```

## 凭据现状（2026-11-19 核实）

| host | username | 状态 |
| --- | --- | --- |
| `github.com` | `panyunmeng` | **有效**（`GET /user` 200，账号 `panyunmeng`） |
| `gh-proxy.com` | `1242653505@qq.com` | **失效**（`Bad credentials`） |

要修 gh-proxy 那条，否则别的项目走 insteadOf 时同样会挂。
或者把 insteadOf 删掉（现在有加速器，直连可用）。

## 其它事实

- `github.com` / `api.github.com` 直连**之前**不通（`000`），开加速器后通；
  `codeload.github.com` 一直通。
- `api.github.com` 如果直连失败，可以用 `https://gh-proxy.com/https://api.github.com/...` 兜底。
- 没有 `gh` CLI，建仓库走 REST API（走 gh-proxy 前缀）或网页。
