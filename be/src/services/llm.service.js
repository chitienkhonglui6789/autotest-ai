import { config } from "../config/env.js";
import { BadGatewayError } from "../errors/AppError.js";
import { logger } from "../utils/logger.js";

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

function sleepWithAbort(ms, signal) {
  if (signal?.aborted) {
    const err = new Error("Tác vụ đã bị hủy trong lúc chờ thử lại");
    err.name = "AbortError";
    return Promise.reject(err);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Tác vụ đã bị hủy trong lúc chờ thử lại");
      err.name = "AbortError";
      reject(err);
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export class LlmService {
  constructor(customConfig = config) {
    this.config = customConfig;
  }

  _resolveMaxTokens(model) {
    const configured = Number(this.config.llm?.maxTokens || 4096);
    // Các model suy luận (Qwen/DeepSeek R1/QwQ) thường tốn token cho <think>; nâng sàn tối thiểu để tránh cắt cụt JSON
    const isReasoningModel = /(?:qwen|r1|reason|think|qwq|o1|o3)/i.test(String(model || ""));
    return isReasoningModel ? Math.max(configured, 6144) : configured;
  }

  /**
   * Gửi danh sách messages đến LLM completion endpoint
   * @param {Array<{ role: string, content: string }>} messages
   * @param {AbortSignal} [clientSignal] - Tín hiệu hủy khi client ngắt kết nối
   * @returns {Promise<string>}
   */
  async chatCompletion(messages, clientSignal = null) {
    const { baseUrl, model, apiKey } = this.config.llm;
    const url = normalizeChatUrl(baseUrl);
    const maxTokens = this._resolveMaxTokens(model);

    logger.debug(`Calling LLM model "${model}" at ${url} (max_tokens=${maxTokens})`);

    const timeoutSignal = AbortSignal.timeout(this.config.timeouts.llmMs);
    const combinedSignal = clientSignal
      ? AbortSignal.any([timeoutSignal, clientSignal])
      : timeoutSignal;

    const buildRequestInit = () => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: combinedSignal,
    });

    try {
      let response = await fetch(url, buildRequestInit());

      // Tự động chờ và thử lại nếu LLM đạt giới hạn tần suất (429) hoặc tạm thời quá tải (503)
      if (!response.ok && (response.status === 429 || response.status === 503)) {
        const errBody = await response.text().catch(() => "");
        logger.warn(`LLM engine phản hồi HTTP ${response.status} (Rate limit/Quá tải), đang tự động chờ 5s để thử lại... [Chi tiết: ${errBody.slice(0, 120)}]`);
        await sleepWithAbort(5000, combinedSignal);
        response = await fetch(url, buildRequestInit());
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new BadGatewayError(
          `Model trả mã HTTP ${response.status}: ${errorText.slice(0, 300)}`
        );
      }

      const data = await response.json();

      if (data?.error) {
        const errDetail =
          typeof data.error === "string"
            ? data.error
            : data.error?.message || JSON.stringify(data.error);
        throw new BadGatewayError(`LLM phản hồi lỗi trong JSON (HTTP 200): ${String(errDetail).slice(0, 300)}`);
      }

      if (!Array.isArray(data?.choices) || data.choices.length === 0) {
        throw new BadGatewayError("LLM phản hồi JSON hợp lệ nhưng danh sách choices rỗng");
      }

      const firstChoice = data.choices[0];
      const content = firstChoice?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        const finishReason = firstChoice?.finish_reason || "unknown";
        if (finishReason === "length") {
          throw new BadGatewayError(
            `LLM chạm giới hạn max_tokens (${maxTokens}) trước khi sinh nội dung JSON (finish_reason=length)`
          );
        }
        throw new BadGatewayError(`LLM trả về nội dung message rỗng (finish_reason=${finishReason})`);
      }

      return content;
    } catch (err) {
      if (clientSignal?.aborted) {
        throw new Error("Tác vụ gọi LLM đã bị hủy do client ngắt kết nối");
      }
      if (err instanceof BadGatewayError) throw err;
      if (err.name === "TimeoutError" || timeoutSignal.aborted) {
        throw new BadGatewayError(`LLM request vượt quá thời gian chờ ${this.config.timeouts.llmMs / 1000}s`);
      }
      if (err.name === "AbortError") {
        throw new Error("Tác vụ gọi LLM đã bị hủy");
      }
      throw new BadGatewayError(`Không thể kết nối đến LLM: ${err.message}`);
    }
  }
}

export const llmService = new LlmService();

