/**
 * 静态站点 + api/ 目录的请求处理核心。
 *
 * 本地 `npm run dev`（scripts/dev-server.mjs）和自建服务器
 * （server.mjs）共用同一套逻辑，保证本机预览和线上行为一致：
 *   · 目录穿越防护、Range 断点请求、ETag/304；
 *   · `?v=` 版本号资源长缓存，其余资源协商缓存；
 *   · /api/xxx 映射到 api/xxx.js，按 Vercel 的 req/res 形状调用。
 */

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

const gzip = promisify(zlib.gzip);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".srt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const COMPRESSIBLE = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".webmanifest",
]);

const MIN_COMPRESS_BYTES = 1200;

/**
 * 一律不做静态分发的路径。开发服务器直接以仓库根目录为站点根，如果不挡这些，
 * `/work/data/users.json`（含口令散列）、`/.git/`、`/api/auth.js` 源码都能被
 * 直接下载。正式服务器只发布 public/，这里是第二道防线。
 */
const PRIVATE_PATHS = [
  "/api/",
  "/.git/",
  "/.github/",
  "/.cache/",
  "/node_modules/",
  "/scripts/",
  "/deploy/",
  "/work/",
];

const PRIVATE_FILES = new Set([
  "/cname",
  "/package-lock.json",
  "/package.json",
  "/readme.md",
  "/server.mjs",
  "/vercel.json",
]);

function isPrivatePath(pathname) {
  const lower = pathname.toLowerCase();
  if (PRIVATE_FILES.has(lower)) {
    return true;
  }
  // 顶层点文件（.gitignore、.env 之类）永远不对外
  if (lower.startsWith("/.")) {
    // certbot 的校验目录必须放行，否则签证书会失败
    return !lower.startsWith("/.well-known/");
  }
  return PRIVATE_PATHS.some(
    (prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix),
  );
}

export function createRequestListener({
  root,
  apiRoot = root,
  host = "127.0.0.1",
  compress = false,
  headers: extraHeaders = {},
  logError = console.error,
} = {}) {
  if (!root) {
    throw new Error("createRequestListener 需要 root 参数");
  }

  const rootDir = path.resolve(root);
  const apiRootDir = path.resolve(apiRoot);

  function resolveIn(baseDir, pathname) {
    const resolved = path.resolve(baseDir, `.${pathname}`);
    return resolved === baseDir || resolved.startsWith(`${baseDir}${path.sep}`)
      ? resolved
      : null;
  }

  function safePathname(url) {
    const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
    return pathname === "/" ? "/index.html" : pathname;
  }

  function resolveWithinRoot(pathname) {
    return resolveIn(rootDir, pathname);
  }

  async function readRequestBody(request) {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  function createResponse(response) {
    const result = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        result.headers[String(name).toLowerCase()] = value;
        return result;
      },
      status(code) {
        result.statusCode = code;
        return result;
      },
      send(body) {
        if (!result.headers["content-type"]) {
          result.headers["content-type"] = "text/plain; charset=utf-8";
        }
        response.writeHead(result.statusCode, result.headers);
        response.end(body);
      },
      json(body) {
        result.headers["content-type"] = "application/json; charset=utf-8";
        result.send(JSON.stringify(body));
      },
    };
    return result;
  }

  async function runApi(request, response, pathname) {
    // api/_user-store.js 这类以下划线开头的是内部模块，不能被当成接口调用。
    const apiName = pathname.slice("/api/".length);
    if (apiName.startsWith("_")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return true;
    }

    const apiPath = resolveIn(apiRootDir, `${pathname}.js`);
    if (!apiPath) {
      return false;
    }

    try {
      const file = await stat(apiPath);
      if (!file.isFile()) {
        return false;
      }
    } catch {
      return false;
    }

    const moduleUrl = `${pathToFileURL(apiPath).href}?t=${Date.now()}`;
    const handlerModule = await import(moduleUrl);
    const handler = handlerModule.default || handlerModule;
    if (typeof handler !== "function") {
      throw new Error(`${pathname} 没有导出请求处理函数`);
    }

    const url = new URL(request.url, `http://${host}`);
    const query = Object.fromEntries(url.searchParams.entries());
    const rawBody = await readRequestBody(request);
    const apiRequest = {
      body: rawBody || undefined,
      headers: request.headers,
      method: request.method,
      query,
      socket: request.socket,
      url: request.url,
    };
    await handler(apiRequest, createResponse(response));
    return true;
  }

  async function serveStatic(request, response, pathname) {
    if (isPrivatePath(pathname)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    let filePath = resolveWithinRoot(pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    let info;
    try {
      info = await stat(filePath);
      if (info.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        info = await stat(filePath);
      }
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    try {
      const extension = path.extname(filePath).toLowerCase();
      const contentType =
        MIME_TYPES[extension] || "application/octet-stream";
      // 和线上保持一致：带 ?v= 的内容哈希地址长缓存，其余用 ETag 协商。
      const versioned = new URL(request.url, `http://${host}`).searchParams.has(
        "v",
      );
      const etag = `W/"${info.size}-${Math.floor(info.mtimeMs).toString(36)}"`;
      const headers = {
        ...extraHeaders,
        "accept-ranges": "bytes",
        etag,
        "cache-control": versioned
          ? "public, max-age=31536000, immutable"
          : "no-cache",
        "content-type": contentType,
      };

      if (!versioned && request.headers["if-none-match"] === etag) {
        response.writeHead(304, headers);
        response.end();
        return;
      }

      // 音频雪碧图要拖动进度条，必须支持 Range，和静态托管行为一致。
      const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || "");
      if (rangeMatch && (rangeMatch[1] || rangeMatch[2])) {
        const suffixLength = rangeMatch[1] ? 0 : Number(rangeMatch[2]);
        const start = suffixLength
          ? Math.max(0, info.size - suffixLength)
          : Number(rangeMatch[1]);
        const requestedEnd = rangeMatch[2]
          ? Number(rangeMatch[2])
          : info.size - 1;
        const end = Math.min(requestedEnd, info.size - 1);
        if (start >= info.size || start > end) {
          response.writeHead(416, {
            ...headers,
            "content-range": `bytes */${info.size}`,
          });
          response.end();
          return;
        }
        response.writeHead(206, {
          ...headers,
          "content-range": `bytes ${start}-${end}/${info.size}`,
          "content-length": end - start + 1,
        });
        createReadStream(filePath, { start, end }).pipe(response);
        return;
      }

      const body = await readFile(filePath);
      const acceptsGzip =
        compress &&
        info.size >= MIN_COMPRESS_BYTES &&
        COMPRESSIBLE.has(extension) &&
        String(request.headers["accept-encoding"] || "").includes("gzip");

      if (acceptsGzip) {
        const compressed = await gzip(body);
        headers["content-encoding"] = "gzip";
        headers.vary = "Accept-Encoding";
        headers["content-length"] = compressed.length;
        response.writeHead(200, headers);
        response.end(compressed);
        return;
      }

      headers["content-length"] = info.size;
      response.writeHead(200, headers);
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
    }
  }

  return async function handleRequest(request, response) {
    const pathname = safePathname(request.url);

    if (pathname === "/healthz") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
      return;
    }

    try {
      if (
        pathname.startsWith("/api/") &&
        (await runApi(request, response, pathname))
      ) {
        return;
      }
      await serveStatic(request, response, pathname);
    } catch (error) {
      logError(error);
      if (!response.headersSent) {
        response.writeHead(500, {
          "content-type": "application/json; charset=utf-8",
        });
      }
      response.end(
        JSON.stringify({ ok: false, message: error.message || "服务器内部错误" }),
      );
    }
  };
}

export const MIME_TYPES_BY_EXTENSION = MIME_TYPES;
