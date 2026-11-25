import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(""));
  });
}

function handleApiRoute(pathname, searchParams, req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  if (pathname === "/api/save-ok") {
    sendJson(res, 200, { ok: true, success: true, message: "Đã lưu thành công" });
    return true;
  }

  if (pathname === "/api/save-slow") {
    const delayMs = Number(searchParams.get("delayMs")) || 400;
    const timer = setTimeout(() => {
      if (!res.writableEnded) {
        sendJson(res, 200, { ok: true, success: true, delayMs, message: "Đã lưu thành công (slow)" });
      }
    }, delayMs);
    timer.unref?.();
    return true;
  }

  if (pathname === "/api/save-http200-error") {
    sendJson(res, 200, { ok: false, error: "Dữ liệu không hợp lệ" });
    return true;
  }

  if (pathname === "/api/save-422") {
    sendJson(res, 422, {
      ok: false,
      error: "Dữ liệu đầu vào không hợp lệ",
      errors: ["Trường bắt buộc chưa nhập"],
    });
    return true;
  }

  if (pathname === "/api/save-500") {
    sendJson(res, 500, { ok: false, error: "Lỗi máy chủ nội bộ" });
    return true;
  }

  if (pathname === "/api/auth-401") {
    sendJson(res, 401, { ok: false, error: "Phiên đăng nhập đã hết hạn" });
    return true;
  }

  if (pathname === "/api/auth-403") {
    sendJson(res, 403, { ok: false, error: "Không có quyền truy cập" });
    return true;
  }

  if (pathname === "/api/optimistic-rollback") {
    const delayMs = Number(searchParams.get("delayMs")) || 300;
    const timer = setTimeout(() => {
      if (!res.writableEnded) {
        sendJson(res, 500, { ok: false, error: "Lưu thất bại, hoàn tác trạng thái" });
      }
    }, delayMs);
    timer.unref?.();
    return true;
  }

  if (pathname === "/api/no-content" || pathname === "/api/204") {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

function handleStaticRoute(pathname, res) {
  if (pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/login") {
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Login</title></head><body><h1>Đăng nhập</h1><form><input id="username" placeholder="Username"/><button type="submit">Đăng nhập</button></form></body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const relativePath = pathname === "/" ? "ui-traps.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(FIXTURES_DIR, relativePath);

  if (!resolved.startsWith(FIXTURES_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(resolved);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Cache-Control": "no-store",
  });
  res.end(content);
}

/**
 * Khởi động local HTTP fixture server trên 127.0.0.1 với port động (mặc định 0).
 */
export async function startFixtureServer({ port = 0, host = "127.0.0.1" } = {}) {
  const sockets = new Set();

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${host}`);
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      await readRequestBody(req);
    }

    if (handleApiRoute(reqUrl.pathname, reqUrl.searchParams, req, res)) {
      return;
    }

    handleStaticRoute(reqUrl.pathname, res);
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${boundPort}`;

  const close = async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  };

  return { server, port: boundPort, url, close };
}
