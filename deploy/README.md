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

`nginx.conf` 默认就是 `server_name app.iball.top`。如果你想用别的域名，
先把它改掉，然后：

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

> **注意**：仓库根目录有个 `CNAME` 文件写着 `iball.top`。在没切换
> Source 之前，Pages 是从 `main` 构建的，`github.io` 地址会被 301
> 跳回 `iball.top`，兜底等于没用。切成 `gh-pages` 之后，`gh-pages`
> 分支里不含 CNAME，301 就会消失。

验证一下（`Location:` 那行不该再出现）：

```bash
curl -sI https://iballiabll.github.io/anki-modern-family/ | head -5
```

如果还在 301，去 Settings → Pages 把 **Custom domain** 清空再保存。
正常后打开镜像应该能看到完整页面，顶栏显示「本地模式」。这就是 VPS
被封时你还能用的入口。

---

## 9. 邀请码、找回密码和管理台

### 邀请码（只给同学用）

两种设法，**管理台优先**：

1. **管理台（推荐）**：用 `ADMIN_USERNAME` 那个账号登录 → 顶栏「管理台」→
   邀请码卡片里填一个码保存，或点「随机生成」。改完立刻生效，不用重启。
2. **环境变量**：在 `/etc/iball-cabin.env` 里设 `REGISTRATION_CODE=CABIN-XXXX`，
   然后 `systemctl restart iball-cabin`。

不设邀请码时注册框留空即可注册；设了之后邀请码不对会被挡下来。想彻底关掉
注册：`REGISTRATION_ENABLED=false`。

### 找回密码（不需要邮箱服务器）

首页点「忘记密码」→ 填账号名 → 页面会提示重置申请已提交。

**令牌只有站长能在管理台看到**，所以真实流程是：

1. 同学说忘了密码；
2. 你打开 `/admin.html` → 「重置密码申请」卡片，看到谁在什么时候申请的；
3. 点那一行的「签发令牌」，把令牌发给同学；
4. 同学在首页填「账号 + 令牌 + 新密码」提交。

令牌一次有效、30 分钟过期。本站不存明文密码，也没法把散列算回原密码，
所以没配邮件服务时这是唯一的重置路径。修改自己的密码请登录后在顶栏操作。

### 管理台 `/admin.html`

只有 `ADMIN_USERNAME` 那个账号能打开，别的账号访问会拿到 401。

| 卡片 | 内容 |
| --- | --- |
| 概览 | 账号数、在线人数、一小时/今日调用量、错误数、平均耗时 |
| 存储 | `DATA_DIR` 是否可写，不可写时红字提示 |
| 邀请码 | 当前邀请码（含环境变量兜底）、随机生成、清空 |
| 接口调用 | 最近一小时各接口调用次数排行 |
| 在线与活动 | 谁在线、最后活跃时间、当前页面 |
| 用户 | 数据体积、错词数、三个榜最好成绩、签发重置令牌 |
| 重置密码申请 | 待处理申请，签发令牌后可标记已处理 |
| 实时请求流 | 最近的请求：接口、状态码、耗时、账号 |

监控只记接口名、状态码、耗时、账号名和页面路径，**不记请求体、作文内容、
密码、API Key**；IP 只留加盐散列。事件内存里最多 2000 条 / 30 天，落盘在
`DATA_DIR/telemetry.json`。

### 账号数据是隔离的

每个账号的进度、生词本、错词、收藏以账号 ID 为前缀存在浏览器
`localStorage`（`iball:v1:<账号ID>:<键>`），并同步到服务器
`DATA_DIR/progress-<userId>.json`。旧版本那份全局数据**不会**自动并进新账号，
换账号看到的是干净进度，这是有意为之。

### 单词测试榜单

`/quiz.html` 有四张榜：四级、考研、全部、总榜。单榜取该范围的最好成绩。
总榜取**已完成范围**的平均正确率：考过一个范围就能上榜，榜上标「已考 x/3」，
综合分相同时完成范围多的排在前面（旧规则要求三榜全考才进总榜，人少时榜单
长期是空的）。答案只存在服务端 `DATA_DIR/quiz-sessions.json`，前端拿不到
正确答案，每份卷子只能交一次，所以改前端分数没用。

> 榜单按账号存在 `DATA_DIR/quiz.json`，所以**只有在能写磁盘的主站
> （VPS 上的 `server.mjs`）才会积累**。Vercel 是无状态函数，`/api/auth`
> 会返回 `storageReady:false`，那里注册不了账号，榜单自然一直是空的。
> 排查时先 `curl -s https://你的域名/api/auth` 看 `storageReady`。

---

## 10. 排查清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面能开，但登录按钮报错 | `SESSION_SECRET` 没设 | 检查 `/etc/iball-cabin.env`，重启服务 |
| 注册提示“账号服务暂时不可用” | `DATA_DIR` 没写权限 | `chown -R iball:iball /var/lib/iball-cabin` |
| 注册提示邀请码不正确 | 邀请码设了但填错 | 在 `/admin.html` 看当前邀请码，或清空它 |
| 同学忘记密码 | 本站不发邮件 | 管理台签发一次性令牌，30 分钟内用完 |
| 管理台进不去 | 登录账号不是 `ADMIN_USERNAME` | 用站长账号登录，或改 `ADMIN_USERNAME` 后重启 |
| 顶栏显示「本地模式」 | 请求没到 Node | `curl https://域名/api/auth` 看返回；检查 Nginx 的 `location /api/` |
| 页面 404 | 没跑 `npm run build` | 跑一次，`public/` 必须存在 |
| 音频拖不动进度条 | Nginx 没走 Node 的 Range | 确认 `location /` 是 `try_files`，别把 `public/` 交给别的静态服务 |
| 忘记站长密码 | — | 删掉 `users.json` 里那条记录，重设 `APP_PASSWORD_SHA256` 再登录 |
