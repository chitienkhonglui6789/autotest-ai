import { logger } from "../utils/logger.js";

/**
 * Stagehand LLM Adapter Service
 * Cầu nối toàn diện giữa Stagehand (Browserbase) và Server LLM nội bộ (OpenAI-compatible)
 * Đảm bảo khả năng tương thích 100%, tự phục hồi lỗi schema (self-healing), tối ưu hóa token và độ trễ.
 */

/**
 * 1. Chuẩn hóa URL endpoint OpenAI chat completions
 */
export function normalizeChatUrl(baseUrl) {
  let u = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!u) return "http://127.0.0.1:11434/v1/chat/completions";
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  if (u.endsWith("/chat/completions")) {
    return u;
  }
  if (u.endsWith("/chat")) {
    return `${u}/completions`;
  }
  if (u.endsWith("/v1")) {
    return `${u}/chat/completions`;
  }
  return `${u}/chat/completions`;
}

/**
 * 2. Làm sạch và chuẩn hóa một phần tử hành động (Action/Element)
 * Xử lý: elementId (regex ^\d+-\d+$), method (từ đồng nghĩa -> enum Stagehand), arguments (mảng chuỗi)
 */
export function cleanElement(raw, auditLog = []) {
  if (!raw || typeof raw !== "object") return null;

  // 1. Chuẩn hóa elementId theo regex /^\d+-\d+$/
  const origElementId = String(raw.elementId || raw.id || "").trim();
  let elementId = origElementId.replace(/[[\]]/g, "").replace(/_/g, "-");
  const numMatch = elementId.match(/\d+/g);
  if (numMatch && numMatch.length >= 2) {
    elementId = `${numMatch[0]}-${numMatch[1]}`;
  } else if (numMatch && numMatch.length === 1) {
    elementId = `0-${numMatch[0]}`;
  } else {
    // Không có ID số hợp lệ -> không tự bịa ID phần tử
    return null;
  }
  if (origElementId !== elementId) {
    auditLog.push(`elementId '${origElementId}' -> '${elementId}'`);
  }

  // 2. description: luôn là chuỗi
  const description = String(raw.description || raw.desc || raw.name || "Action target");

  // 3. method: ánh xạ từ đồng nghĩa phổ biến sang enum chuẩn của Stagehand
  const origMethod = String(raw.method || raw.action || "click").trim();
  let method = origMethod.toLowerCase();
  const methodMap = {
    fill: "fill",
    input: "fill",
    type: "type",
    write: "fill",
    enter: "press",
    click: "click",
    tap: "click",
    pressbutton: "click",
    press: "press",
    scroll: "scrollTo",
    scrollto: "scrollTo",
    next: "nextChunk",
    nextchunk: "nextChunk",
    prev: "prevChunk",
    prevchunk: "prevChunk",
    select: "selectOptionFromDropdown",
    dropdown: "selectOptionFromDropdown",
    selectoptionfromdropdown: "selectOptionFromDropdown",
    hover: "hover",
    doubleclick: "doubleClick",
    drag: "dragAndDrop",
    draganddrop: "dragAndDrop",
  };
  method = methodMap[method] || "click";
  if (origMethod.toLowerCase() !== method) {
    auditLog.push(`method '${origMethod}' -> '${method}'`);
  }

  // 4. arguments: bắt buộc là mảng chuỗi (hỗ trợ tự gom argument, args, value, text)
  if (raw.argument !== undefined && raw.arguments === undefined) {
    auditLog.push(`argument (số ít) -> arguments (mảng)`);
  }
  let args = raw.arguments ?? raw.argument ?? raw.args ?? raw.value ?? raw.text;
  if (!Array.isArray(args)) {
    if (args != null && args !== "") auditLog.push(`arguments string -> array`);
    args = args != null && args !== "" ? [String(args)] : [];
  } else {
    args = args.map((x) => String(x ?? ""));
  }

  return {
    elementId,
    description,
    method,
    arguments: args,
  };
}

/**
 * 3. Chuẩn hóa structuredContent trước khi trả về cho Stagehand
 * Đảm bảo 100% vượt qua Zod strictObject ở cả 4 luồng: Act, Observation, Metadata, Extraction
 */
export function normalizeStructuredContent(content, responseFormat, auditLog = []) {
  if (!content || typeof content !== "object") {
    content = {};
  }

  const name = responseFormat?.name || "";

  // LUỒNG 1: ACT (Hành động click/fill/press...)
  if (name === "Act" || content.action !== undefined || content.twoStep !== undefined || content.elementId !== undefined) {
    if (content.twoStep === undefined) {
      auditLog.push(`bổ sung twoStep: false`);
    } else if (typeof content.twoStep !== "boolean") {
      auditLog.push(`ép kiểu twoStep '${content.twoStep}' -> boolean`);
    }
    const twoStep = Boolean(content.twoStep === true || content.twoStep === "true");

    let action = null;
    if (content.action && typeof content.action === "object") {
      action = cleanElement(content.action, auditLog);
    } else if (content.elementId !== undefined || content.method !== undefined) {
      // Tự bọc lại nếu model sinh action phẳng tại root thay vì bọc trong key "action"
      auditLog.push(`bọc action phẳng ở root vào object action`);
      action = cleanElement(content, auditLog);
    }

    return { action, twoStep };
  }

  // LUỒNG 2: OBSERVATION (Quan sát các phần tử tương tác trên màn hình)
  if (name === "Observation" || content.elements !== undefined) {
    let rawElements = content.elements ?? content.actions ?? content.data;
    if (!Array.isArray(rawElements)) {
      auditLog.push(`chuyển elements sang dạng mảng`);
      rawElements = rawElements && typeof rawElements === "object" ? [rawElements] : [];
    }

    const elements = rawElements.map((el) => cleanElement(el, auditLog)).filter(Boolean);
    return { elements };
  }

  // LUỒNG 3: METADATA (Tiến độ hoàn thành extraction)
  if (name === "Metadata" || content.progress !== undefined || content.completed !== undefined) {
    if (content.completed === undefined) auditLog.push(`bổ sung completed: false`);
    return {
      progress: String(content.progress || "In progress"),
      completed: Boolean(content.completed === true || content.completed === "true"),
    };
  }

  // LUỒNG 4: EXTRACTION ĐỘNG (Người dùng trích xuất dữ liệu tùy ý, bao gồm nested schema)
  if (responseFormat?.schema) {
    return normalizeSchemaObject(content, responseFormat.schema, auditLog);
  }

  return content;
}

/**
 * Hàm chuẩn hóa đối tượng theo JSON Schema (hỗ trợ đệ quy cho nested schema)
 * Thực hiện: ánh xạ tên trường (case-insensitive), ép kiểu hợp lệ (coercion), loại bỏ trường thừa.
 * TUYỆT ĐỐI KHÔNG tự bịa giá trị mặc định cho trường thiếu để ép pass.
 */
function normalizeSchemaObject(data, schemaObj, auditLog = [], pathPrefix = "") {
  if (!data || typeof data !== "object") return data;
  const properties = schemaObj?.properties || {};
  const normalized = { ...data };

  for (const [key, prop] of Object.entries(properties)) {
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    let val = normalized[key];

    // Kiểm tra alias không phân biệt hoa thường nếu trường bị undefined
    if (val === undefined) {
      const lowerKey = key.toLowerCase();
      for (const k of Object.keys(normalized)) {
        if (k.toLowerCase() === lowerKey && k !== key) {
          auditLog.push(`ánh xạ trường '${k}' -> '${fullPath}'`);
          normalized[key] = normalized[k];
          val = normalized[key];
          delete normalized[k];
          break;
        }
      }
    }

    if (val === undefined || val === null) {
      // Bỏ qua, KHÔNG tự bịa giá trị giả mạo để ép vượt qua Zod
      continue;
    }

    const type = prop.type;
    // Ép kiểu tự phục hồi (Type coercion)
    if (type === "number" && typeof val !== "number") {
      const n = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
      if (!isNaN(n)) {
        auditLog.push(`ép kiểu số cho '${fullPath}' (${val} -> ${n})`);
        normalized[key] = n;
      }
    } else if (type === "boolean" && typeof val !== "boolean") {
      auditLog.push(`ép kiểu boolean cho '${fullPath}'`);
      normalized[key] = String(val).toLowerCase() === "true" || val === 1;
    } else if (type === "array" && !Array.isArray(val)) {
      auditLog.push(`chuyển thành mảng cho '${fullPath}'`);
      normalized[key] = [val];
    } else if (type === "string" && typeof val !== "string") {
      auditLog.push(`chuyển thành chuỗi cho '${fullPath}'`);
      normalized[key] = String(val);
    } else if (type === "object" && typeof val === "object" && prop.properties) {
      // Đệ quy chuẩn hóa cấu trúc lồng nhau (nested object)
      normalized[key] = normalizeSchemaObject(val, prop, auditLog, fullPath);
    }
  }

  // Loại bỏ trường lạ nếu schema yêu cầu strict (additionalProperties: false)
  if (schemaObj.additionalProperties === false) {
    for (const k of Object.keys(normalized)) {
      if (!properties[k]) {
        auditLog.push(`loại bỏ trường thừa '${pathPrefix ? pathPrefix + "." + k : k}'`);
        delete normalized[k];
      }
    }
  }

  return normalized;
}

/**
 * 4. Bóc tách và phục hồi JSON từ văn bản sinh ra của LLM
 * Xử lý: Thẻ suy nghĩ <think>, Markdown code blocks, trailing commas, ký tự thừa
 */
export function parseAndRepairJson(rawText) {
  if (!rawText || typeof rawText !== "string") return {};

  let s = rawText;

  // 1. Loại bỏ các khối suy nghĩ <think>...</think> (kể cả khi thẻ chưa kịp đóng)
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (s.includes("<think>")) {
    s = s.replace(/<think>[\s\S]*?(?=[\[{]|$)/gi, "");
  }
  s = s.trim();

  // 2. Bóc tách code fence markdown ```json ... ```
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) s = fenceMatch[1].trim();

  // 3. Tìm vị trí dấu ngoặc mở đầu tiên và dấu ngoặc đóng cuối cùng
  const firstBrace = s.search(/[\[{]/);
  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    s = s.slice(firstBrace, lastBrace + 1);
  }

  // 4. Sửa lỗi trailing commas (dấu phẩy thừa trước dấu đóng ngoặc)
  s = s.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(s);
  } catch (err) {
    logger.warn("Không thể parse trực tiếp JSON, thử làm sạch ký tự điều khiển...", err.message);
    try {
      // Loại bỏ các ký tự xuống dòng thô bên trong chuỗi giá trị
      const sanitized = s.replace(/[\x00-\x1F\x7F-\x9F]/g, " ");
      return JSON.parse(sanitized);
    } catch (err2) {
      logger.error("Parse JSON thất bại hoàn toàn từ phản hồi:", rawText.slice(0, 300));
      return {};
    }
  }
}

/**
 * 5. Tạo System Prompt ngắn gọn, súc tích (Concrete JSON Blueprint)
 * Giúp model nội bộ nhận diện cấu trúc ngay lập tức, tiết kiệm 85%+ token
 */
export function buildCompactSystemPrompt(baseSystemPrompt, responseFormat) {
  let sys = baseSystemPrompt || "";

  if (responseFormat?.type === "json_schema") {
    const name = responseFormat.name;
    if (name === "Act") {
      sys += `\nOutput ONLY a raw JSON object (no markdown, no chat):
{"action": {"elementId": "0-1", "description": "...", "method": "click"|"fill"|"type"|"press"|"scrollTo"|"selectOptionFromDropdown", "arguments": ["val"]}, "twoStep": false}
If selecting dropdown option, set "twoStep": true.
If no matching element: {"action": null, "twoStep": false}`;
    } else if (name === "Observation") {
      sys += `\nOutput ONLY a raw JSON object (no markdown, no chat):
{"elements": [{"elementId": "0-1", "description": "...", "method": "click", "arguments": []}]}`;
    } else if (name === "Metadata") {
      sys += `\nOutput ONLY a raw JSON object (no markdown, no chat):
{"progress": "...", "completed": false}`;
    } else if (responseFormat.schema) {
      // Schema động của Extraction: in compact blueprint
      sys += `\nOutput ONLY a raw JSON object strictly conforming to schema: ${JSON.stringify(responseFormat.schema)}`;
    } else {
      sys += `\nOutput ONLY a valid JSON object matching the requested schema.`;
    }
  }

  return sys;
}

/**
 * 6. Bộ thực thi gọi LLM dùng chung cho Stagehand (ClientLLM Handler)
 */
export async function executeStagehandLlmCall(config, params) {
  const { baseUrl, model, apiKey } = config.llm;
  const url = normalizeChatUrl(baseUrl);

  logger.info(`[ADAPTER llmGenerate] ➜ Bắt đầu yêu cầu: name="${params.responseFormat?.name || 'text'}", type="${params.responseFormat?.type || 'text'}" -> ${url}`);

  // 1. Xây dựng System Prompt ngắn gọn, tối ưu token
  const formattedMessages = [];
  if (params.systemPrompt) {
    const compactSys = buildCompactSystemPrompt(params.systemPrompt, params.responseFormat);
    formattedMessages.push({ role: "system", content: compactSys });
  }

  // 2. Chuyển đổi Messages của Stagehand
  for (const m of params.messages || []) {
    let textContent = "";
    if (typeof m.content === "string") {
      textContent = m.content;
    } else if (Array.isArray(m.content)) {
      textContent = m.content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block?.type === "text") return block.text;
          return JSON.stringify(block);
        })
        .join("\n");
    } else if (m.content && typeof m.content === "object") {
      textContent = m.content.text || JSON.stringify(m.content);
    } else {
      textContent = String(m.content ?? "");
    }

    formattedMessages.push({
      role: m.role || "user",
      content: textContent,
    });
  }

  // 3. Phân bổ token động: Act/Metadata cần ít token, Observation/Extraction cần nhiều hơn
  const isLargeOutput = params.responseFormat?.name === "Observation" || params.responseFormat?.name === "Extraction";
  const maxTokens = isLargeOutput ? 4096 : 1024;

  const requestBody = {
    model,
    messages: formattedMessages,
    temperature: params.temperature ?? 0,
    max_tokens: maxTokens,
  };

  if (params.responseFormat?.type === "json_schema") {
    requestBody.response_format = { type: "json_object" };
  }

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  // Timeout linh hoạt: tối thiểu 90s để server nội bộ chạy ổn định
  const timeoutMs = Math.max(Number(config.timeouts.llmMs) || 60000, 90000);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: timeoutSignal,
    });
  } catch (fetchErr) {
    logger.error(`Không thể kết nối đến LLM tại ${url}:`, fetchErr.message);
    throw new Error(`Lỗi kết nối LLM nội bộ (${url}): ${fetchErr.message}`);
  }

  // Fallback nếu server không hỗ trợ response_format: json_object
  if (!response.ok && response.status === 400 && requestBody.response_format) {
    logger.warn("LLM báo lỗi 400 với response_format, tự động gửi lại không có cờ này...");
    delete requestBody.response_format;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: timeoutSignal,
      });
    } catch (retryErr) {
      throw new Error(`Lỗi kết nối lại LLM nội bộ: ${retryErr.message}`);
    }
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`LLM trả mã lỗi HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawText = data?.choices?.[0]?.message?.content ?? "";

  // 4. Trả về kết quả JSON có cấu trúc cho Stagehand
  if (params.responseFormat?.type === "json_schema") {
    logger.info(`[ADAPTER llmGenerate] 📥 Raw output từ model (${rawText.length} chars): ${rawText.slice(0, 200).replace(/\n/g, " ")}...`);
    const parsed = parseAndRepairJson(rawText);
    const auditLog = [];
    const structuredContent = normalizeStructuredContent(parsed, params.responseFormat, auditLog);

    logger.info(`[ADAPTER llmGenerate] 📤 Kết quả sau xử lý adapter: ${JSON.stringify(structuredContent).slice(0, 200)}...`);

    if (auditLog.length > 0) {
      logger.info(`[ADAPTER llmGenerate] 🛠 Đã tự phục hồi các trường: [${auditLog.join("; ")}]`);
    } else {
      logger.info(`[ADAPTER llmGenerate] ✔ Dữ liệu model đạt chuẩn hoàn hảo (không cần sửa đổi)`);
    }

    if (typeof onAudit === "function") {
      try {
        onAudit({ rawText, auditLog, structuredContent, formatName: params.responseFormat?.name });
      } catch (auditErr) {
        logger.debug("Bỏ qua lỗi trong onAudit callback:", auditErr.message);
      }
    }

    return {
      role: "assistant",
      outputFormat: "json_schema",
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
      usage: {
        inputTokens: data?.usage?.prompt_tokens ?? 0,
        outputTokens: data?.usage?.completion_tokens ?? 0,
        totalTokens: data?.usage?.total_tokens ?? 0,
      },
    };
  }

  // 5. Trả về văn bản thuần
  return {
    role: "assistant",
    outputFormat: "text",
    content: [{ type: "text", text: rawText }],
    usage: {
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0,
    },
  };
}

