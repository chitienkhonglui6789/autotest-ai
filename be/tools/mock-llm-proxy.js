import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Đọc API Key của Groq/LLM từ biến môi trường LLM_API_KEY nếu có
function findLlmApiKey() {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY;
  try {
    const envPaths = [
      path.resolve(__dirname, "../.env"),
      path.resolve(__dirname, "../../.env"),
    ];
    for (const p of envPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("LLM_API_KEY=")) {
            const val = trimmed.split("=")[1]?.trim();
            if (val) return val;
          }
        }
      }
    }
  } catch {}
  return "";
}

const LLM_API_KEY = findLlmApiKey();
const PORT = Number(process.env.MOCK_PORT || 4000);
const HOST = process.env.MOCK_HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || "/";
  const start = Date.now();

  // 1. Health check & Models endpoint
  if (req.method === "GET") {
    if (url === "/health" || url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "Mock Internal LLM Server (Powered by Groq)" }));
      return;
    }

    if (url.endsWith("/models") || url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: [
          { id: "qwen3.8-27b", object: "model", owned_by: "internal-mock" },
          { id: "qwen/qwen3.8-27b", object: "model", owned_by: "internal-mock" },
        ],
      }));
      return;
    }
  }

  // 2. Chat Completions endpoint (Hỗ trợ mọi biến thể: /v1/chat, /v1/chat/completions, /chat/completions)
  if (req.method === "POST" && (url.includes("/chat") || url.includes("/completions"))) {
    let bodyRaw = "";
    req.on("data", (chunk) => {
      bodyRaw += chunk;
    });

    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(bodyRaw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Invalid JSON body" } }));
        return;
      }

      const clientModel = body.model || "qwen3.8-27b";
      // Groq yêu cầu tiền tố "qwen/qwen3.8-27b"
      let groqModel = clientModel;
      if (groqModel === "qwen3.8-27b") {
        groqModel = "qwen/qwen3.8-27b";
      }

      body.model = groqModel;

      console.log(`[MOCK-LLM] ➜ POST ${url} | Model: "${clientModel}" ➔ Chuyển tiếp Groq ("${groqModel}")...`);

      try {
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}),
          },
          body: JSON.stringify(body),
        });

        const groqData = await groqRes.json();
        const duration = Date.now() - start;

        // Trả lại model name nguyên bản mà client đã yêu cầu
        if (groqData && groqData.model) {
          groqData.model = clientModel;
        }

        console.log(`[MOCK-LLM] ✔ Trả lời thành công (${groqRes.status}) trong ${duration}ms`);

        res.writeHead(groqRes.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(groqData));
      } catch (err) {
        console.error(`[MOCK-LLM] ✖ Lỗi chuyển tiếp tới Groq:`, err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: {
            message: `Mock Server không thể chuyển tiếp tới Groq: ${err.message}`,
            type: "bad_gateway",
          },
        }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: `Route ${req.method} ${url} không tồn tại` } }));
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 MOCK INTERNAL LLM SERVER ĐANG CHẠY TẠI:`);
  console.log(`👉 http://${HOST}:${PORT}`);
  console.log(`👉 Endpoint: http://${HOST}:${PORT}/v1/chat`);
  console.log(`👉 Endpoint: http://${HOST}:${PORT}/v1/chat/completions`);
  console.log(`------------------------------------------------------`);
  console.log(`💡 Cấu hình vào file .env để test như server nội bộ:`);
  console.log(`   LLM_BASE_URL=http://${HOST}:${PORT}/v1/chat`);
  console.log(`   LLM_MODEL=qwen3.8-27b`);
  console.log(`   LLM_API_KEY=test-mock-key`);
  console.log(`======================================================\n`);
});

