import { config } from "../config/env.js";
import { CLASSIFY_SYSTEM_PROMPT } from "../constants/prompts.js";
import { STEP_TYPES, STEP_ALIASES } from "../constants/stepTypes.js";
import { BadGatewayError, UnprocessableEntityError } from "../errors/AppError.js";
import { llmService } from "./llm.service.js";

const pickFirstString = (obj, keys) => {
  for (const k of keys) {
    if (typeof obj?.[k] === "string" && obj[k].trim()) {
      return obj[k].trim();
    }
  }
  return undefined;
};

export class ClassifierService {
  constructor(llm = llmService, customConfig = config) {
    this.llm = llm;
    this.config = customConfig;
  }

  /**
   * Parse text phản hồi từ LLM, lọc bỏ tag suy nghĩ/markdown và chuẩn hóa bước test
   * @param {string} text
   * @returns {{ steps: Array<{ type: string, text: string }>, notes: string[] }}
   */
  parseResponse(text) {
    let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    // Xử lý trường hợp thẻ <think> bị đứt gãy token (không có thẻ đóng </think>)
    if (cleanText.includes("<think>")) {
      cleanText = cleanText.replace(/<think>[\s\S]*?(?=[\[{]|$)/gi, "");
    }
    cleanText = cleanText.replace(/```(?:json)?/gi, "").trim();

    const firstBrace = cleanText.search(/[\[{]/);
    const lastBrace = Math.max(cleanText.lastIndexOf("}"), cleanText.lastIndexOf("]"));

    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("không thấy JSON trong câu trả lời");
    }

    const rawJson = cleanText.slice(firstBrace, lastBrace + 1);
    // Xóa trailing commas trước } hoặc ] để tránh JSON.parse syntax error
    const sanitizedJson = rawJson.replace(/,\s*([}\]])/g, "$1");

    const data = JSON.parse(sanitizedJson);
    const list = Array.isArray(data) ? data : (data.steps ?? data.plan);

    if (!Array.isArray(list)) {
      throw new Error("thiếu mảng steps");
    }

    if (list.length > this.config.limits.maxSteps) {
      throw new Error(`quá ${this.config.limits.maxSteps} bước`);
    }

    const notes = [];
    const steps = list.map((st, i) => {
      const raw = pickFirstString(st, ["type", "action", "kind", "step_type", "name"]);
      const normalizedKey = raw?.toLowerCase().replace(/[\s-]+/g, "_");
      const type = STEP_TYPES.includes(normalizedKey) ? normalizedKey : STEP_ALIASES[normalizedKey];

      if (!type) {
        throw new Error(
          `bước ${i + 1}: type "${raw}" không hợp lệ, phải là đúng một trong ${STEP_TYPES.join("/")}`
        );
      }

      if (raw !== type) {
        notes.push(`bước ${i + 1}: "${raw}" → ${type}`);
      }

      const content = pickFirstString(st, [
        "text",
        "instruction",
        "content",
        "description",
        "target",
        "url",
        "value",
      ]);

      if (!content) {
        throw new Error(`bước ${i + 1}: thiếu text`);
      }

      return { type, text: content };
    });

    return { steps, notes };
  }

  /**
   * Bộ phân tách quy tắc dự phòng (Heuristic Fallback) nếu LLM bị nghẽn hoặc trả JSON lỗi
   * Không ngắt chuỗi tại dấu chấm của URL domain (.com, .vn...)
   * @param {string} description
   * @returns {{ steps: Array<{ type: string, text: string }>, notes: string[] } | null}
   */
  heuristicFallback(description) {
    const rawChunks = description
      .split(/(?:[,;\n]|\.\s+)+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!rawChunks.length) return null;

    const steps = [];
    for (const chunk of rawChunks) {
      const urlMatch = chunk.match(/(?:https?:\/\/|[a-z0-9-]+\.[a-z]{2,})[^\s]*/i);
      if (urlMatch || /^(vào|mở|truy cập)/i.test(chunk)) {
        const target = urlMatch ? urlMatch[0] : chunk.replace(/^(vào trang|mở trang|truy cập trang|vào|mở|truy cập)\s*/i, "").trim();
        if (target) {
          steps.push({ type: "goto", text: target });
          continue;
        }
      }

      if (/^(đọc|lấy|trích xuất|xem|kiểm tra)/i.test(chunk)) {
        if (/^(kiểm tra xem|xem có|có nút|có phần tử)/i.test(chunk)) {
          steps.push({ type: "observe", text: chunk });
        } else {
          steps.push({ type: "extract", text: chunk });
        }
        continue;
      }

      steps.push({ type: "act", text: chunk });
    }

    return steps.length > 0
      ? { steps, notes: ["Kích hoạt phân tách tự động bằng Heuristic Fallback do LLM không trả JSON hợp lệ"] }
      : null;
  }

  /**
   * Phân loại mô tả ca kiểm thử bằng LLM, có cơ chế tự sửa sai (retry) & heuristic fallback
   * @param {string} description
   * @param {AbortSignal} [signal]
   * @returns {Promise<{ steps: Array<{ type: string, text: string }>, notes: string[] }>}
   */
  async classify(description, signal = null) {
    const messages = [
      { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
      { role: "user", content: description },
    ];

    let lastError = null;
    let lastOutput = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) {
        throw new Error("Phân loại bước kiểm thử đã bị hủy");
      }

      const output = await this.llm.chatCompletion(messages, signal);
      lastOutput = output;

      try {
        const parsed = this.parseResponse(output);
        if (!parsed.steps.length) {
          throw new UnprocessableEntityError("Không nhận diện được bước kiểm thử nào trong mô tả");
        }
        return parsed;
      } catch (err) {
        if (err instanceof UnprocessableEntityError) throw err;
        lastError = err;

        messages.push(
          { role: "assistant", content: output },
          {
            role: "user",
            content: `Your output was invalid: ${err.message}. Every step must be {"type":"goto|act|observe|extract","text":"..."}. Output ONLY the corrected JSON.`,
          }
        );
      }
    }

    // Nếu LLM cả 2 lần đều trả về lỗi hoặc hallucinate, thử cứu cánh bằng Heuristic Fallback
    const fallback = this.heuristicFallback(description);
    if (fallback) {
      return fallback;
    }

    throw new BadGatewayError(
      `Model không trả được kết quả hợp lệ: ${lastError?.message}. Câu trả lời cuối: ${lastOutput.slice(0, 300)}`
    );
  }
}

export const classifierService = new ClassifierService();

