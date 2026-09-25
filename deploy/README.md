# 搬到搬瓦工（VPS）部署手册

这个站点有两种形态，同一套代码：

| 形态 | 谁提供 | 注册 / 登录 | 说明 |
| --- | --- | --- | --- |
| **主站** `server.mjs` + Nginx | 搬瓦工 VPS | 真实可用，账号写进 `DATA_DIR/users.json` | 本文档主角 |
| 静态镜像 | GitHub Pages / Vercel | 接口不存在，前端自动切「本地模式」 | 服务器挂了时的兜底，进度存浏览器 |

前端探测不到 `/api/auth`（404/502/超时）时不会白屏，会照常浏览，只是进度
落在 `localStorage`。所以 VPS 被封时，镜像站仍然能用。

---

## 0. 推荐的三层结构

```
app.iball.top    → 搬瓦工 VPS      主站，有注册登录（新账号都发这里）
www.iball.top    → Vercel          只读镜像，VPS 挂了自动顶上
iballiabll.github.io/anki-modern-family/  → GitHub Pages  最后一层兜底
```

三个入口是同一份 GitHub 仓库。所以**只要 GitHub 仓库在，网站就删不掉**。

---

## 1. 准备 VPS

搬瓦工下单时选 **Ubuntu 22.04 或 24.04**。登录后用 root 操作。

```bash
# 装 Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx git
node -v      # 应输出 v20.x

# 建运行用户和目录
useradd -r -m -d /srv/iball-cabin -s /usr/sbin/nologin iball
mkdir -p /srv/iball-cabin /var/lib/iball-cabin/data
chown -R iball:iball /var/lib/iball-cabin
```

> 仓库带音频素材，约 190 MB，`git clone` 慢一点是正常的。

```bash
cd /srv/iball-cabin
git clone https://github.com/iballiabll/anki-modern-family.git app
cd app
npm run build        # 生成 resources.json 和 public/
```

---

## 2. 配置环境变量

```bash
# 生成登录密钥（只生成一次，之后别改，改了所有人被登出）
openssl rand -base64 48

cp deploy/iball-cabin.env.example /etc/iball-cabin.env
nano /etc/iball-cabin.env      # 把 SESSION_SECRET 换成上面输出的值
chown root:iball /etc/iball-cabin.env
chmod 640 /etc/iball-cabin.env
```

想改站长密码（默认是仓库里那个旧口令）：

```bash
printf '%s' '你的新密码' | sha256sum | cut -d' ' -f1
# 把结果填到 /etc/iball-cabin.env 的 APP_PASSWORD_SHA256=
```

只想给同学用、不想公开注册：把 `REGISTRATION_ENABLED=true` 改成
`false`，或者设一个 `REGISTRATION_CODE=你的邀请码`。

---

## 3. 起服务

```bash
cp /srv/iball-cabin/app/deploy/iball-cabin.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now iball-cabin
systemctl status iball-cabin --no-pager

# 应该返回 {"ok":true,...}
curl -s http://127.0.0.1:4175/healthz
```

如果启动失败，看日志：

```bash
journalctl -u iball-cabin -n 50 --no-pager
```

---

## 4. Nginx + HTTPS

```bash
cp /srv/iball-cabin/app/deploy/nginx.conf /etc/nginx/sites-available/iball-cabin
ln -sf /etc/nginx/sites-available/iball-cabin /etc/nginx/sites-enabled/iball-cabin
rm -f /etc/nginx/sites-enabled/default
```

先把 `nginx.conf` 里的 `server_name` 改成你实际要用的域名，例如
`app.iball.top`，然后：

```bash
nginx -t && systemctl reload nginx

# 申请证书（85 端口不用管，certbot 会自动改配置）
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d app.iball.top
```

证书 90 天自动续期，验证一下：

```bash
certbot renew --dry-run
```

---

## 5. 改 DNS

到域名 DNS 面板（现在是 Vercel 在管）加一条记录：

```
类型   A
名称   app
值     你的搬瓦工 IP
```

等几分钟生效，然后打开 `https://app.iball.top`，注册一个账号试试。

> 主域名 `iball.top` / `www` 建议继续留给 Vercel。这样 VPS 被封时主域名
> 还能立刻顶上，不会出现“两个一起挂”。

---

## 6. 以后怎么更新网站

```bash
cd /srv/iball-cabin/app
git pull
npm run build
systemctl restart iball-cabin
```

`public/` 是构建产物，Nginx 直接读磁盘，所以改完必须 `npm run build`。

---

## 7. 账号数据怎么备份

账号只存在一个文件里：

```bash
# 手动备份
cp /var/lib/iball-cabin/data/users.json ~/users-$(date +%F).json

# 每天自动备份，保留 14 天
cat >/etc/cron.daily/iball-cabin-backup <<'EOF'
#!/bin/sh
mkdir -p /var/backups/iball-cabin
cp /var/lib/iball-cabin/data/users.json \
   /var/backups/iball-cabin/users-$(date +%F).json
find /var/backups/iball-cabin -name 'users-*.json' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/iball-cabin-backup
```

> 这个文件**不要**提交到 GitHub：它含口令散列，公开仓库等于把所有人的
> 密码散列摆在网上。`.gitignore` 已经把 `work/` 排除掉了，线上路径
> `/var/lib/iball-cabin/data` 也在仓库之外。

---

## 8. GitHub 静态镜像（防封底牌）

仓库里已经有 `.github/workflows/backup-pages.yml`：每次 push 到 `main`
都会自动构建并把 `public/` 发到 `gh-pages` 分支。

第一次要去 GitHub 上点两下：

1. 打开 https://github.com/iballiabll/anki-modern-family/settings/pages
2. **Source** 选 `Deploy from a branch`
3. **Branch** 选 `gh-pages`、目录 `/ (root)`，保存

等 Actions 跑完，镜像地址：

```
https://iballiabll.github.io/anki-modern-family/
```

打开它应该能看到完整页面，顶栏会显示「本地模式」。这就是 VPS 被封时
你还能用的入口。

---

## 9. 排查清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面能开，但登录按钮报错 | `SESSION_SECRET` 没设 | 检查 `/etc/iball-cabin.env`，重启服务 |
| 注册提示“账号服务暂时不可用” | `DATA_DIR` 没写权限 | `chown -R iball:iball /var/lib/iball-cabin` |
| 顶栏显示「本地模式」 | 请求没到 Node | `curl https://域名/api/auth` 看返回；检查 Nginx 的 `location /api/` |
| 页面 404 | 没跑 `npm run build` | 跑一次，`public/` 必须存在 |
| 音频拖不动进度条 | Nginx 没走 Node 的 Range | 确认 `location /` 是 `try_files`，别把 `public/` 交给别的静态服务 |
| 忘记站长密码 | — | 删掉 `users.json` 里那条记录，重设 `APP_PASSWORD_SHA256` 再登录 |
