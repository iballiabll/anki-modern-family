import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.APP_USERNAME ||= "iball";
process.env.SESSION_SECRET ||= "local-preview-secret";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4175);
const host = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function safePathname(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
  return pathname === "/" ? "/index.html" : pathname;
}

function resolveWithinRoot(pathname) {
  const resolved = path.resolve(root, `.${pathname}`);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`)
    ? resolved
    : null;
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
  const apiPath = resolveWithinRoot(`${pathname}.js`);
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
    url: request.url,
  };
  await handler(apiRequest, createResponse(response));
  return true;
}

async function serveStatic(response, pathname, request) {
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
    const contentType =
      MIME_TYPES[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream";
    // Mirrors the deployed behaviour: content-hashed URLs stay in the browser
    // cache, everything else is revalidated with an ETag.
    const versioned = new URL(request.url, `http://${host}`).searchParams.has(
      "v",
    );
    const etag = `W/"${info.size}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const headers = {
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

    // Audio sprites are seeked by the player, so honour byte ranges the way
    // static hosting does. Without this a <audio> element cannot scrub.
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
    headers["content-length"] = info.size;
    response.writeHead(200, headers);
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = safePathname(request.url);
  try {
    if (pathname.startsWith("/api/") && (await runApi(request, response, pathname))) {
      return;
    }
    await serveStatic(response, pathname, request);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    response.end(
      JSON.stringify({ ok: false, message: error.message || "服务器内部错误" }),
    );
  }
});

server.listen(port, host, () => {
  console.log(`Local preview: http://${host}:${port}/`);
});
