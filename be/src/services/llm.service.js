import { config } from "../config/env.js";
import { BadGatewayError } from "../errors/AppError.js";
import { logger } from "../utils/logger.js";
import { normalizeChatUrl } from "./stagehand-adapter.service.js";

export class LlmService {
  constructor(customConfig = config) {
    this.config = customConfig;
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

    logger.debug(`Calling LLM model "${model}" at ${url}`);

    const timeoutSignal = AbortSignal.timeout(this.config.timeouts.llmMs);
    const combinedSignal = clientSignal
      ? AbortSignal.any([timeoutSignal, clientSignal])
      : timeoutSignal;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: 350,
        }),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new BadGatewayError(
          `Model trả mã HTTP ${response.status}: ${errorText.slice(0, 300)}`
        );
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      return content;
    } catch (err) {
      if (clientSignal?.aborted) {
        throw new Error("Tác vụ gọi LLM đã bị hủy do client ngắt kết nối");
      }
      if (err instanceof BadGatewayError) throw err;
      if (err.name === "TimeoutError") {
        throw new BadGatewayError(`LLM request vượt quá thời gian chờ ${this.config.timeouts.llmMs / 1000}s`);
      }
      throw new BadGatewayError(`Không thể kết nối đến LLM: ${err.message}`);
    }
  }
}

export const llmService = new LlmService();

