export const FAILURE_TYPES = Object.freeze({
  TIMEOUT: "TIMEOUT",
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  ASSERTION_FAILED: "ASSERTION_FAILED",
  EXECUTION_ERROR: "EXECUTION_ERROR",
  SILENT_FAILURE: "SILENT_FAILURE",
  HTTP_ERROR: "HTTP_ERROR",
  POST_CONDITION_FAILED: "POST_CONDITION_FAILED",
});

/**
 * Chuẩn phân loại 4 trạng thái Big Tech (Allure / Google TAP / Playwright CI):
 * Tách bạch hoàn toàn Lỗi sản phẩm (FAILED) vs Lỗi kịch bản/hạ tầng/AI (BROKEN)
 */
export const VERDICT_STATUS = Object.freeze({
  PASSED: "PASSED",
  PASSED_WITH_WARNINGS: "PASSED_WITH_WARNINGS",
  FAILED: "FAILED",
  BROKEN: "BROKEN",
  CANCELLED: "CANCELLED",
});

/**
 * Chế độ nghiêm ngặt của Hàng rào An toàn Nhân quả (Causal Guardrails)
 */
export const DIAGNOSTIC_STRICTNESS = Object.freeze({
  EXPLICIT: "explicit",
  BALANCED: "balanced",
  STRICT: "strict",
});

/**
 * Nguồn thẩm định (Oracle Source) cho bằng chứng bước kiểm thử
 */
export const ORACLE_SOURCES = Object.freeze({
  DETERMINISTIC_ASSERT: "deterministic_assert",
  AI_JUDGE: "ai_judge",
  CAUSAL_GUARDRAIL: "causal_guardrail",
  MECHANICAL_ACTION: "mechanical_action",
});

export function normalizeStrictnessMode(rawMode, fallback = DIAGNOSTIC_STRICTNESS.BALANCED) {
  const clean = String(rawMode || "").trim().toLowerCase();
  if (clean === DIAGNOSTIC_STRICTNESS.EXPLICIT) return DIAGNOSTIC_STRICTNESS.EXPLICIT;
  if (clean === DIAGNOSTIC_STRICTNESS.STRICT) return DIAGNOSTIC_STRICTNESS.STRICT;
  if (clean === DIAGNOSTIC_STRICTNESS.BALANCED) return DIAGNOSTIC_STRICTNESS.BALANCED;
  return fallback;
}

/**
 * Suy luận Verdict 4 trạng thái cho 1 bước kiểm thử:
 * - PASSED / PASSED_WITH_WARNINGS: bước đạt yêu cầu
 * - FAILED: Lỗi sản phẩm (Assertion sai, Silent Failure nhân quả, HTTP 4xx/5xx server error)
 * - BROKEN: Lỗi kịch bản / hạ tầng / AI (Element not found, Timeout, LLM error, thực thi hỏng)
 * - CANCELLED: Người dùng hủy
 */
export function classifyStepVerdict({ status, failureType = null, isProductDefect = false, uxWarnings = [] } = {}) {
  if (status === "cancelled" || failureType === "CANCELLED") {
    return VERDICT_STATUS.CANCELLED;
  }
  if (status === "passed") {
    return Array.isArray(uxWarnings) && uxWarnings.length > 0
      ? VERDICT_STATUS.PASSED_WITH_WARNINGS
      : VERDICT_STATUS.PASSED;
  }
  if (
    isProductDefect ||
    failureType === FAILURE_TYPES.ASSERTION_FAILED ||
    failureType === FAILURE_TYPES.SILENT_FAILURE ||
    failureType === FAILURE_TYPES.HTTP_ERROR ||
    failureType === FAILURE_TYPES.POST_CONDITION_FAILED
  ) {
    return VERDICT_STATUS.FAILED;
  }
  return VERDICT_STATUS.BROKEN;
}

/**
 * Suy luận loại bước phục vụ hiển thị nhãn màu trên báo cáo HTML (0ms, không gọi AI).
 * @param {string} stepText
 * @returns {"goto"|"wait"|"assert"|"browser"|"act"}
 */
export function inferDisplayStepType(stepText) {
  const lower = String(stepText || "").trim().toLowerCase();
  if (!lower) return "act";

  if (
    /^(?:vào trang|mở trang|truy cập|vào url|mở url|mở địa chỉ|vào địa chỉ|go to|open\s+https?:|https?:\/\/)/i.test(
      lower
    )
  ) {
    return "goto";
  }

  if (/^(?:chờ|đợi|tạm dừng|ngủ|wait|sleep)\s+\d+/i.test(lower)) {
    return "wait";
  }

  if (
    /^(?:kiểm tra|xác nhận|xác minh|đảm bảo|chờ và kiểm tra|check|verify|assert|kiểm chứng)/i.test(
      lower
    )
  ) {
    return "assert";
  }

  if (/(?:chuyển tab|chuyển sang cửa sổ|đóng tab|quay lại tab|tải lại trang|cuộn trang|scroll|refresh|f5)/i.test(lower)) {
    return "browser";
  }

  return "act";
}

/**
 * Kiểm tra chuỗi có mang cờ Soft Assertion ([soft] / [tùy chọn] / [optional])
 */
export function isSoftAssertionText(text) {
  return /\[soft\]|\[tùy chọn\]|\[optional\]/i.test(String(text || ""));
}

/**
 * Chuẩn hóa 1 item bước (string hoặc object) thành cấu trúc thực thi chuẩn của Engine
 */
export function normalizeStepItem(item, index = 0) {
  const isObj = typeof item === "object" && item !== null;
  const text = String(isObj ? item.text || item.step || "" : item || "").trim();
  const isSoft = isObj
    ? Boolean(item.isSoft || item.optional || isSoftAssertionText(text))
    : isSoftAssertionText(text);

  return {
    index: index + 1,
    type: isObj && item.type ? String(item.type) : inferDisplayStepType(text),
    text,
    isSoft,
  };
}

/**
 * Tách đoạn văn bản tiếng Việt thành các bước tuần tự theo quy tắc an toàn:
 * - Bảo vệ URL (http://127.0.0.1:5050, example.com), số thập phân (1.5s), chữ trong ngoặc kép.
 * - Tách theo xuống dòng, đầu mục đánh số ("1.", "Bước 1:"), dấu chấm phẩy `;`, hoặc dấu chấm câu `. `.
 * @param {string} rawText
 * @returns {string[]}
 */
export function splitParagraphLocally(rawText) {
  const input = String(rawText || "").trim();
  if (!input) return [];

  // Bảo vệ nội dung trong ngoặc kép & URL để tránh tách nhầm dấu chấm bên trong
  const protectedTokens = [];
  const stash = (match) => {
    const idx = protectedTokens.length;
    protectedTokens.push(match);
    return `__AT_TOKEN_${idx}__`;
  };

  const stashUrl = (match) => {
    // Tách dấu kết câu (. ! ? ) ]) ở cuối URL để không nuốt mất dấu tách bước hoặc làm hỏng URL
    const trimmed = match.match(/^(.*?)([.!?)\]]+)$/);
    if (trimmed && trimmed[1]) {
      return `${stash(trimmed[1])}${trimmed[2]}`;
    }
    return stash(match);
  };

  let sanitized = input
    .replace(/https?:\/\/[^\s,;]+/gi, stashUrl)
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”/g, stash)
    .replace(/\b\d+\.\d+\b/g, stash);

  // Tách sơ bộ theo xuống dòng
  const rawLines = sanitized
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const clauses = [];
  for (const line of rawLines) {
    // Tách đầu mục đánh số nội tuyến như "1. ... 2. ..." hoặc "Bước 1: ... Bước 2: ..."
    const cleanLine = line.replace(/^(?:bước\s*\d+\s*[:.-]?|\d+[.)]\s+|[-*•]\s+)/i, "").trim();
    const parts = cleanLine
      .split(/\s*;\s*|\.\s+(?=[A-ZÀ-Ỹa-zà-ỹ__])|\.\s*$/)
      .map((p) => p.replace(/^(?:bước\s*\d+\s*[:.-]?|\d+[.)]\s+|[-*•]\s+)/i, "").trim())
      .filter(Boolean);

    for (const part of parts) {
      if (part.length > 0) {
        clauses.push(part);
      }
    }
  }

  // Khôi phục lại token URL / ngoặc kép / số thập phân ban đầu
  return clauses
    .map((clause) =>
      clause.replace(/__AT_TOKEN_(\d+)__/g, (_, idx) => protectedTokens[Number(idx)] ?? "")
    )
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
