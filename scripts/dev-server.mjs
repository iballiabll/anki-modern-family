/**
 * 本机预览服务器：`npm run dev`。
 *
 * 直接复用 scripts/static-core.mjs，所以本地行为和自建服务器（server.mjs）
 * 完全一致，包括 /api/ 账号接口。这里的默认口令和密钥只为方便本地调试，
 * 线上必须走 server.mjs 并显式提供 SESSION_SECRET。
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.APP_USERNAME ||= "iball";
process.env.SESSION_SECRET ||= "local-preview-secret";

const { createRequestListener } = await import("./static-core.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4175);
const host = process.env.HOST || "127.0.0.1";

const server = http.createServer(
  createRequestListener({ root, host, compress: false }),
);

server.listen(port, host, () => {
  console.log(`Local preview: http://${host}:${port}/`);
  console.log(
    `账号数据目录：${process.env.DATA_DIR || path.join(root, "work", "data")}`,
  );
});
