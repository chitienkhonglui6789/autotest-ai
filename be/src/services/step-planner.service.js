import { config } from "../config/env.js";
import {
  inferDisplayStepType,
  normalizeStepItem,
  splitParagraphLocally,
} from "../constants/stepTypes.js";
import { llmService } from "./llm.service.js";
import { logger } from "../utils/logger.js";

const VIETNAMESE_SPLIT_SYSTEM_PROMPT = `Bạn là trợ lý biên tập kịch bản kiểm thử No-Code tiếng Việt cho nền tảng Playwright Micro-ReAct.
Nhiệm vụ: Tách một đoạn mô tả kịch bản kiểm thử thành danh sách các bước tiếng Việt tuần tự, rõ ràng, mỗi bước chỉ làm 1 việc chính hoặc 1 cụm thao tác liên quan chặt chẽ (ví dụ: nhập form cùng màn hình có thể tách từng ô hoặc nhóm nhỏ).

QUY TẮC BẮT BUỘC:
1. Giữ nguyên 100% tiếng Việt tự nhiên, KHÔNG dịch sang tiếng Anh.
2. Bảo toàn nguyên vẹn mọi URL, tên nút/nhãn trong ngoặc kép, giá trị dữ liệu, tên biến {{ten_bien}}, {{LAST_EXTRACTED}}, và thẻ [soft].
3. KHÔNG tự bịa thêm dữ liệu, URL hay thông báo không có trong đoạn văn gốc.
4. Bước mở trang (http://...) luôn đặt riêng ở đầu nếu có. Bước Kiểm tra/Xác nhận đặt thành bước riêng.
5. QUAN TRỌNG VỀ THẺ/DÒNG SẢN PHẨM: Nếu câu có dạng "Chọn sản phẩm/mục 'X' và nhấn nút 'Y'" hoặc "Tìm 'X' và bấm nút 'Y'" (tức chọn một thẻ/dòng cụ thể rồi bấm nút nằm trên chính thẻ/dòng đó như "Thêm vào giỏ", "Mua", "Xóa", "Chi tiết"), TUYỆT ĐỐI KHÔNG tách thành 2 bước rời ("Chọn sản phẩm X" rồi "Nhấn nút Y") vì nút "Y" cần biết thuộc dòng "X" nào! Hãy gộp thành 1 bước rõ ngữ cảnh: ví dụ \`Bấm nút "Thêm vào giỏ" của sản phẩm "Smartphone X"\`. Chỉ tách riêng "Chọn ..." khi đó là thao tác chọn giá trị trong ô thả xuống (<select>), checkbox hoặc radio button độc lập.
6. Chỉ trả về đúng 1 JSON hợp lệ theo định dạng:
{
  "steps": [
    "Bước 1...",
    "Bước 2..."
  ]
}`;

export class StepPlannerService {
  constructor(llm = llmService, customConfig = config) {
    this.llm = llm;
    this.config = customConfig;
  }

  _enforceMaxSteps(steps) {
    const maxSteps = this.config.limits.maxSteps;
    if (steps.length > maxSteps) {
      throw new Error(
        `Kịch bản sau khi tách có ${steps.length} bước, vượt quá giới hạn MAX_STEPS=${maxSteps}`
      );
    }
    return steps;
  }

  /**
   * Tách một đoạn mô tả dài tiếng Việt thành mảng chuỗi các bước bằng Regex/Heuristics hoặc AI LLM.
   * Phục vụ cả nút "Dán & Tách bước thông minh" trên Giao diện và API chạy bằng `description` thô.
   *
   * @param {string} rawText
   * @param {{ mode?: "smart" | "fast" | "ai" }} [options]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<{ steps: string[], modeUsed: "fast"|"ai", note: string }>}
   */
  async splitRawText(rawText, options = {}, signal = null) {
    const text = String(rawText || "").trim();
    if (!text) {
      return { steps: [], modeUsed: "fast", note: "Nội dung trống" };
    }

    const mode = options?.mode || "smart";
    const localSteps = splitParagraphLocally(text);

    // Chế độ "fast" luôn trả ngay trong < 1ms không cần LLM
    if (mode === "fast") {
      return {
        steps: localSteps,
        modeUsed: "fast",
        note: `Đã tách nhanh thành ${localSteps.length} bước theo cấu trúc câu.`,
      };
    }

    // Trong chế độ "smart": Nếu tách câu cơ bản đã ra các bước ngắn gọn rõ ràng, không cần tốn AI
    const hasMegaClause = localSteps.some(
      (s) =>
        s.length > 130 &&
        /,\s*(?:rồi|sau đó|tiếp theo|vào mục|chọn|mở|nhấn|bấm|điền|nhập|kiểm tra)/i.test(s)
    );
    const looksUnpunctuatedLongText = localSteps.length <= 1 && text.length > 110;

    if (mode === "smart" && localSteps.length >= 2 && !hasMegaClause) {
      return {
        steps: localSteps,
        modeUsed: "fast",
        note: `Đã tự động tách thành ${localSteps.length} bước rõ ràng (0ms).`,
      };
    }

    // Gọi AI khi người dùng chọn mode="ai" hoặc khi đoạn văn quá dài dính liền khó tách bằng dấu câu
    if (mode === "ai" || hasMegaClause || looksUnpunctuatedLongText) {
      try {
        const rawOut = await this.llm.chatCompletion(
          [
            { role: "system", content: VIETNAMESE_SPLIT_SYSTEM_PROMPT },
            { role: "user", content: `Đoạn kịch bản cần tách:\n"""\n${text}\n"""` },
          ],
          signal
        );

        let clean = String(rawOut || "")
          .replace(/<think>[\s\S]*?<\/think>/gi, "")
          .replace(/```(?:json)?/gi, "")
          .trim();

        const firstBrace = clean.indexOf("{");
        const lastBrace = clean.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          const parsed = JSON.parse(
            clean.slice(firstBrace, lastBrace + 1).replace(/,\s*([}\]])/g, "$1")
          );
          if (Array.isArray(parsed.steps)) {
            const aiSteps = parsed.steps
              .map((s) => String(s || "").trim())
              .filter(Boolean);
            if (aiSteps.length > 0) {
              return {
                steps: aiSteps,
                modeUsed: "ai",
                note: `AI đã phân tách thành ${aiSteps.length} bước tiếng Việt chuẩn.`,
              };
            }
          }
        }
      } catch (err) {
        logger.warn(`AI Smart-Split không khả dụng, dùng bộ tách cục bộ fallback: ${err.message}`);
      }
    }

    return {
      steps: localSteps.length > 0 ? localSteps : [text],
      modeUsed: "fast",
      note: `Đã tách thành ${Math.max(1, localSteps.length)} bước theo quy tắc cục bộ.`,
    };
  }

  /**
   * Chuẩn bị danh sách bước thực thi cho RunnerService:
   * - Khi đã có mảng `rawSteps` từ Giao diện / `projects.json`:
   *   Giữ nguyên 1:1 danh sách bước của người dùng (0ms, 0 gọi AI, bảo toàn cache key).
   * - Khi chỉ có chuỗi `description` thô (gọi trực tiếp POST /run):
   *   Tách câu thông minh bằng tiếng Việt trước khi nạp vào Micro-ReAct Engine.
   */
  async prepareExecutionPlan(description, signal = null, rawSteps = null) {
    if (Array.isArray(rawSteps) && rawSteps.length > 0) {
      const normalized = rawSteps
        .map((item, idx) => normalizeStepItem(item, idx))
        .filter((s) => s.text.length > 0);

      // Nếu chỉ có duy nhất 1 bước nhưng lại là cả đoạn văn nhiều câu (người dùng dán nguyên đoạn vào ô 1.),
      // tự động tách câu thành nhiều bước để tận dụng Cache, FastPath và chụp ảnh từng chặng!
      if (normalized.length === 1) {
        const single = normalized[0];
        const localParts = splitParagraphLocally(single.text);
        if (localParts.length >= 2) {
          const splitRes = await this.splitRawText(single.text, { mode: "smart" }, signal);
          const expandedSteps = splitRes.steps.map((text, idx) => ({
            index: idx + 1,
            type: inferDisplayStepType(text),
            text,
            isSoft: single.isSoft || /\[soft\]|\[tùy chọn\]|\[optional\]/i.test(text),
          }));
          if (expandedSteps.length > 1) {
            this._enforceMaxSteps(expandedSteps);
            return {
              steps: expandedSteps,
              notes: [`Tự động tách bước gộp dài thành ${expandedSteps.length} bước (${splitRes.note})`],
            };
          }
        }
      }

      if (normalized.length > 0) {
        this._enforceMaxSteps(normalized);
        return {
          steps: normalized,
          notes: [`Giữ nguyên ${normalized.length} bước từ kịch bản gốc (Zero-Classifier).`],
        };
      }
    }

    const desc = String(description || "").trim();
    if (!desc) {
      throw new Error("Kịch bản không có bước thực thi nào hợp lệ");
    }

    const splitRes = await this.splitRawText(desc, { mode: "smart" }, signal);
    const steps = splitRes.steps.map((text, idx) => ({
      index: idx + 1,
      type: inferDisplayStepType(text),
      text,
      isSoft: /\[soft\]|\[tùy chọn\]|\[optional\]/i.test(text),
    }));

    this._enforceMaxSteps(steps);

    return {
      steps,
      notes: [splitRes.note],
    };
  }
}

export const stepPlannerService = new StepPlannerService();

