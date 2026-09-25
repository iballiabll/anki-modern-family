/**
 * 自建服务器（搬瓦工等 VPS）的生产入口。
 *
 *   node server.mjs            # 默认 127.0.0.1:4175，由 Nginx 反向代理
 *
 * 与 Vercel 的差别只有一处：这里能往磁盘写账号文件，所以真实注册 / 登录
 * 只在自建服务器上生效。Vercel 上同名接口会因文件系统只读而返回错误，
 * 前端会退化成静态浏览 + localStorage 进度。
 *
 * 环境变量：
 *   HOST / PORT            监听地址，默认 127.0.0.1:4175
 *   SESSION_SECRET         必填，签名登录 Cookie；缺省直接启动失败
 *   DATA_DIR               账号文件目录，默认 work/data
 *   APP_USERNAME           站长账号，默认 iball
 *   ADMIN_USERNAME         管理台账号名，默认取 APP_USERNAME，再退到 iball
 *   APP_PASSWORD_SHA256    站长口令的 SHA-256（不设则用仓库内置值）
 *   REGISTRATION_ENABLED   是否开放注册，默认 true
 *   REGISTRATION_CODE      可选邀请码（也可在 /admin.html 里直接改，无需重启）
 *   MAX_USERS              账号上限，默认 20
 */

import http from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRequestListener } from "./scripts/static-core.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
// 静态资源只发布 public/，仓库其余部分（.git、deploy、work）不进 Web 根目录，
// 避免账号文件和源码被直接下载。api/ 仍然从仓库根目录解析。
const publicRoot = path.join(appRoot, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4175);

if (!existsSync(path.join(publicRoot, "index.html"))) {
  console.error(
    [
      "启动失败：没有找到 public/index.html。",
      "先执行一次构建：npm run build",
    ].join("\n"),
  );
  process.exit(1);
}

const secret = String(process.env.SESSION_SECRET || "").trim();
if (!secret || secret === "local-preview-secret") {
  console.error(
    [
      "启动失败：必须设置 SESSION_SECRET，否则任何人都能伪造登录 Cookie。",
      "生成一个：openssl rand -base64 48",
      "然后写进 /etc/iball-cabin.env（见 deploy/iball-cabin.env.example）。",
    ].join("\n"),
  );
  process.exit(1);
}

const extraHeaders = {
  // 站点自身只通过 Nginx 暴露 443，这里补一层安全响应头。
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
};

const server = http.createServer(
  createRequestListener({
    root: publicRoot,
    apiRoot: appRoot,
    host,
    compress: true,
    headers: extraHeaders,
  }),
);

server.listen(port, host, () => {
  console.log(`iball-cabin listening on http://${host}:${port}/`);
  console.log(`站点根目录：${publicRoot}`);
  console.log(
    `账号数据目录：${process.env.DATA_DIR || path.join(appRoot, "work", "data")}`,
  );
});

// systemd 停止服务时先关掉监听，再等在途请求收尾。
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
