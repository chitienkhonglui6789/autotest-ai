import { logger } from "../../utils/logger.js";
import {
  FAILURE_TYPES,
  DIAGNOSTIC_STRICTNESS,
  ORACLE_SOURCES,
  normalizeStrictnessMode,
} from "../../constants/stepTypes.js";
import { extractRoutePath } from "../../utils/url.js";

/**
 * Ma trận phân cấp mức độ nghiêm trọng của chẩn đoán giao diện (Layer 4 - Semantic Severity Matrix)
 */
export const DIAGNOSTIC_SEVERITY = Object.freeze({
  FATAL: "FATAL",
  BLOCKING_ERROR: "BLOCKING_ERROR",
  ADVISORY: "ADVISORY",
  BENIGN: "BENIGN",
});

const ERROR_INTENT_PATTERN =
  /(lỗi|error|fail|invalid|sai|không hợp lệ|cảnh báo|warning|không đúng|không chính xác|từ chối|hủy|thất bại|không thành công|bắt buộc|required|bị khóa|denied|unauthorized|forbidden)/i;

const EXPLICIT_ASSERT_STEP_PATTERN =
  /^(?:kiểm tra|xác nhận|xác minh|đảm bảo|chờ và kiểm tra|check|verify|assert|kiểm chứng)/i;

function stepHasErrorIntent(rawStepText, stepType = "") {
  const trimmed = String(rawStepText || "").trim();
  if (!trimmed) return false;
  if (stepType === "assert" || EXPLICIT_ASSERT_STEP_PATTERN.test(trimmed)) {
    return ERROR_INTENT_PATTERN.test(trimmed);
  }
  const withoutQuotedLabels = trimmed.replace(/"[^"]*"|'[^']*'|“[^”]*”/g, " ");
  return ERROR_INTENT_PATTERN.test(withoutQuotedLabels);
}

const MUTATION_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isSameOriginUrl(urlA, urlB) {
  if (!urlA || !urlB) return true;
  try {
    const parsedA = new URL(urlA);
    const parsedB = new URL(urlB);
    if (!/^https?:$/i.test(parsedA.protocol) || !/^https?:$/i.test(parsedB.protocol)) {
      return true;
    }
    return parsedA.origin === parsedB.origin;
  } catch {
    return true;
  }
}

function normalizeUrlForRoute(rawUrl) {
  const str = String(rawUrl || "").trim();
  if (!str) return "";
  try {
    const u = new URL(str);
    return `${u.origin}${u.pathname.replace(/\/+$/, "") || "/"}${u.hash || ""}`;
  } catch {
    return extractRoutePath(str);
  }
}

/**
 * Tầng 2 (Temporal Baseline Subtraction):
 * Chụp trạng thái nền các thông báo/banner ĐANG HIỂN THỊ SẴN trước khi thực hiện thao tác,
 * đồng thời đóng dấu DOM (`data-at-baseline-id`) để loại bỏ 100% thông báo cũ / banner cố định
 * (kể cả banner đếm ngược thời gian cập nhật số giây in-place).
 */
export async function captureUiDiagnosticBaseline(targetPage) {
  const baselineId = `bl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = targetPage && !targetPage.isClosed?.() ? targetPage.url?.() || "" : "";
  const baseline = {
    baselineId,
    capturedAt: Date.now(),
    url,
    routeKey: normalizeUrlForRoute(url),
    routePath: extractRoutePath(url),
    pageRef: targetPage || null,
    signatures: [],
    textKeys: [],
    validationKeys: [],
  };

  try {
    if (!targetPage || targetPage.isClosed?.()) return baseline;

    const sigSet = new Set();
    const textKeySet = new Set();
    const valKeySet = new Set();

    for (const frame of targetPage.frames()) {
      if (frame.isDetached?.()) continue;
      let frameUrl = "";
      try {
        frameUrl = frame.url?.() || "";
      } catch {
        frameUrl = "";
      }

      let frameRes = null;
      try {
        frameRes = await frame.evaluate(({ bId }) => {
          const getParentOrHost = (node) => {
            if (!node) return null;
            if (node.parentElement) return node.parentElement;
            const root = node.getRootNode?.();
            return root && root.host ? root.host : null;
          };

          const isDiagVisible = (el) => {
            if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return false;
            if (el.hidden === true || el.getAttribute?.("aria-hidden") === "true") return false;
            let cur = el;
            let depth = 0;
            while (cur && depth < 25) {
              if (cur.nodeType === 1) {
                if (cur.hidden === true || cur.getAttribute?.("aria-hidden") === "true") return false;
                const st = window.getComputedStyle(cur);
                if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
                  return false;
                }
                if (parseFloat(st.opacity) === 0) return false;
              }
              cur = getParentOrHost(cur);
              depth++;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1;
          };

          const collectNodes = (root, out = []) => {
            if (!root) return out;
            const children = root.children || [];
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              out.push(child);
              if (child.shadowRoot) collectNodes(child.shadowRoot, out);
              collectNodes(child, out);
            }
            return out;
          };

          const matchAny = (el, sel) => {
            try {
              return typeof el.matches === "function" && el.matches(sel);
            } catch {
              return false;
            }
          };

          const normalizeTextKey = (raw) =>
            String(raw || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase()
              .replace(/\d+/g, "#")
              .slice(0, 140);

          const candidateSelector = [
            "#error",
            ".error",
            ".alert-danger",
            ".alert-error",
            ".alert-warning",
            ".alert-info",
            ".toast-error",
            ".toast-warning",
            ".toast-info",
            ".ant-message-error",
            ".ant-notification-notice-error",
            ".ant-alert-error",
            ".ant-alert-warning",
            ".ant-alert-info",
            ".MuiAlert-standardError",
            ".MuiAlert-filledError",
            ".MuiAlert-outlinedError",
            ".MuiAlert-standardWarning",
            ".MuiAlert-standardInfo",
            ".el-message--error",
            ".el-alert--error",
            ".Toastify__toast--error",
            '[data-sonner-toast][data-type="error"]',
            ".swal2-error",
            ".notification-error",
            '[data-test="error"]',
            '[data-testid="error"]',
            ".error-message-container",
            '[class*="error-message"]',
            '[id*="error-message"]',
            '[role="alert"]',
            '[role="status"]',
          ].join(", ");

          const validationFeedbackSelector = [
            '[aria-invalid="true"]',
            ".is-invalid",
            ".has-error",
            ".ant-form-item-explain-error",
            ".MuiFormHelperText-root.Mui-error",
            ".invalid-feedback",
            ".field-error",
            ".error-text",
          ].join(", ");

          const allNodes = collectNodes(document.body || document.documentElement, []);
          const sigs = [];
          const texts = [];
          const vals = [];

          for (const el of allNodes) {
            if (matchAny(el, candidateSelector) && isDiagVisible(el)) {
              const rawText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
              if (rawText) {
                const textKey = normalizeTextKey(rawText);
                const tag = el.tagName.toLowerCase();
                const id = (el.id || "").toLowerCase();
                const role = (el.getAttribute("role") || "").toLowerCase();
                const sig = `${tag}|${id}|${role}|${textKey}`;
                try {
                  el.setAttribute("data-at-baseline-id", bId);
                  el.setAttribute("data-at-baseline-text", textKey);
                } catch { }
                sigs.push(sig);
                texts.push(textKey);
              }
            }

            if (matchAny(el, validationFeedbackSelector) && isDiagVisible(el)) {
              const rawText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
              const valKey = `${el.tagName.toLowerCase()}|${el.id || ""}|${normalizeTextKey(rawText)}`;
              try {
                el.setAttribute("data-at-baseline-val-id", bId);
              } catch { }
              vals.push(valKey);
            }
          }

          return { sigs, texts, vals };
        }, { bId: baselineId });
      } catch {
        frameRes = null;
      }

      if (!frameRes) continue;
      for (const s of frameRes.sigs || []) sigSet.add(`${frameUrl}::${s}`);
      for (const t of frameRes.texts || []) textKeySet.add(`${frameUrl}::${t}`);
      for (const v of frameRes.vals || []) valKeySet.add(`${frameUrl}::${v}`);
    }

    baseline.signatures = Array.from(sigSet);
    baseline.textKeys = Array.from(textKeySet);
    baseline.validationKeys = Array.from(valKeySet);
  } catch (err) {
    logger.debug("Bỏ qua lỗi chụp baseline chẩn đoán UI:", err.message);
  }

  return baseline;
}

/**
 * Tầng 2 + Tầng 3 + Tầng 4:
 * Quét DOM sau thao tác với Trừ Nền (Temporal Delta), Phạm Vi Không Gian & Biểu Mẫu (Spatial & Form Scope)
 * và Ma Trận Phân Cấp Ngữ Nghĩa (Semantic Severity Matrix).
 */
export async function inspectUiDiagnostics(targetPage, { baseline = null, actionContext = null } = {}) {
  const aggregated = {
    alertText: null,
    isErrorAlert: false,
    formValidationError: null,
    serverError: null,
    newBlockingAlerts: [],
    newAdvisoryAlerts: [],
    staleAlertsCount: 0,
  };

  try {
    if (!targetPage || targetPage.isClosed?.()) return aggregated;

    const baselineId = baseline?.baselineId || "";
    const baselineSignatures = Array.isArray(baseline?.signatures) ? baseline.signatures : [];
    const baselineTextKeys = Array.isArray(baseline?.textKeys) ? baseline.textKeys : [];
    const baselineValKeys = Array.isArray(baseline?.validationKeys) ? baseline.validationKeys : [];

    const didSubmit = Boolean(actionContext?.didSubmit);
    const isFormSubmit = Boolean(actionContext?.isFormSubmit);
    const submittedFormKeys = Array.isArray(actionContext?.submittedFormKeys)
      ? actionContext.submittedFormKeys.filter(Boolean)
      : [];
    // Tương thích ngược khi gọi checkUiDiagnostics(page) độc lập không truyền actionContext
    const legacyUnscopedMode = actionContext === null || actionContext === undefined;

    const seenBlockingTexts = new Set();
    const seenAdvisoryTexts = new Set();

    for (const frame of targetPage.frames()) {
      if (frame.isDetached?.()) continue;
      let frameUrl = "";
      try {
        frameUrl = frame.url?.() || "";
      } catch {
        frameUrl = "";
      }

      let frameDiag = null;
      try {
        frameDiag = await frame.evaluate(
          ({
            fUrl,
            bId,
            bSigs,
            bTexts,
            bVals,
            checkFormValidation,
            nativeFormSubmit,
            formKeys,
            legacyMode,
          }) => {
            const bSigSet = new Set(bSigs);
            const bTextSet = new Set(bTexts);
            const bValSet = new Set(bVals);
            const formKeySet = new Set(formKeys);

            const getParentOrHost = (node) => {
              if (!node) return null;
              if (node.parentElement) return node.parentElement;
              const root = node.getRootNode?.();
              return root && root.host ? root.host : null;
            };

            const isDiagVisible = (el) => {
              if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return false;
              if (el.hidden === true || el.getAttribute?.("aria-hidden") === "true") return false;
              let cur = el;
              let depth = 0;
              while (cur && depth < 25) {
                if (cur.nodeType === 1) {
                  if (cur.hidden === true || cur.getAttribute?.("aria-hidden") === "true") return false;
                  const st = window.getComputedStyle(cur);
                  if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
                    return false;
                  }
                  if (parseFloat(st.opacity) === 0) return false;
                }
                cur = getParentOrHost(cur);
                depth++;
              }
              const rect = el.getBoundingClientRect();
              return rect.width > 1 && rect.height > 1;
            };

            const collectNodes = (root, out = []) => {
              if (!root) return out;
              const children = root.children || [];
              for (let i = 0; i < children.length; i++) {
                const child = children[i];
                out.push(child);
                if (child.shadowRoot) collectNodes(child.shadowRoot, out);
                collectNodes(child, out);
              }
              return out;
            };

            const matchAny = (el, sel) => {
              try {
                return typeof el.matches === "function" && el.matches(sel);
              } catch {
                return false;
              }
            };

            const normalizeTextKey = (raw) =>
              String(raw || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase()
                .replace(/\d+/g, "#")
                .slice(0, 140);

            const getClassString = (node) => {
              if (!node) return "";
              const raw = typeof node.className === "string" ? node.className : node.getAttribute?.("class") || "";
              return String(raw || "").toLowerCase();
            };

            // Layer 3: Kiểm tra phần tử có nằm trong vùng ngoài phạm vi nghiệp vụ không (header/footer/cookie/chat widget/env banner)
            const OUT_OF_SCOPE_META_PATTERN =
              /(?:^|[\s_-])(cookie|consent|gdpr|onetrust|cc-banner|privacy-banner|intercom|tawk|crisp|zendesk|hubspot|drift|livechat|subiz|messenger|chat-widget|support-widget|fb-customerchat|announcement-bar|env-banner|uat-banner|staging-banner|maintenance-banner|ssl-notice|browser-warning|promo-banner|top-announcement|notification-bell|notification-dropdown|notif-list|stale-banner)(?:$|[\s_-])/i;

            const THIRD_PARTY_FRAME_PATTERN =
              /(?:intercom|tawk\.to|crisp\.chat|zendesk|hubspot|livechat|subiz|facebook\.com|doubleclick|hotjar|sentry)/i;

            const isOutOfScopeNode = (el) => {
              if (fUrl && THIRD_PARTY_FRAME_PATTERN.test(fUrl)) return true;
              let cur = el;
              let depth = 0;
              while (cur && depth < 12) {
                if (cur.nodeType === 1) {
                  const tag = cur.tagName.toLowerCase();
                  const role = (cur.getAttribute?.("role") || "").toLowerCase();
                  if (tag === "footer" || tag === "nav" || role === "navigation" || role === "contentinfo") {
                    return true;
                  }
                  const meta = `${cur.id || ""} ${getClassString(cur)} ${cur.getAttribute?.("aria-label") || ""}`;
                  if (OUT_OF_SCOPE_META_PATTERN.test(meta)) {
                    return true;
                  }
                }
                cur = getParentOrHost(cur);
                depth++;
              }
              return false;
            };

            const isInsideSubmittedFormOrContainer = (el) => {
              if (formKeySet.size === 0) return false;
              let cur = el;
              let depth = 0;
              while (cur && depth < 10) {
                if (cur.nodeType === 1) {
                  const fk = cur.getAttribute?.("data-at-form-key");
                  if (fk && formKeySet.has(fk)) return true;
                }
                cur = getParentOrHost(cur);
                depth++;
              }
              // Kiểm tra cùng card / dialog / login-wrapper với form vừa submit (alert thường nằm ngay trên <form>)
              const parentBox = el.closest?.("section, main, .card, .login-wrapper, [role='dialog'], .modal-content");
              if (parentBox) {
                for (const fk of formKeySet) {
                  if (parentBox.querySelector?.(`[data-at-form-key="${fk}"]`)) {
                    return true;
                  }
                }
              }
              return false;
            };

            const explicitErrorSelector = [
              "#error",
              ".error",
              ".alert-danger",
              ".alert-error",
              ".toast-error",
              ".ant-message-error",
              ".ant-notification-notice-error",
              ".ant-alert-error",
              ".MuiAlert-standardError",
              ".MuiAlert-filledError",
              ".MuiAlert-outlinedError",
              ".el-message--error",
              ".el-alert--error",
              ".Toastify__toast--error",
              '[data-sonner-toast][data-type="error"]',
              ".swal2-error",
              ".notification-error",
              '[data-test="error"]',
              '[data-testid="error"]',
              ".error-message-container",
              '[class*="error-message"]',
              '[id*="error-message"]',
            ].join(", ");

            const genericNoticeSelector = [
              '[role="alert"]',
              '[role="status"]',
              ".alert-warning",
              ".alert-info",
              ".toast-warning",
              ".toast-info",
              ".ant-alert-warning",
              ".ant-alert-info",
              ".MuiAlert-standardWarning",
              ".MuiAlert-standardInfo",
            ].join(", ");

            const combinedAlertSelector = `${explicitErrorSelector}, ${genericNoticeSelector}`;

            // Layer 4: Ma trận nhận diện ngữ nghĩa
            const SUCCESS_CLASS_PATTERN =
              /(?:^|[\s_-])(alert-success|toast-success|ant-message-success|ant-alert-success|ant-notification-notice-success|muialert-.*success|el-message--success|el-alert--success|toastify__toast--success|swal2-success)(?:$|[\s_-])/i;

            const WARNING_OR_INFO_CLASS_PATTERN =
              /(?:^|[\s_-])(alert-warning|alert-info|alert-primary|alert-secondary|toast-warning|toast-info|ant-alert-warning|ant-alert-info|ant-message-warning|ant-message-info|ant-notification-notice-warning|ant-notification-notice-info|muialert-.*warning|muialert-.*info|el-alert--warning|el-alert--info|el-message--warning|el-message--info|toastify__toast--warning|toastify__toast--info|stale-banner|ssl-notice|announcement|notice)(?:$|[\s_-])/i;

            const EXPLICIT_ERROR_CLASS_PATTERN =
              /(?:^|\s)error(?:\s|$)|(?:^|[\s_-])(alert-danger|alert-error|toast-error|ant-message-error|ant-alert-error|ant-notification-notice-error|muialert-.*error|el-message--error|el-alert--error|toastify__toast--error|swal2-error|notification-error|error-message|error-message-container|error-alert|login-error|auth-error|form-error)(?:$|[\s_-])/i;

            const NEGATED_SUCCESS_PATTERN =
              /(không\s+thành\s+công|chưa\s+thành\s+công|unsuccessful|not\s+successful)/i;

            const NEGATED_ERROR_PATTERN =
              /(không\s+có\s+lỗi|không\s+gặp\s+lỗi|0\s+lỗi|no\s+errors?|without\s+errors?|error-free)/i;

            const SUCCESS_TEXT_PATTERN =
              /(đăng nhập thành công|thành công|succeed|succeeded|successfully|hoàn tất|đã lưu thành công|saved successfully)/i;

            // Cảnh báo chính sách / môi trường / hệ thống / widget bên thứ ba không chặn luồng nghiệp vụ
            const ADVISORY_TEXT_PATTERN =
              /(môi trường thử nghiệm|\bstaging\b|\buat\b|\bsandbox\b|demo environment|chứng chỉ tự ký|self-signed|phiên bản thử nghiệm|không chia sẻ mật khẩu|không chia sẻ tài khoản|không chia sẻ mã otp|đổi mật khẩu định kỳ|quá hạn\s+\d+\s+ngày|mật khẩu.*sắp hết hạn|bảo trì hệ thống|hệ thống.*sẽ bảo trì|chính sách bảo mật|trình duyệt không an toàn|trình duyệt cũ|cập nhật chrome|nâng cấp trình duyệt|đối soát cuối tháng|giành focus|tái hiện lỗi|chế độ an toàn|hỗ trợ trực tuyến|chat realtime|websocket|live chat|trò chuyện trực tuyến|đang xử lý yêu cầu|cảnh báo nhẹ|dữ liệu chưa được tối ưu|cảnh báo cũ|phiên trước chưa đồng bộ)/i;

            const STRICT_ERROR_PREFIX_PATTERN =
              /^(?:✖|❌|🚫|lỗi(?:\s+\d+)?[\s:!]|error(?:\s+\d+)?[\s:!]|thất bại[\s:!]|failed[\s:!]|epic sadface|không thể đăng nhập|đăng nhập thất bại|sai mật khẩu|sai tên đăng nhập|tài khoản hoặc mật khẩu không)/i;

            const STRICT_TRANSACTIONAL_ERROR_PATTERN =
              /(?:tên đăng nhập|mật khẩu|tài khoản|username|password|credentials|mã ưu đãi|mã giảm giá|voucher|coupon|mã otp|\botp\b|dữ liệu|đầu vào|thao tác|giao dịch|yêu cầu|thanh toán|đăng nhập|xác thực|phiên làm việc|session|email|số điện thoại).{0,45}(?:không chính xác|không đúng|không hợp lệ|thất bại|bị từ chối|không tồn tại|bị khóa|hết hạn|invalid|incorrect|wrong|failed|denied|do not match|not found|unauthorized|forbidden|required|bắt buộc)/i;

            const allNodes = collectNodes(document.body || document.documentElement, []);

            const newBlockingAlerts = [];
            const newAdvisoryAlerts = [];
            let staleAlertsCount = 0;
            const seenFrameTexts = new Set();

            for (const el of allNodes) {
              if (!matchAny(el, combinedAlertSelector)) continue;
              if (!isDiagVisible(el)) continue;

              const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
              if (!text) continue;

              const textKey = normalizeTextKey(text);
              const tag = el.tagName.toLowerCase();
              const id = (el.id || "").toLowerCase();
              const role = (el.getAttribute("role") || "").toLowerCase();
              const dataType = (el.getAttribute("data-type") || "").toLowerCase();
              const sig = `${tag}|${id}|${role}|${textKey}`;

              // Layer 2: Temporal Baseline Subtraction (trừ hoàn toàn alert đã có sẵn từ trước)
              if (bId) {
                const stampedId = el.getAttribute("data-at-baseline-id");
                const stampedText = el.getAttribute("data-at-baseline-text");
                const isStampedSame = stampedId === bId && stampedText === textKey;
                const isInSigBaseline = bSigSet.has(`${fUrl}::${sig}`);
                const isInTextBaseline = bTextSet.has(`${fUrl}::${textKey}`);
                if (isStampedSame || isInSigBaseline || isInTextBaseline) {
                  staleAlertsCount++;
                  continue;
                }
              }

              // Khử trùng lặp node lồng nhau có cùng văn bản
              if (seenFrameTexts.has(textKey)) continue;
              seenFrameTexts.add(textKey);

              const cls = getClassString(el);
              const isNegatedSuccess = NEGATED_SUCCESS_PATTERN.test(text);
              const isNegatedError = NEGATED_ERROR_PATTERN.test(text);

              const isSuccessClass = SUCCESS_CLASS_PATTERN.test(cls) || dataType === "success";
              const isSuccessText = !isNegatedSuccess && (SUCCESS_TEXT_PATTERN.test(text) || isNegatedError);
              if (isSuccessClass || isSuccessText) {
                continue;
              }

              const outOfScope = isOutOfScopeNode(el);
              const isWarningOrInfoClass =
                WARNING_OR_INFO_CLASS_PATTERN.test(cls) || dataType === "warning" || dataType === "info";
              const isAdvisoryText = ADVISORY_TEXT_PATTERN.test(text);

              const isExplicitErrorClass =
                id === "error" ||
                el.dataset?.test === "error" ||
                el.dataset?.testid === "error" ||
                dataType === "error" ||
                EXPLICIT_ERROR_CLASS_PATTERN.test(cls);

              const isStrictErrorText =
                !isNegatedError &&
                (isNegatedSuccess ||
                  STRICT_ERROR_PREFIX_PATTERN.test(text) ||
                  STRICT_TRANSACTIONAL_ERROR_PATTERN.test(text));

              const inSubmittedForm = isInsideSubmittedFormOrContainer(el);

              // Phân loại cuối cùng theo Ma trận Ngữ nghĩa (Layer 3 + Layer 4)
              if (outOfScope || isWarningOrInfoClass || isAdvisoryText) {
                newAdvisoryAlerts.push({
                  text: text.slice(0, 200),
                  severity: "ADVISORY",
                  reason: outOfScope
                    ? "out_of_scope_region"
                    : isWarningOrInfoClass
                      ? "warning_or_info_class"
                      : "advisory_policy_text",
                  frameUrl: fUrl,
                });
                continue;
              }

              if (isExplicitErrorClass && !isNegatedError) {
                newBlockingAlerts.push({
                  text: text.slice(0, 200),
                  severity: "BLOCKING_ERROR",
                  confidence: "high",
                  reason: "explicit_error_class",
                  inSubmittedForm,
                  isExplicitErrorClass: true,
                  frameUrl: fUrl,
                });
                continue;
              }

              if (role === "alert" && isStrictErrorText) {
                newBlockingAlerts.push({
                  text: text.slice(0, 200),
                  severity: "BLOCKING_ERROR",
                  confidence: inSubmittedForm ? "high" : "medium",
                  reason: "role_alert_strict_error_text",
                  inSubmittedForm,
                  isExplicitErrorClass: false,
                  frameUrl: fUrl,
                });
                continue;
              }

              if (role === "alert" || role === "status") {
                newAdvisoryAlerts.push({
                  text: text.slice(0, 200),
                  severity: "ADVISORY",
                  reason: role === "status" ? "aria_status_region" : "generic_role_alert_non_error",
                  frameUrl: fUrl,
                });
              }
            }

            // Layer 3: Form-Scoped Validation (CHỈ kiểm tra khi thực sự Submit form!)
            let formValidationError = null;
            if (checkFormValidation) {
              const uiFeedbackSelector = [
                '[aria-invalid="true"]',
                ".is-invalid",
                ".has-error",
                ".ant-form-item-explain-error",
                ".MuiFormHelperText-root.Mui-error",
                ".invalid-feedback",
                ".field-error",
                ".error-text",
              ].join(", ");

              const html5InvalidSelector = "input:invalid, select:invalid, textarea:invalid";

              const extractValidationMsg = (invalidEl) => {
                let msg = "";
                if (invalidEl.validationMessage) {
                  msg = invalidEl.validationMessage;
                } else if (invalidEl.getAttribute?.("aria-errormessage")) {
                  const errId = invalidEl.getAttribute("aria-errormessage");
                  const errEl = errId ? document.getElementById(errId) : null;
                  if (errEl && isDiagVisible(errEl)) {
                    msg = (errEl.innerText || errEl.textContent || "").trim();
                  }
                }
                if (!msg && !/^(INPUT|SELECT|TEXTAREA)$/i.test(invalidEl.tagName)) {
                  msg = (invalidEl.innerText || invalidEl.textContent || "").replace(/\s+/g, " ").trim();
                }
                if (!msg) {
                  const parentGroup = invalidEl.closest?.(".form-group, .ant-form-item, .MuiFormControl-root, form, div");
                  const feedback = parentGroup?.querySelector?.(
                    ".invalid-feedback, .ant-form-item-explain-error, .MuiFormHelperText-root.Mui-error, .error-text, .field-error"
                  );
                  if (feedback && isDiagVisible(feedback)) {
                    msg = (feedback.innerText || feedback.textContent || "").replace(/\s+/g, " ").trim();
                  }
                }
                return msg;
              };

              const isBaselineValidationEl = (el) => {
                if (!bId) return false;
                if (el.getAttribute?.("data-at-baseline-val-id") === bId) return true;
                const rawText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
                const valKey = `${el.tagName.toLowerCase()}|${el.id || ""}|${normalizeTextKey(rawText)}`;
                return bValSet.has(`${fUrl}::${valKey}`);
              };

              if (formKeySet.size > 0) {
                // Chỉ quét đúng thẻ <form> đã được submit!
                for (const fk of formKeySet) {
                  const formEl = document.querySelector(`[data-at-form-key="${fk}"]`);
                  if (!formEl || !isDiagVisible(formEl)) continue;
                  const formNodes = collectNodes(formEl, []);
                  const allowHtml5Invalid = nativeFormSubmit && !formEl.noValidate;

                  for (const node of formNodes) {
                    const isUiFeedback = matchAny(node, uiFeedbackSelector);
                    const isHtml5Invalid = allowHtml5Invalid && matchAny(node, html5InvalidSelector);
                    if (!isUiFeedback && !isHtml5Invalid) continue;
                    if (!isDiagVisible(node)) continue;
                    if (isUiFeedback && !isHtml5Invalid && isBaselineValidationEl(node)) continue;

                    const msg = extractValidationMsg(node);
                    formValidationError = (
                      msg || "Trường dữ liệu bắt buộc bị bỏ trống hoặc không đúng định dạng"
                    ).slice(0, 200);
                    break;
                  }
                  if (formValidationError) break;
                }
              } else if (!legacyMode) {
                // Submit nút ngoài thẻ <form> (React/Vue custom form): CHỈ bắt feedback lỗi UI MỚI hiển thị, KHÔNG quét input:invalid toàn cục!
                for (const node of allNodes) {
                  if (!matchAny(node, uiFeedbackSelector)) continue;
                  if (!isDiagVisible(node)) continue;
                  if (isOutOfScopeNode(node)) continue;
                  if (isBaselineValidationEl(node)) continue;
                  const msg = extractValidationMsg(node);
                  if (msg) {
                    formValidationError = msg.slice(0, 200);
                    break;
                  }
                }
              }
            }

            // Kiểm tra mã lỗi Server 500 / 502 / 503 / 504 hiển thị trên trang
            let serverError = null;
            const title = document.title || "";
            const bodyText = document.body ? (document.body.innerText || "").slice(0, 600) : "";
            if (
              /500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout/i.test(title) ||
              /500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout/i.test(bodyText)
            ) {
              serverError = title || "500 Internal Server Error";
            }

            return {
              newBlockingAlerts,
              newAdvisoryAlerts,
              staleAlertsCount,
              formValidationError,
              serverError,
            };
          },
          {
            fUrl: frameUrl,
            bId: baselineId,
            bSigs: baselineSignatures,
            bTexts: baselineTextKeys,
            bVals: baselineValKeys,
            checkFormValidation: didSubmit,
            nativeFormSubmit: isFormSubmit,
            formKeys: submittedFormKeys,
            legacyMode: legacyUnscopedMode,
          }
        );
      } catch {
        frameDiag = null;
      }

      if (!frameDiag) continue;
      aggregated.staleAlertsCount += Number(frameDiag.staleAlertsCount || 0);

      for (const b of frameDiag.newBlockingAlerts || []) {
        if (!seenBlockingTexts.has(b.text)) {
          seenBlockingTexts.add(b.text);
          aggregated.newBlockingAlerts.push(b);
        }
      }

      for (const a of frameDiag.newAdvisoryAlerts || []) {
        if (!seenAdvisoryTexts.has(a.text)) {
          seenAdvisoryTexts.add(a.text);
          aggregated.newAdvisoryAlerts.push(a);
        }
      }

      if (frameDiag.formValidationError && !aggregated.formValidationError) {
        aggregated.formValidationError = frameDiag.formValidationError;
      }
      if (frameDiag.serverError && !aggregated.serverError) {
        aggregated.serverError = frameDiag.serverError;
      }
    }

    // Ưu tiên alert nằm trong form vừa submit lên đầu danh sách blocking
    aggregated.newBlockingAlerts.sort((a, b) => Number(Boolean(b.inSubmittedForm)) - Number(Boolean(a.inSubmittedForm)));

    if (aggregated.newBlockingAlerts.length > 0) {
      aggregated.isErrorAlert = true;
      aggregated.alertText = aggregated.newBlockingAlerts[0].text;
    }

    return aggregated;
  } catch (diagErr) {
    logger.debug("Bỏ qua lỗi kiểm tra chẩn đoán sau act:", diagErr.message);
    return aggregated;
  }
}

/**
 * Bộ Tổng Hợp Nhân Quả 4 Lớp + Bảo Toàn Khế Ước Kiểm Thử (4-Layer Causal Fusion Engine)
 * Hàm thuần (pure function), dễ kiểm thử đơn vị tuyệt đối.
 */
export function evaluateCausalDiagnostics({
  baseline = null,
  postDiag = {},
  telemetryDelta = null,
  actionContext = {},
  stepText = "",
  remainingSteps = [],
  strictness = DIAGNOSTIC_STRICTNESS.BALANCED,
} = {}) {
  const mode = normalizeStrictnessMode(strictness, DIAGNOSTIC_STRICTNESS.BALANCED);
  const safeRemaining = Array.isArray(remainingSteps) ? remainingSteps : [];
  const isExpectingError =
    stepHasErrorIntent(stepText, actionContext?.stepType || "") ||
    safeRemaining.some((ns) => stepHasErrorIntent(ns?.text ?? ns ?? "", ns?.type || ""));

  const nextStep = safeRemaining[0];
  const nextStepText = String(nextStep?.text ?? nextStep ?? "").trim();
  const nextStepIsExplicitAssert = Boolean(
    nextStep && (nextStep.type === "assert" || EXPLICIT_ASSERT_STEP_PATTERN.test(nextStepText))
  );

  const didClickOrSubmit = Boolean(actionContext?.didClickOrSubmit);
  const didSubmit = Boolean(actionContext?.didSubmit);
  const didNavigateCommand = Boolean(actionContext?.didNavigateCommand);
  const switchedTab = Boolean(actionContext?.switchedTab);

  const startRouteKey = baseline?.routeKey || normalizeUrlForRoute(actionContext?.stepStartUrl);
  const endRouteKey = normalizeUrlForRoute(actionContext?.stepEndUrl);
  const navigatedToNewRoute =
    typeof actionContext?.navigatedToNewRoute === "boolean"
      ? actionContext.navigatedToNewRoute
      : Boolean(startRouteKey && endRouteKey && startRouteKey !== endRouteKey);

  const primaryOriginUrl = actionContext?.stepStartUrl || actionContext?.stepEndUrl || baseline?.url || "";

  // Layer 1: Network Causality Signals
  const allResponses = Array.isArray(telemetryDelta?.responses) ? telemetryDelta.responses : [];
  const sameOriginApiResponses = allResponses.filter(
    (r) =>
      (r.resourceType === "xhr" || r.resourceType === "fetch") &&
      isSameOriginUrl(r.url, primaryOriginUrl)
  );
  const server5xxResponses = (Array.isArray(telemetryDelta?.serverErrorResponses)
    ? telemetryDelta.serverErrorResponses
    : []
  ).filter((r) => isSameOriginUrl(r.url, primaryOriginUrl));

  const failedApiResponses = sameOriginApiResponses.filter(
    (r) => r.status >= 400 || r.isBusinessError || r.failed
  );
  const mutationApiResponses = sameOriginApiResponses.filter((r) =>
    MUTATION_HTTP_METHODS.has(String(r.method || "").toUpperCase())
  );
  const failedMutationApis = mutationApiResponses.filter(
    (r) => r.status >= 400 || r.isBusinessError || r.failed
  );
  const hasSuccessfulMutationApi =
    mutationApiResponses.some((r) => r.status >= 200 && r.status < 300 && !r.isBusinessError && !r.failed) &&
    failedMutationApis.length === 0 &&
    server5xxResponses.length === 0;
  const hasFailedApi = failedApiResponses.length > 0;

  const uncaughtPageErrors = (Array.isArray(telemetryDelta?.pageErrors) ? telemetryDelta.pageErrors : []).filter(
    (e) => e.type === "pageerror"
  );

  const authRedirects = (Array.isArray(telemetryDelta?.authErrorResponses)
    ? telemetryDelta.authErrorResponses
    : []
  ).filter((a) => a.type === "auth_redirect");

  // Reconcile UI Alerts qua Layer 1 (Network) & Layer 2 (Navigation / Tab Switch)
  const rawBlocking = Array.isArray(postDiag?.newBlockingAlerts) ? postDiag.newBlockingAlerts : [];
  const rawAdvisory = Array.isArray(postDiag?.newAdvisoryAlerts) ? postDiag.newAdvisoryAlerts : [];

  const advisoryWarnings = [];
  const pushAdvisory = (txt) => {
    const clean = String(txt || "").trim();
    if (clean && !advisoryWarnings.includes(clean)) {
      advisoryWarnings.push(clean);
    }
  };
  for (const adv of rawAdvisory) {
    pushAdvisory(adv.text);
  }

  const effectiveBlocking = [];
  const isCleanDestinationLanding =
    (didNavigateCommand || navigatedToNewRoute || switchedTab) &&
    !hasFailedApi &&
    server5xxResponses.length === 0 &&
    authRedirects.length === 0;

  for (const blk of rawBlocking) {
    if (isCleanDestinationLanding) {
      // Banner/alert trên trang đích vừa chuyển sang hoặc tab mới mở không phải lỗi của cú click điều hướng
      pushAdvisory(blk.text);
      continue;
    }
    if (hasSuccessfulMutationApi) {
      // Quy tắc vàng Layer 1: API nghiệp vụ trả về 200 OK thành công -> alert UI không được đánh rớt test
      pushAdvisory(blk.text);
      continue;
    }
    effectiveBlocking.push(blk);
  }

  const causalSummary = {
    strictness: mode,
    isExpectingError,
    nextStepIsExplicitAssert,
    didClickOrSubmit,
    didSubmit,
    navigatedToNewRoute,
    switchedTab,
    hasSuccessfulMutationApi,
    hasFailedApi,
    server5xxCount: server5xxResponses.length,
    uncaughtPageErrorsCount: uncaughtPageErrors.length,
    staleAlertsIgnored: Number(postDiag?.staleAlertsCount || 0),
    effectiveBlockingCount: effectiveBlocking.length,
    advisoryCount: advisoryWarnings.length,
  };

  const makeFail = ({ severity, failureType, message, detectedAlert, expected, actual }) => ({
    verdict: "fail",
    severity,
    failureType,
    isProductDefect: true,
    message,
    detectedAlert,
    advisoryWarnings,
    evidence: {
      oracleSource: ORACLE_SOURCES.CAUSAL_GUARDRAIL,
      expected,
      actual,
      passed: false,
    },
    causalSummary,
  });

  // Trường hợp kịch bản âm tính (chủ đích kiểm tra lỗi): KHÔNG fail bước thao tác, chỉ ghi nhận alert mới
  if (isExpectingError) {
    return {
      verdict: "pass",
      severity: DIAGNOSTIC_SEVERITY.BENIGN,
      failureType: null,
      isProductDefect: false,
      message: null,
      detectedAlert: effectiveBlocking[0]?.text || rawBlocking[0]?.text || null,
      advisoryWarnings,
      evidence: null,
      causalSummary,
    };
  }

  // Tier 1: Lỗi máy chủ nghiêm trọng trên tài liệu chính (FATAL — áp dụng ở MỌI chế độ kể cả Explicit-Only)
  if (postDiag?.serverError) {
    return makeFail({
      severity: DIAGNOSTIC_SEVERITY.FATAL,
      failureType: FAILURE_TYPES.EXECUTION_ERROR,
      message: `Phát hiện lỗi máy chủ trên giao diện: ${postDiag.serverError}`,
      detectedAlert: postDiag.serverError,
      expected: "Trang web hoạt động bình thường (không sập máy chủ 5xx)",
      actual: postDiag.serverError,
    });
  }

  // Chế độ EXPLICIT-ONLY (Chuẩn Playwright thuần):
  // Bước thao tác không tự đánh rớt bằng heuristic ngầm — nhường 100% quyền phán quyết cho bước Kiểm tra (Assert)
  if (mode === DIAGNOSTIC_STRICTNESS.EXPLICIT) {
    for (const blk of effectiveBlocking) pushAdvisory(blk.text);
    if (postDiag?.formValidationError) pushAdvisory(`Form Validation: ${postDiag.formValidationError}`);
    return {
      verdict: "pass",
      severity: advisoryWarnings.length > 0 ? DIAGNOSTIC_SEVERITY.ADVISORY : DIAGNOSTIC_SEVERITY.BENIGN,
      failureType: null,
      isProductDefect: false,
      message: null,
      detectedAlert: null,
      advisoryWarnings,
      evidence: null,
      causalSummary,
    };
  }

  // Tier 1B: API máy chủ trả về HTTP 5xx (áp dụng ở Balanced & Strict)
  if (didClickOrSubmit && server5xxResponses.length > 0) {
    const first5xx = server5xxResponses[0];
    const hint = first5xx.errorHint || `HTTP ${first5xx.status}`;
    return makeFail({
      severity: DIAGNOSTIC_SEVERITY.FATAL,
      failureType: FAILURE_TYPES.EXECUTION_ERROR,
      message: `Phát hiện lỗi máy chủ (HTTP ${first5xx.status}) sau thao tác: ${hint}`,
      detectedAlert: hint,
      expected: `API ${first5xx.method || ""} phản hồi thành công (< 500)`.trim(),
      actual: `HTTP ${first5xx.status}: ${hint}`,
    });
  }

  // Tier 2A: Lỗi nghiệp vụ có đối soát tín hiệu Mạng (API 4xx / HTTP 200 JSON business error)
  if (didClickOrSubmit && hasFailedApi) {
    if (effectiveBlocking.length > 0) {
      return makeFail({
        severity: DIAGNOSTIC_SEVERITY.BLOCKING_ERROR,
        failureType: FAILURE_TYPES.SILENT_FAILURE,
        message: `Phát hiện cảnh báo lỗi trên giao diện sau thao tác: ${effectiveBlocking[0].text}`,
        detectedAlert: effectiveBlocking[0].text,
        expected: "Thao tác hoàn tất không phát sinh lỗi nghiệp vụ",
        actual: effectiveBlocking[0].text,
      });
    }

    if (failedMutationApis.length > 0 && !navigatedToNewRoute && !switchedTab) {
      const firstFailed = failedMutationApis[0];
      const hint = firstFailed.errorHint || `HTTP ${firstFailed.status}`;
      return makeFail({
        severity: DIAGNOSTIC_SEVERITY.BLOCKING_ERROR,
        failureType: FAILURE_TYPES.SILENT_FAILURE,
        message: `Phát hiện lỗi nghiệp vụ từ API (HTTP ${firstFailed.status}) sau thao tác: ${hint}`,
        detectedAlert: hint,
        expected: `API ${firstFailed.method || "POST"} thành công (HTTP 2xx, không lỗi nghiệp vụ)`,
        actual: `HTTP ${firstFailed.status}: ${hint}`,
      });
    }
  }

  // Tier 2B: Lỗi nghiệp vụ thuần Client-Side (không gọi API, vd SauceDemo) có độ tin cậy cao
  if (didClickOrSubmit && !hasSuccessfulMutationApi && effectiveBlocking.length > 0) {
    const topErr = effectiveBlocking[0];
    const isHighConfidence =
      (didSubmit && topErr.confidence === "high") ||
      (topErr.isExplicitErrorClass && topErr.inSubmittedForm) ||
      (topErr.confidence === "high" && !nextStepIsExplicitAssert);

    if (isHighConfidence) {
      return makeFail({
        severity: DIAGNOSTIC_SEVERITY.BLOCKING_ERROR,
        failureType: FAILURE_TYPES.SILENT_FAILURE,
        message: `Phát hiện cảnh báo lỗi trên giao diện sau thao tác: ${topErr.text}`,
        detectedAlert: topErr.text,
        expected: "Không xuất hiện cảnh báo lỗi chặn thao tác",
        actual: topErr.text,
      });
    }

    // Layer 5 (Intent Preservation): Tín hiệu mơ hồ khi bước sau đã có Assert rõ ràng -> nhường quyền phán quyết cho bước Assert
    pushAdvisory(topErr.text);
  }

  // Tier 2C: Lỗi Form Validation cục bộ trong đúng biểu mẫu vừa Submit
  if (didSubmit && !navigatedToNewRoute && !switchedTab && !hasSuccessfulMutationApi && postDiag?.formValidationError) {
    return makeFail({
      severity: DIAGNOSTIC_SEVERITY.BLOCKING_ERROR,
      failureType: FAILURE_TYPES.SILENT_FAILURE,
      message: `Phát hiện lỗi kiểm tra dữ liệu biểu mẫu (Form Validation): ${postDiag.formValidationError}`,
      detectedAlert: postDiag.formValidationError,
      expected: "Biểu mẫu hợp lệ và được gửi đi",
      actual: `Form Validation: ${postDiag.formValidationError}`,
    });
  }

  // Tier 2D (Chỉ ở chế độ STRICT - Ngân hàng/Y tế/Enterprise):
  // Đánh rớt khi có Uncaught JavaScript Exception hoặc bất kỳ API same-origin 4xx/5xx nào
  if (mode === DIAGNOSTIC_STRICTNESS.STRICT) {
    if (uncaughtPageErrors.length > 0) {
      const firstJsErr = uncaughtPageErrors[0];
      return makeFail({
        severity: DIAGNOSTIC_SEVERITY.BLOCKING_ERROR,
        failureType: FAILURE_TYPES.SILENT_FAILURE,
        message: `[Chế độ Strict] Phát hiện lỗi JavaScript chưa được xử lý (Uncaught Error): ${firstJsErr.message}`,
        detectedAlert: firstJsErr.message,
        expected: "Không phát sinh ngoại lệ JavaScript chưa xử lý (0 uncaught pageerror)",
        actual: firstJsErr.message,
      });
    }
    if (hasFailedApi) {
      const firstApiErr = failedApiResponses[0];
      const hint = firstApiErr.errorHint || `HTTP ${firstApiErr.status}`;
      return makeFail({
        severity: DIAGNOSTIC_SEVERITY.BLOCKING_ERROR,
        failureType: FAILURE_TYPES.SILENT_FAILURE,
        message: `[Chế độ Strict] Phát hiện API lỗi (HTTP ${firstApiErr.status}): ${hint}`,
        detectedAlert: hint,
        expected: "Tất cả API cùng nguồn phản hồi thành công (< 400)",
        actual: `${firstApiErr.method || "GET"} ${firstApiErr.url} -> HTTP ${firstApiErr.status} (${hint})`,
      });
    }
  }

  // Tier 3: Đạt yêu cầu (PASS) — giữ lại các cảnh báo phi chặn (Advisory) vào uxWarnings nếu có
  return {
    verdict: "pass",
    severity: advisoryWarnings.length > 0 ? DIAGNOSTIC_SEVERITY.ADVISORY : DIAGNOSTIC_SEVERITY.BENIGN,
    failureType: null,
    isProductDefect: false,
    message: null,
    detectedAlert: null,
    advisoryWarnings,
    evidence: null,
    causalSummary,
  };
}

/**
 * API tương thích ngược: chẩn đoán nhanh giao diện (khuyến nghị dùng cặp captureUiDiagnosticBaseline + inspectUiDiagnostics + evaluateCausalDiagnostics)
 */
export async function checkUiDiagnostics(targetPage, options = {}) {
  return await inspectUiDiagnostics(targetPage, options);
}
