import fs from "node:fs";
import { config } from "../../config/env.js";
import { FAILURE_TYPES, ORACLE_SOURCES } from "../../constants/stepTypes.js";
import { logger } from "../../utils/logger.js";
import { storageService } from "../storage.service.js";
import {
  CONTAINER_TIER1_SELECTORS,
  CONTAINER_TIER2_SELECTORS,
  CONTAINER_ANCHOR_SELECTOR_STRING,
} from "./dom-selectors.js";
import { obstructionResolverService } from "./obstruction-resolver.service.js";

/**
 * KHỐI 2: BỘ 12 THAO TÁC NGUYÊN TỬ TOÀN NĂNG TRÊN PLAYWRIGHT GỐC (ATOMIC ACTIONS ENGINE)
 * - Thực thi trực tiếp trên Playwright Native (không qua Stagehand).
 * - Hỗ trợ cả 2 chế độ:
 *   1. Chạy từ ID đánh số trực tiếp (Live ID từ Vòng lặp Vi mô AI) -> Tự trích xuất Fingerprint.
 *   2. Phát lại từ Chứng minh thư phần tử (Replay Fingerprint từ Băng ghi Cache - 0 gọi AI).
 * - Giải quyết trọn vẹn 14 bài toán khó: Cascading Dropdown đợi tải, Custom Div Dropdown,
 *   Hover hiện nút ẩn, OTP 6 ô rời, Iframe xuyên thấu, Đa Tab, Hộp thoại Accept/Dismiss,
 *   Truyền biến động {{LAST_EXTRACTED}} / {{ten_bien}} và Canh chừng liên tục (Polling Assert).
 */
export class AtomicActionsService {
  constructor(
    storage = storageService,
    customConfig = config,
    obstructionResolver = obstructionResolverService
  ) {
    this.storage = storage;
    this.config = customConfig;
    this.obstructionResolver = obstructionResolver;
  }

  /**
   * Tạo lỗi kiểm chứng có cấu trúc (Expected vs Actual Evidence) chuẩn Big Tech
   */
  _createVerdictError(message, evidence = null, failureType = FAILURE_TYPES.ASSERTION_FAILED) {
    const err = new Error(message);
    err.failureType = failureType;
    err.isProductDefect =
      failureType === FAILURE_TYPES.ASSERTION_FAILED ||
      failureType === FAILURE_TYPES.HTTP_ERROR ||
      failureType === FAILURE_TYPES.SILENT_FAILURE ||
      failureType === FAILURE_TYPES.POST_CONDITION_FAILED;
    if (evidence) {
      err.evidence = evidence;
    }
    return err;
  }

  /**
   * Chuyển chuỗi tiền tệ/phần trăm/số (hỗ trợ cả "58.500.000đ", "6,500,000", "125.5", "80%") sang số thực
   */
  _parseNumericValue(raw) {
    const str = String(raw ?? "").trim();
    if (!str) return null;
    const match = str.match(/-?\d[\d.,\s]*/);
    if (!match) return null;
    let numStr = match[0].replace(/\s+/g, "");
    const dots = (numStr.match(/\./g) || []).length;
    const commas = (numStr.match(/,/g) || []).length;
    if (dots > 1 && commas === 0) {
      // VD: "58.500.000" -> 58500000
      numStr = numStr.replace(/\./g, "");
    } else if (commas > 1 && dots === 0) {
      // VD: "58,500,000" -> 58500000
      numStr = numStr.replace(/,/g, "");
    } else if (dots === 1 && commas === 0) {
      // VD: "58.500" (3 chữ số sau dấu chấm -> hàng nghìn VN) vs "125.5" (số thập phân)
      const parts = numStr.split(".");
      if (parts[1]?.length === 3 && parts[0].replace("-", "").length >= 1) {
        numStr = parts.join("");
      }
    } else if (commas === 1 && dots === 0) {
      const parts = numStr.split(",");
      numStr = parts[1]?.length === 3 ? parts.join("") : parts.join(".");
    } else if (dots >= 1 && commas >= 1) {
      if (numStr.lastIndexOf(",") > numStr.lastIndexOf(".")) {
        numStr = numStr.replace(/\./g, "").replace(",", ".");
      } else {
        numStr = numStr.replace(/,/g, "");
      }
    }
    const val = Number(numStr);
    return Number.isFinite(val) ? val : null;
  }

  /**
   * Ẩn giá trị nhạy cảm trong thông điệp log/step khi chuỗi gốc chứa biến isSecret
   */
  _formatDisplayValue(rawValue, resolvedValue, session) {
    const rawStr = String(rawValue ?? "");
    const secretKeys = session?.secretKeys;
    if (secretKeys instanceof Set && secretKeys.size > 0) {
      let hasSecretRef = false;
      rawStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        if (secretKeys.has(key)) hasSecretRef = true;
      });
      if (hasSecretRef) {
        return "******";
      }
    }
    return String(resolvedValue ?? "");
  }

  /**
   * Lấy sự kiện hộp thoại/download trong phạm vi bước hiện tại (hoặc ngay bước liền trước nếu bước này là Assert nối tiếp)
   */
  _getScopedTelemetry(session, type) {
    const curKey = type === "downloads" ? "currentStepDownloads" : "currentStepDialogs";
    const prevKey = type === "downloads" ? "prevStepDownloads" : "prevStepDialogs";
    const current = Array.isArray(session?.[curKey]) ? session[curKey] : [];
    if (current.length > 0) return current;
    return Array.isArray(session?.[prevKey]) ? session[prevKey] : [];
  }

  /**
   * Thay thế các biến {{ten_bien}} hoặc {{LAST_EXTRACTED}} trong chuỗi đầu vào bằng giá trị thực trong session.vars
   */
  resolveVars(rawStr, vars = {}) {
    if (typeof rawStr !== "string" || !rawStr) return "";
    return rawStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      if (vars[key] !== undefined && vars[key] !== null) {
        return String(vars[key]);
      }
      if (key === "LAST_EXTRACTED" && vars.LAST_EXTRACTED !== undefined) {
        return String(vars.LAST_EXTRACTED);
      }
      return `{{${key}}}`;
    });
  }

  /**
   * Trích xuất ngữ cảnh biểu mẫu / nút gửi (Form & Submit Context) phục vụ Chẩn đoán Nhân quả Tầng 3.
   * Gắn khóa tạm `data-at-form-key` lên thẻ `<form>` chứa phần tử để chỉ kiểm tra validation trong đúng form đó.
   */
  async _inspectSubmitContext(locator, { isEnterKey = false } = {}) {
    try {
      return await locator.evaluate((el, { enterKey }) => {
        if (!el || el.nodeType !== 1) {
          return { isSubmitAction: false, isFormSubmit: false, formKey: null };
        }
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();
        const role = (el.getAttribute("role") || "").toLowerCase();
        const text = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim();
        const form = el.form || el.closest?.("form") || null;

        let formKey = null;
        if (form) {
          formKey = form.getAttribute("data-at-form-key");
          if (!formKey) {
            formKey = `at_form_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            try {
              form.setAttribute("data-at-form-key", formKey);
            } catch { }
          }
        }

        if (enterKey) {
          return {
            isSubmitAction: Boolean(form) || tag === "input" || tag === "button",
            isFormSubmit: Boolean(form),
            formKey,
            targetTag: tag,
            targetType: type,
            targetText: text.slice(0, 80),
          };
        }

        const isCheckboxOrToggle =
          type === "checkbox" ||
          type === "radio" ||
          role === "checkbox" ||
          role === "radio" ||
          role === "switch" ||
          (tag === "label" && Boolean(el.querySelector?.('input[type="checkbox"], input[type="radio"]')));

        const isExplicitSubmit =
          !isCheckboxOrToggle &&
          ((tag === "button" && (type === "submit" || (!type && Boolean(form)))) ||
            (tag === "input" && (type === "submit" || type === "image")));

        const isSemanticSubmitButton =
          !isCheckboxOrToggle &&
          (tag === "button" || role === "button" || (tag === "input" && type === "button")) &&
          /(đăng nhập|login|sign in|log in|submit|gửi|xác nhận|confirm|lưu|save|đăng ký|register|sign up|thanh toán|checkout|pay|áp dụng|apply|tiếp tục|continue|tạo|create|hoàn tất|finish|đặt hàng|order)/i.test(
            text
          );

        return {
          isSubmitAction: isExplicitSubmit || isSemanticSubmitButton,
          isFormSubmit: isExplicitSubmit,
          formKey,
          targetTag: tag,
          targetType: type,
          targetText: text.slice(0, 80),
        };
      }, { enterKey: isEnterKey });
    } catch {
      return { isSubmitAction: false, isFormSubmit: false, formKey: null };
    }
  }

  async _inspectActiveElementSubmitContext(page) {
    try {
      return await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) {
          return { isSubmitAction: false, isFormSubmit: false, formKey: null };
        }
        const tag = el.tagName.toLowerCase();
        const form = el.form || el.closest?.("form") || null;
        let formKey = null;
        if (form) {
          formKey = form.getAttribute("data-at-form-key");
          if (!formKey) {
            formKey = `at_form_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            try {
              form.setAttribute("data-at-form-key", formKey);
            } catch { }
          }
        }
        return {
          isSubmitAction: Boolean(form) || tag === "input" || tag === "button",
          isFormSubmit: Boolean(form),
          formKey,
          targetTag: tag,
        };
      });
    } catch {
      return { isSubmitAction: false, isFormSubmit: false, formKey: null };
    }
  }

  /**
   * Trích xuất Chứng minh thư bền vững (Fingerprint) từ thông tin phần tử đã quét
   */
  extractFingerprint(meta) {
    if (!meta) return null;
    return {
      frameIndex: meta.frameIndex || 0,
      frameName: meta.frameName || "",
      inModal: Boolean(meta.inModal),
      tag: meta.tag || "",
      type: meta.type || "",
      role: meta.role || "",
      elemId: meta.elemId || "",
      testId: meta.testId || "",
      name: meta.name || "",
      alt: meta.alt || "",
      label: meta.label || "",
      cleanLabel: meta.cleanLabel || "",
      groupLabel: meta.groupLabel || "",
      title: meta.title || "",
      iconHint: meta.iconHint || "",
      placeholder: meta.placeholder || "",
      text: meta.text || "",
      containerAnchor: meta.containerAnchor || "",
      sectionAnchor: meta.sectionAnchor || "",
      region: meta.region || "",
      occurrenceIndex: Number.isInteger(meta.occurrenceIndex) ? meta.occurrenceIndex : 0,
      occurrenceTotal: Number.isInteger(meta.occurrenceTotal) ? meta.occurrenceTotal : 1,
    };
  }

  _escapeAttrValue(val) {
    return String(val ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  _attrSelector(attrName, val) {
    return `[${attrName}="${this._escapeAttrValue(val)}"]`;
  }

  _isAutoGeneratedId(idStr) {
    const val = String(idStr || "").trim();
    if (!val) return false;
    return /^(?::r[0-9a-z]+:|«r[0-9a-z]+»|mui-\d+|ember\d+|el-id-\d+-\d+|react-select-\d+-|headlessui-[a-z-]+-\d+|radix-:[0-9a-z]+:)/i.test(
      val
    );
  }

  _escapeRegExp(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  _buildExactMatcher(rawText) {
    const cleanText = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!cleanText) return null;
    const parts = cleanText.split(" ").map((p) => this._escapeRegExp(p));
    return new RegExp(`^\\s*${parts.join("\\s+")}\\s*$`, "i");
  }

  /**
   * Làm sạch nhãn hiển thị khỏi các ký hiệu trang trí (*, :, •, (bắt buộc), (required), (optional), (?))
   */
  _cleanLabelText(raw) {
    let s = String(raw || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    let prev = "";
    while (s !== prev) {
      prev = s;
      s = s.replace(/^[\s*:•]+/, "").trim();
      s = s.replace(/\s*\((?:bắt buộc|bat buoc|required|optional|\?)\)\s*$/i, "").trim();
      s = s.replace(/[\s*:•]+$/, "").trim();
    }
    return s.replace(/\s+/g, " ").trim();
  }

  /**
   * Tách văn bản gốc của nút/liên kết khỏi hậu tố bộ đếm động (vd: "Giỏ hàng (3)" -> "Giỏ hàng")
   */
  _stripDynamicBadge(raw) {
    const s = String(raw || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const stripped = s
      .replace(/(?:\s*(?:\(\s*\d+\+?\s*\)|\[\s*\d+\+?\s*\])|\s+\d+\+?)\s*$/, "")
      .trim();
    return stripped && stripped !== s ? stripped : "";
  }

  /**
   * Tạo RegExp khớp nhãn sạch kèm tùy chọn ký hiệu trang trí (*, :, •, (bắt buộc), (required), (optional), (?))
   */
  _buildCleanLabelMatcher(raw) {
    const cleaned = this._cleanLabelText(raw) || String(raw || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    const parts = cleaned.split(/\s+/).map((p) => this._escapeRegExp(p));
    const core = parts.join("\\s+");
    const leadingDeco = "(?:[*•]\\s*)*";
    const trailingDeco = "(?:\\s*(?:[*•:]|\\((?:bắt buộc|bat buoc|required|optional|\\?)\\)))*";
    return new RegExp(`^\\s*${leadingDeco}${core}${trailingDeco}\\s*$`, "i");
  }

  /**
   * Tạo RegExp thân thiện với bộ đếm động trên nút/liên kết
   * (vd: baseText="Giỏ hàng" khớp "Giỏ hàng", "Giỏ hàng (3)", "Giỏ hàng 12", "Giỏ hàng [5]")
   */
  _buildBadgeFriendlyMatcher(baseText) {
    const cleaned = this._cleanLabelText(baseText) || String(baseText || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    const parts = cleaned.split(/\s+/).map((p) => this._escapeRegExp(p));
    const core = parts.join("\\s+");
    return new RegExp(
      `^\\s*${core}(?:\\s*(?:\\(\\s*\\d+\\+?\\s*\\)|\\[\\s*\\d+\\+?\\s*\\]|\\d+\\+?))?\\s*$`,
      "i"
    );
  }

  /**
   * Suy luận W3C ARIA Role chuẩn cho các ô biểu mẫu (chặn textbox cho input[type="password"])
   */
  _inferFormControlRole(tag, type, role, isCustomCombobox) {
    if (role && !["generic", "none", "presentation"].includes(role)) {
      return role;
    }
    if (isCustomCombobox || tag === "select") {
      return "combobox";
    }
    if (tag === "textarea") {
      return "textbox";
    }
    if (tag === "input") {
      if (type === "search") return "searchbox";
      if (type === "number") return "spinbutton";
      if (!type || ["text", "email", "tel", "url"].includes(type)) return "textbox";
      // password, file, date, range, color... không có role textbox theo HTML-AAM
      return "";
    }
    return "";
  }

  _getRegionSelector(region) {
    const r = String(region || "").toLowerCase().trim();
    if (r === "header") return 'header, [role="banner"]';
    if (r === "nav") return 'nav, [role="navigation"], [class*="sidebar"]';
    if (r === "footer") return 'footer, [role="contentinfo"]';
    if (r === "aside") return 'aside, [role="complementary"]';
    if (r === "main") return 'main, [role="main"]';
    return "";
  }

  async _pickSmallestVisibleContainer(candidates, { excludeHeaderSubParts = false } = {}) {
    const cnt = await candidates.count().catch(() => 0);
    if (cnt === 0) return null;

    let bestIdx = -1;
    let bestLen = Infinity;
    const maxCheck = Math.min(cnt, 25);

    for (let i = 0; i < maxCheck; i++) {
      const nth = candidates.nth(i);
      const info = await nth
        .evaluate(
          (el, { excludeSubParts }) => {
            if (excludeSubParts) {
              const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
              if (
                /(?:^|[\s_-])(header|heading|title|label|caption|footer|badge|icon|desc|description|help|error)(?:$|[\s_-])/i.test(
                  cls
                )
              ) {
                return { vis: false, len: Infinity };
              }
            }
            const st = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const vis =
              st.display !== "none" &&
              st.visibility !== "hidden" &&
              st.visibility !== "collapse" &&
              parseFloat(st.opacity) !== 0 &&
              rect.width > 0 &&
              rect.height > 0;
            const len = (el.innerText || el.textContent || "").trim().length;
            return { vis, len };
          },
          { excludeSubParts: excludeHeaderSubParts }
        )
        .catch(() => ({ vis: false, len: Infinity }));
      if (info.vis && info.len > 0 && info.len < bestLen) {
        bestLen = info.len;
        bestIdx = i;
      }
    }

    return bestIdx >= 0 ? candidates.nth(bestIdx) : null;
  }

  /**
   * Tìm modal / dialog / drawer đang mở ở lớp trên cùng
   */
  async _resolveModalScope(targetFrame) {
    const modalSelector = [
      "dialog[open]",
      '[role="dialog"]',
      '[role="alertdialog"]',
      ".modal.show",
      ".modal.in",
      ".ant-modal",
      ".ant-drawer-content-wrapper",
      ".MuiDialog-paper",
      '[class*="drawer"][class*="open"]',
      '[data-state="open"][role="dialog"]',
      ".swal2-popup",
    ].join(", ");

    const candidates = targetFrame.locator(modalSelector);
    const cnt = await candidates.count().catch(() => 0);
    if (cnt === 0) return null;

    let bestIdx = -1;
    let bestZ = -Infinity;
    const maxCheck = Math.min(cnt, 15);

    for (let i = 0; i < maxCheck; i++) {
      const nth = candidates.nth(i);
      const info = await nth
        .evaluate((el) => {
          if (el.hidden || el.getAttribute("aria-hidden") === "true") {
            return { vis: false, z: 0 };
          }
          const st = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const vis =
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            st.visibility !== "collapse" &&
            parseFloat(st.opacity) !== 0 &&
            rect.width >= 120 &&
            rect.height >= 60;
          const z = Number.parseInt(st.zIndex, 10);
          return { vis, z: Number.isFinite(z) ? z : 0 };
        })
        .catch(() => ({ vis: false, z: 0 }));
      if (info.vis && (bestIdx === -1 || info.z >= bestZ)) {
        bestZ = info.z;
        bestIdx = i;
      }
    }

    return bestIdx >= 0 ? candidates.nth(bestIdx) : null;
  }

  /**
   * Tìm nhóm câu hỏi (radio/checkbox group) nhỏ nhất đang hiển thị khớp groupLabel
   */
  async _resolveGroupScope(baseScope, groupLabel) {
    const cleaned = this._cleanLabelText(groupLabel) || String(groupLabel || "").trim();
    if (!cleaned) return null;

    const cleanGroupMatcher = this._buildCleanLabelMatcher(cleaned);
    if (cleanGroupMatcher) {
      const byRadioGroup = baseScope.getByRole("radiogroup", { name: cleanGroupMatcher });
      const pickedRg = await this._pickSmallestVisibleContainer(byRadioGroup, {
        excludeHeaderSubParts: true,
      });
      if (pickedRg) return pickedRg;

      const byGroup = baseScope.getByRole("group", { name: cleanGroupMatcher });
      const pickedGrp = await this._pickSmallestVisibleContainer(byGroup, {
        excludeHeaderSubParts: true,
      });
      if (pickedGrp) return pickedGrp;
    }

    const groupSelector =
      'fieldset, [role="radiogroup"], .form-group, .ant-form-item, .MuiFormControl-root, [class*="field"]';
    const candidates = baseScope.locator(groupSelector).filter({ hasText: cleaned });
    return await this._pickSmallestVisibleContainer(candidates, { excludeHeaderSubParts: true });
  }

  /**
   * Tìm khối nội dung (fieldset/form/section/card/panel) nhỏ nhất đang hiển thị khớp sectionAnchor
   */
  async _resolveSectionScope(baseScope, sectionAnchor) {
    const cleaned = this._cleanLabelText(sectionAnchor) || String(sectionAnchor || "").trim();
    if (!cleaned) return null;

    const sectionSelector =
      'fieldset, form, section, [role="region"], [class*="card"], [class*="panel"]';
    const candidates = baseScope.locator(sectionSelector).filter({ hasText: cleaned });
    return await this._pickSmallestVisibleContainer(candidates, { excludeHeaderSubParts: true });
  }

  /**
   * Tìm container nhỏ nhất đang hiển thị khớp chính xác với containerAnchor.
   * TUYỆT ĐỐI KHÔNG rơi ngược về toàn bộ targetFrame nếu container đã biến mất (tránh bấm nhầm dòng khác).
   */
  async _resolveContainerScope(targetFrame, containerAnchor) {
    const tierSelectors = [
      CONTAINER_TIER1_SELECTORS.join(", "),
      CONTAINER_TIER2_SELECTORS.join(", "),
    ];

    for (const sel of tierSelectors) {
      const candidates = targetFrame.locator(sel).filter({ hasText: containerAnchor });
      const picked = await this._pickSmallestVisibleContainer(candidates);
      if (picked) return picked;
    }

    const combined = targetFrame.locator(CONTAINER_ANCHOR_SELECTOR_STRING).filter({ hasText: containerAnchor });
    const fallbackPicked = await this._pickSmallestVisibleContainer(combined);
    if (fallbackPicked) return fallbackPicked;

    return null;
  }

  _buildSemanticCandidates(scope, fp, rootFrame = null) {
    const candidates = [];
    const relFactory =
      rootFrame || (typeof scope?.parentFrame === "function" ? scope : scope?.page?.()) || scope;
    const stableElemId = fp.elemId && !this._isAutoGeneratedId(fp.elemId) ? fp.elemId : "";
    const tag = String(fp.tag || "").toLowerCase();
    const role = String(fp.role || "").toLowerCase();
    const type = String(fp.type || "").toLowerCase();

    const isFormTag = tag === "input" || tag === "select" || tag === "textarea";
    const isButtonInput = tag === "input" && ["button", "submit", "reset", "image"].includes(type);
    const isChoiceControl =
      (tag === "input" && (type === "radio" || type === "checkbox")) ||
      role === "checkbox" ||
      role === "radio" ||
      role === "switch";
    const isCustomCombobox =
      role === "combobox" ||
      (!isFormTag &&
        !isChoiceControl &&
        Boolean(fp.label || fp.cleanLabel) &&
        !fp.text &&
        Boolean(fp.placeholder));
    const isFormControl = (isFormTag && !isButtonInput && !isChoiceControl) || isCustomCombobox;

    const rawLabel = String(fp.label || "").trim();
    const cleanLabel = String(fp.cleanLabel || "").trim() || this._cleanLabelText(rawLabel);
    const effectiveLabel = cleanLabel || rawLabel;
    const rawDisplayLabel = rawLabel || fp.text || fp.title || "";
    const displayLabel = effectiveLabel || fp.text || fp.title || "";

    const textExact = fp.text ? this._buildExactMatcher(fp.text) : null;
    const labelExact = rawLabel ? this._buildExactMatcher(rawLabel) : null;
    const cleanLabelMatcher = effectiveLabel ? this._buildCleanLabelMatcher(effectiveLabel) : null;
    const altExact = fp.alt ? this._buildExactMatcher(fp.alt) : null;
    const placeholderExact = fp.placeholder ? this._buildExactMatcher(fp.placeholder) : null;
    const displayExact = rawDisplayLabel ? this._buildExactMatcher(rawDisplayLabel) : null;
    const cleanDisplayMatcher = displayLabel ? this._buildCleanLabelMatcher(displayLabel) : null;

    const normRawText = String(fp.text || "").replace(/\s+/g, " ").trim().toLowerCase();
    const normClean = cleanLabel.toLowerCase();
    const badgeBase =
      cleanLabel && normRawText && normClean !== normRawText
        ? cleanLabel
        : this._stripDynamicBadge(fp.text);
    const badgeFriendlyMatcher = badgeBase ? this._buildBadgeFriendlyMatcher(badgeBase) : null;

    // ─── TIER 1: STABLE TECHNICAL IDENTITY (ID bền vững & data-testid) ───
    if (stableElemId) {
      candidates.push(scope.locator(this._attrSelector("id", stableElemId)));
    }

    if (fp.testId) {
      candidates.push(
        scope.locator(
          `${this._attrSelector("data-testid", fp.testId)}, ${this._attrSelector("data-test", fp.testId)}`
        )
      );
    }

    // ─── TIER 2: W3C ACCESSIBLE NAME (Label, Role+Name, Alt — ƯU TIÊN TRƯỚC PLACEHOLDER!) ───
    if (isChoiceControl) {
      const effectiveChoiceRole =
        role === "switch" || role === "radio" || role === "checkbox"
          ? role
          : type === "radio"
            ? "radio"
            : "checkbox";
      const choiceMatcher = cleanLabelMatcher || (fp.text ? this._buildCleanLabelMatcher(fp.text) : null);

      if (choiceMatcher) {
        candidates.push(scope.getByLabel(choiceMatcher));
      }
      if (labelExact && rawLabel && rawLabel !== cleanLabel) {
        candidates.push(scope.getByLabel(labelExact));
      }
      if (choiceMatcher) {
        candidates.push(scope.getByRole(effectiveChoiceRole, { name: choiceMatcher }));
      }
      if (labelExact && rawLabel && rawLabel !== cleanLabel) {
        candidates.push(scope.getByRole(effectiveChoiceRole, { name: labelExact }));
      }
      if (rawLabel) {
        if (tag) {
          candidates.push(scope.locator(`${tag}${this._attrSelector("aria-label", rawLabel)}`));
        }
        candidates.push(scope.locator(this._attrSelector("aria-label", rawLabel)));
      }
      if (cleanLabel && cleanLabel !== rawLabel && tag) {
        candidates.push(scope.locator(`${tag}${this._attrSelector("aria-label", cleanLabel)}`));
      }
      if (fp.name && rawLabel) {
        candidates.push(
          scope.locator(
            `${tag || "input"}${this._attrSelector("name", fp.name)}${this._attrSelector("aria-label", rawLabel)}`
          )
        );
      }
      // Fallback cho switch/radio/checkbox có nhãn hiển thị liền kề không gắn label[for] hay aria-label
      if (choiceMatcher) {
        const choiceXpathPred =
          effectiveChoiceRole === "switch"
            ? '@role="switch"'
            : effectiveChoiceRole === "radio"
              ? '(self::input and @type="radio") or @role="radio"'
              : '(self::input and @type="checkbox") or @role="checkbox"';
        const choiceCssSel =
          effectiveChoiceRole === "switch"
            ? '[role="switch"]'
            : effectiveChoiceRole === "radio"
              ? 'input[type="radio"], [role="radio"]'
              : 'input[type="checkbox"], [role="checkbox"]';
        const adjTextNodes = scope
          .locator('label, span, p, [class*="label"]')
          .filter({ hasText: choiceMatcher });
        candidates.push(adjTextNodes.locator(`xpath=preceding-sibling::*[${choiceXpathPred}][1]`));
        candidates.push(adjTextNodes.locator(`xpath=following-sibling::*[${choiceXpathPred}][1]`));
        const adjDivNodes = scope.locator("div").filter({ hasText: choiceMatcher });
        candidates.push(adjDivNodes.locator(`xpath=preceding-sibling::*[1][${choiceXpathPred}]`));
        candidates.push(adjDivNodes.locator(`xpath=following-sibling::*[1][${choiceXpathPred}]`));
        candidates.push(
          scope
            .locator('.form-group, .ant-form-item, .MuiFormControl-root, .form-field, [class*="switch"], [class*="toggle"]')
            .filter({
              has: relFactory.locator('label, span, p, [class*="label"]').filter({ hasText: choiceMatcher }),
            })
            .locator(choiceCssSel)
        );
      }
    }

    if (isFormControl) {
      if (cleanLabelMatcher) {
        candidates.push(scope.getByLabel(cleanLabelMatcher));
      }
      if (labelExact && rawLabel && rawLabel !== cleanLabel) {
        candidates.push(scope.getByLabel(labelExact));
      }
      if (effectiveLabel.length >= 60) {
        candidates.push(scope.getByLabel(effectiveLabel, { exact: false }));
      }

      const inferredRole = this._inferFormControlRole(tag, type, role, isCustomCombobox);
      if (inferredRole && cleanLabelMatcher) {
        candidates.push(scope.getByRole(inferredRole, { name: cleanLabelMatcher }));
        if (labelExact && rawLabel && rawLabel !== cleanLabel) {
          candidates.push(scope.getByRole(inferredRole, { name: labelExact }));
        }
      }

      if (rawLabel) {
        if (tag) {
          candidates.push(scope.locator(`${tag}${this._attrSelector("aria-label", rawLabel)}`));
        }
        candidates.push(scope.locator(this._attrSelector("aria-label", rawLabel)));
      }
      if (cleanLabel && cleanLabel !== rawLabel) {
        if (tag) {
          candidates.push(scope.locator(`${tag}${this._attrSelector("aria-label", cleanLabel)}`));
        }
        candidates.push(scope.locator(this._attrSelector("aria-label", cleanLabel)));
      }

      // Liên kết nhãn trực quan cho Custom Combobox (AntD/MUI) & Sibling-label input không có for/id
      if (cleanLabelMatcher) {
        let controlXpathPred = "";
        let controlCssSel = "";
        if (isCustomCombobox) {
          controlXpathPred =
            '@role="combobox" or @aria-haspopup="listbox" or contains(@class, "select-selector") or contains(@class, "Select-select") or contains(@class, "select-trigger")';
          controlCssSel =
            '[role="combobox"], [aria-haspopup="listbox"], .ant-select-selector, .MuiSelect-select, [class*="select-trigger"]';
        } else if (tag === "select") {
          controlXpathPred = "self::select";
          controlCssSel = "select";
        } else if (tag === "textarea") {
          controlXpathPred = "self::textarea";
          controlCssSel = "textarea";
        } else {
          controlXpathPred =
            'self::input and (not(@type) or (@type!="hidden" and @type!="checkbox" and @type!="radio" and @type!="submit" and @type!="button" and @type!="reset"))';
          controlCssSel =
            'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"])';
        }

        const fieldLabelNodes = scope
          .locator('label, .label, [class*="label"], span, p, dt')
          .filter({ hasText: cleanLabelMatcher });
        candidates.push(fieldLabelNodes.locator(`xpath=following-sibling::*[${controlXpathPred}][1]`));
        candidates.push(fieldLabelNodes.locator("xpath=following-sibling::*[1]").locator(controlCssSel));
        candidates.push(
          scope
            .locator('.ant-form-item, .MuiFormControl-root, .form-group, .form-field, .input-group, [class*="form-item"]')
            .filter({
              has: relFactory
                .locator('label, .label, [class*="label"], span, p')
                .filter({ hasText: cleanLabelMatcher }),
            })
            .locator(controlCssSel)
        );
        candidates.push(
          scope
            .locator("div")
            .filter({ hasText: cleanLabelMatcher })
            .locator(`xpath=following-sibling::*[1][${controlXpathPred}]`)
        );
      }
    }

    // Buttons / Links / Tabs / MenuItems & các role tương tác có tên
    const isButtonLike = tag === "button" || role === "button" || isButtonInput;
    const isLinkLike = tag === "a" || role === "link";
    const isOtherNamedRole =
      Boolean(role) &&
      !["button", "link", "generic", "none", "presentation"].includes(role) &&
      !isChoiceControl &&
      !isFormControl;

    if (displayExact) {
      if (isButtonLike) {
        candidates.push(scope.getByRole("button", { name: displayExact }));
      }
      if (isLinkLike) {
        candidates.push(scope.getByRole("link", { name: displayExact }));
      }
      if (isOtherNamedRole) {
        candidates.push(scope.getByRole(role, { name: displayExact }));
      }
    }

    if (badgeFriendlyMatcher) {
      if (isButtonLike) {
        candidates.push(scope.getByRole("button", { name: badgeFriendlyMatcher }));
      }
      if (isLinkLike) {
        candidates.push(scope.getByRole("link", { name: badgeFriendlyMatcher }));
      }
      if (isOtherNamedRole) {
        candidates.push(scope.getByRole(role, { name: badgeFriendlyMatcher }));
      }
    } else if (cleanDisplayMatcher && displayLabel !== rawDisplayLabel) {
      if (isButtonLike) {
        candidates.push(scope.getByRole("button", { name: cleanDisplayMatcher }));
      }
      if (isLinkLike) {
        candidates.push(scope.getByRole("link", { name: cleanDisplayMatcher }));
      }
      if (isOtherNamedRole) {
        candidates.push(scope.getByRole(role, { name: cleanDisplayMatcher }));
      }
    }

    if (!isChoiceControl && !isFormControl) {
      if (rawLabel) {
        if (tag) {
          candidates.push(scope.locator(`${tag}${this._attrSelector("aria-label", rawLabel)}`));
        }
        candidates.push(scope.locator(this._attrSelector("aria-label", rawLabel)));
      }
      if (cleanLabel && cleanLabel !== rawLabel && tag) {
        candidates.push(scope.locator(`${tag}${this._attrSelector("aria-label", cleanLabel)}`));
      }
    }

    // Images (alt text)
    if (tag === "img" || fp.alt) {
      if (altExact) {
        candidates.push(scope.getByAltText(altExact));
      }
      if (fp.alt) {
        candidates.push(scope.locator(`img${this._attrSelector("alt", fp.alt)}`));
        candidates.push(scope.locator(this._attrSelector("alt", fp.alt)));
      }
    }

    // ─── TIER 3: W3C ACCESSIBLE DESCRIPTION / HINT (Placeholder & Title) ───
    if (fp.placeholder && placeholderExact) {
      candidates.push(scope.getByPlaceholder(placeholderExact));
      if (fp.placeholder.length >= 60) {
        candidates.push(scope.getByPlaceholder(fp.placeholder, { exact: false }));
      }
      if (isCustomCombobox) {
        candidates.push(scope.locator(this._attrSelector("aria-placeholder", fp.placeholder)));
        candidates.push(scope.locator(this._attrSelector("data-placeholder", fp.placeholder)));
      }
    }

    if (fp.title) {
      if (tag) {
        candidates.push(scope.locator(`${tag}${this._attrSelector("title", fp.title)}`));
      }
      candidates.push(scope.locator(this._attrSelector("title", fp.title)));
    }

    // ─── TIER 4: TECHNICAL FORM NAME & ICON / TEXT FALLBACKS ───
    if (fp.name && isFormTag && !isChoiceControl) {
      candidates.push(scope.locator(`${tag}${this._attrSelector("name", fp.name)}`));
    }

    const iconHint = String(fp.iconHint || "").trim();
    const isIconOnly = Boolean(iconHint && !fp.text && !rawLabel && !cleanLabel && !fp.alt);
    if (isIconOnly) {
      const escapedHint = this._escapeAttrValue(iconHint);
      const tagPrefix = tag && tag !== "svg" && tag !== "i" ? tag : "";
      const iconAttrSel = [
        this._attrSelector("data-icon", iconHint),
        this._attrSelector("data-lucide", iconHint),
        this._attrSelector("aria-label", iconHint),
        this._attrSelector("title", iconHint),
      ].join(", ");
      const iconContainsSel = [
        `[data-icon*="${escapedHint}" i]`,
        `[data-lucide*="${escapedHint}" i]`,
        `[aria-label*="${escapedHint}" i]`,
        `[title*="${escapedHint}" i]`,
        `[class*="${escapedHint}" i]`,
      ].join(", ");

      if (iconHint === "close-x") {
        const closeSel =
          '[class*="close" i], [aria-label*="close" i], [aria-label*="đóng" i], [title*="close" i], [title*="đóng" i], [data-icon*="close" i], [data-lucide="x"]';
        if (tagPrefix) {
          candidates.push(
            scope.locator(
              `${tagPrefix}[class*="close" i], ${tagPrefix}[aria-label*="close" i], ${tagPrefix}[aria-label*="đóng" i], ${tagPrefix}[title*="close" i], ${tagPrefix}[title*="đóng" i]`
            )
          );
          candidates.push(scope.locator(tagPrefix).filter({ has: relFactory.locator(closeSel) }));
        } else {
          candidates.push(scope.locator(closeSel));
        }
      } else if (iconHint !== "svg" && iconHint !== "icon") {
        if (tagPrefix) {
          candidates.push(
            scope.locator(
              `${tagPrefix}${this._attrSelector("data-icon", iconHint)}, ${tagPrefix}${this._attrSelector("data-lucide", iconHint)}, ${tagPrefix}${this._attrSelector("aria-label", iconHint)}, ${tagPrefix}${this._attrSelector("title", iconHint)}`
            )
          );
          candidates.push(scope.locator(tagPrefix).filter({ has: relFactory.locator(iconAttrSel) }));
          candidates.push(scope.locator(`${tagPrefix}[class*="${escapedHint}" i]`));
          candidates.push(scope.locator(tagPrefix).filter({ has: relFactory.locator(iconContainsSel) }));
        }
        candidates.push(scope.locator(iconAttrSel));
        candidates.push(scope.locator(iconContainsSel));
      } else if (tagPrefix) {
        candidates.push(
          scope.locator(tagPrefix).filter({
            has: relFactory.locator('svg, i[class], [class*="icon"]'),
          })
        );
      }
    }

    // Với custom combobox, KHÔNG dùng fp.text biến động làm định danh khi đã có label/cleanLabel/placeholder
    const skipVolatileComboboxText =
      isCustomCombobox && Boolean(rawLabel || cleanLabel || fp.placeholder);

    if (fp.text && textExact && !skipVolatileComboboxText) {
      if (isButtonInput) {
        candidates.push(scope.locator(`input${this._attrSelector("value", fp.text)}`));
      }
      if (tag && !isFormTag) {
        candidates.push(scope.locator(tag).filter({ hasText: textExact }));
        if (badgeFriendlyMatcher) {
          candidates.push(scope.locator(tag).filter({ hasText: badgeFriendlyMatcher }));
        }
        if (fp.text.length >= 65) {
          candidates.push(scope.locator(tag).filter({ hasText: fp.text }));
        }
      }
      if (tag === "button" || role === "button") {
        candidates.push(
          scope
            .locator("button, [role='button'], a[role='button'], input[type='button'], input[type='submit']")
            .filter({ hasText: textExact })
        );
        if (badgeFriendlyMatcher) {
          candidates.push(
            scope
              .locator("button, [role='button'], a[role='button'], input[type='button'], input[type='submit']")
              .filter({ hasText: badgeFriendlyMatcher })
          );
        }
      } else if (!isFormTag) {
        candidates.push(scope.getByText(textExact));
        if (badgeFriendlyMatcher) {
          candidates.push(scope.getByText(badgeFriendlyMatcher));
        }
        if (fp.text.length >= 65) {
          candidates.push(scope.getByText(fp.text, { exact: false }));
        }
      }
    }

    if (fp.name && !isFormTag) {
      candidates.push(scope.locator(`${tag || ""}${this._attrSelector("name", fp.name)}`));
    }

    if (displayLabel && displayLabel.length >= 65) {
      if (tag === "button" || role === "button") {
        candidates.push(scope.getByRole("button", { name: displayLabel, exact: false }));
      } else if (tag === "a" || role === "link") {
        candidates.push(scope.getByRole("link", { name: displayLabel, exact: false }));
      }
    }

    return candidates;
  }

  async _resolveInScope(scope, targetFrame, fp, targetRank, { requireUniqueIfRanked = false } = {}) {
    const candidates = this._buildSemanticCandidates(scope, fp, targetFrame);
    const needCount = requireUniqueIfRanked && targetRank > 0 ? 2 : targetRank + 1;
    for (const cand of candidates) {
      try {
        const cnt = await cand.count();
        if (cnt <= 0) continue;
        const visibleList = [];
        const maxScan = Math.min(cnt, Math.max(15, targetRank + 10));
        for (let idx = 0; idx < maxScan; idx++) {
          const nthLoc = cand.nth(idx);
          if (await nthLoc.isVisible().catch(() => false)) {
            visibleList.push(nthLoc);
            if (visibleList.length >= needCount) break;
          }
        }
        if (visibleList.length > 0) {
          if (requireUniqueIfRanked && targetRank > 0 && visibleList.length > 1) {
            // Nhiều phần tử khớp trong <main> khi targetRank là chỉ số toàn trang -> nhường cho phạm vi targetFrame
            return null;
          }
          const chosen = visibleList[targetRank] || visibleList[0];
          return { locator: chosen, frame: targetFrame, meta: fp, fingerprint: fp };
        }
      } catch { }
    }
    return null;
  }

  async _tryResolveReplayOnce(page, fp) {
    const frames = page.frames();
    let targetFrame = page.mainFrame();

    if (fp.frameName) {
      const byName = frames.find((f) => f.name() === fp.frameName);
      if (!byName) return null;
      targetFrame = byName;
    } else if (fp.frameIndex > 0) {
      if (!frames[fp.frameIndex]) return null;
      targetFrame = frames[fp.frameIndex];
    }

    const targetRank =
      Number.isInteger(fp.occurrenceIndex) && fp.occurrenceIndex >= 0 ? fp.occurrenceIndex : 0;

    // 1. Khung neo dòng cha (containerAnchor) luôn là phạm vi nghiêm ngặt bậc 1 — không fallback ra toàn trang
    if (fp.containerAnchor) {
      let containerScope = null;
      if (fp.inModal) {
        const modalScope = await this._resolveModalScope(targetFrame);
        if (modalScope) {
          containerScope = await this._resolveContainerScope(modalScope, fp.containerAnchor);
        }
      }
      if (!containerScope) {
        containerScope = await this._resolveContainerScope(targetFrame, fp.containerAnchor);
      }
      if (!containerScope) return null;
      return await this._resolveInScope(containerScope, targetFrame, fp, targetRank);
    }

    // 2. Khi không có containerAnchor: thu hẹp theo ngữ cảnh Modal -> Group -> Section -> Landmark -> fallback targetFrame
    const modalScope = fp.inModal ? await this._resolveModalScope(targetFrame) : null;
    const primaryBase = modalScope || targetFrame;

    if (fp.groupLabel) {
      const groupScope = await this._resolveGroupScope(primaryBase, fp.groupLabel);
      if (groupScope) {
        const hit = await this._resolveInScope(groupScope, targetFrame, fp, targetRank);
        if (hit) return hit;
      }
    } else if (fp.sectionAnchor) {
      const sectionScope = await this._resolveSectionScope(primaryBase, fp.sectionAnchor);
      if (sectionScope) {
        const hit = await this._resolveInScope(sectionScope, targetFrame, fp, targetRank);
        if (hit) return hit;
      }
    } else if (fp.region) {
      const regionKey = String(fp.region).toLowerCase().trim();
      if (regionKey === "header" || regionKey === "nav" || regionKey === "footer" || regionKey === "aside") {
        const regionScope = primaryBase.locator(this._getRegionSelector(regionKey));
        if ((await regionScope.count().catch(() => 0)) > 0) {
          const hit = await this._resolveInScope(regionScope, targetFrame, fp, targetRank);
          if (hit) return hit;
        }
      } else if (regionKey === "main" && !modalScope) {
        const mainScope = targetFrame.locator(this._getRegionSelector("main"));
        if ((await mainScope.count().catch(() => 0)) > 0) {
          const hit = await this._resolveInScope(mainScope, targetFrame, fp, targetRank, {
            requireUniqueIfRanked: true,
          });
          if (hit) return hit;
        }
      }
    }

    if (modalScope) {
      const modalHit = await this._resolveInScope(modalScope, targetFrame, fp, targetRank);
      if (modalHit) return modalHit;
    }

    return await this._resolveInScope(targetFrame, targetFrame, fp, targetRank);
  }

  /**
   * Định vị phần tử Playwright từ Live ID (khi có AI) hoặc từ Fingerprint (khi Replay từ Cache)
   */
  async resolveLocator(page, action, elementMap = null) {
    // 1. Chế độ Live ID (trong Vòng lặp Vi mô AI)
    if (action.targetId !== undefined && action.targetId !== null && elementMap) {
      const idNum = Number(action.targetId);
      const meta = elementMap.get(idNum);
      if (!meta) {
        throw new Error(`CACHE_MISS: Không tìm thấy phần tử số [${idNum}] trong bản quét hiện tại`);
      }
      const frames = page.frames();
      const targetFrame = frames[meta.frameIndex || 0] || page.mainFrame();
      const locator = targetFrame.locator(`[data-at-id="${idNum}"]`).first();
      const count = await locator.count().catch(() => 0);
      if (count === 0) {
        throw new Error(`CACHE_MISS: Phần tử [${idNum}] đã biến mất khỏi DOM`);
      }
      return {
        locator,
        frame: targetFrame,
        meta,
        fingerprint: this.extractFingerprint(meta),
      };
    }

    // 2. Chế độ Replay từ Fingerprint (Strict Semantic Contract + Web-First Auto-Wait ngắn)
    const fp = action.fingerprint;
    if (!fp) {
      throw new Error("CACHE_MISS: Thiếu thông tin định vị phần tử (fingerprint)");
    }

    const stableElemId = fp.elemId && !this._isAutoGeneratedId(fp.elemId) ? fp.elemId : "";
    const hasSemanticIdentity = Boolean(
      stableElemId ||
        fp.testId ||
        fp.name ||
        fp.alt ||
        fp.placeholder ||
        fp.cleanLabel ||
        fp.label ||
        fp.title ||
        fp.iconHint ||
        fp.text
    );

    if (!hasSemanticIdentity) {
      throw new Error(
        `CACHE_MISS: Fingerprint thiếu định danh ngữ nghĩa bền vững (${fp.tag || "unknown"}) - bắt buộc chuyển AI học lại`
      );
    }

    const replayTimeoutMs = Math.max(0, Number(action.replayTimeoutMs ?? 1800));
    const pollIntervalMs = 120;
    const deadline = Date.now() + replayTimeoutMs;

    while (true) {
      const resolved = await this._tryResolveReplayOnce(page, fp);
      if (resolved) {
        return resolved;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await page.waitForTimeout(Math.min(pollIntervalMs, remaining));
    }

    throw new Error(
      `CACHE_MISS: Không tìm thấy phần tử hiển thị khớp định danh ngữ nghĩa (${fp.tag || "element"} "${fp.cleanLabel || fp.label || fp.text || fp.alt || fp.placeholder || fp.iconHint || fp.elemId || fp.testId || fp.name
      }"${fp.containerAnchor ? `, vùng "${fp.containerAnchor}"` : ""})`
    );
  }

  /**
   * Tô viền nổi bật trực tiếp trên Locator (hỗ trợ cả trang chính lẫn iframe)
   */
  async highlightLocator(locator, { color = "#dc2626", badge = "MỤC TIÊU" } = {}) {
    if (!locator) return;
    try {
      await locator.evaluate(
        (el, { col, txt }) => {
          if (!el || !el.style) return;
          el.setAttribute("data-autotest-highlighted", "true");
          el.style.outline = `3px solid ${col}`;
          el.style.outlineOffset = "2px";
          el.style.boxShadow = `0 0 12px ${col}`;

          const doc = el.ownerDocument;
          let badgeEl = doc.getElementById("autotest-highlight-badge");
          if (!badgeEl) {
            badgeEl = doc.createElement("div");
            badgeEl.id = "autotest-highlight-badge";
            badgeEl.style.position = "absolute";
            badgeEl.style.zIndex = "2147483647";
            badgeEl.style.padding = "2px 8px";
            badgeEl.style.fontSize = "11px";
            badgeEl.style.fontWeight = "700";
            badgeEl.style.color = "#ffffff";
            badgeEl.style.borderRadius = "4px";
            badgeEl.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
            badgeEl.style.pointerEvents = "none";
            badgeEl.style.fontFamily = "system-ui, -apple-system, sans-serif";
            doc.body.appendChild(badgeEl);
          }
          badgeEl.style.backgroundColor = col;
          badgeEl.textContent = txt;
          const rect = el.getBoundingClientRect();
          const win = doc.defaultView || window;
          badgeEl.style.top = `${win.scrollY + Math.max(0, rect.top - 22)}px`;
          badgeEl.style.left = `${win.scrollX + rect.left}px`;
          badgeEl.style.display = "block";
        },
        { col: color, txt: badge }
      );
    } catch { }
  }

  async clearHighlights(page) {
    if (!page || page.isClosed?.()) return;
    for (const frame of page.frames()) {
      try {
        await frame.evaluate(() => {
          document.querySelectorAll("[data-autotest-highlighted]").forEach((el) => {
            el.removeAttribute("data-autotest-highlighted");
            el.style.outline = "";
            el.style.outlineOffset = "";
            el.style.boxShadow = "";
          });
          const badgeEl = document.getElementById("autotest-highlight-badge");
          if (badgeEl) badgeEl.style.display = "none";
        });
      } catch { }
    }
  }

  /**
   * Thực thi 1 thao tác nguyên tử trên trình duyệt
   * @returns {Promise<{ success: boolean, message: string, recordedAction: object, extractedValue?: string }>}
   */
  async executeAction(action, session, elementMap = null, takeShotFn = null) {
    const page = session.currentPage;
    const kind = (action.action || action.type || "click").toLowerCase().trim();
    const rawValue = action.value !== undefined && action.value !== null ? String(action.value) : "";
    const resolvedValue = this.resolveVars(rawValue, session.vars);

    // 1. NAVIGATE (Mở URL kèm Hậu kiểm cơ học HTTP Status < 400)
    if (kind === "navigate" || kind === "goto") {
      const targetUrl = resolvedValue || this.resolveVars(action.url || "", session.vars);
      const gotoTimeoutMs = Number(action.timeoutMs) || this.config?.timeouts?.gotoMs || 60000;
      const navResponse = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
      await page.waitForLoadState("networkidle", { timeout: 1200 }).catch(() => { });
      await page.waitForTimeout(250);
      const httpStatus = typeof navResponse?.status === "function" ? navResponse.status() : null;
      if (httpStatus && httpStatus >= 400 && action.allowHttpError !== true) {
        const statusText = typeof navResponse?.statusText === "function" ? navResponse.statusText() : "";
        const actualDesc = `HTTP ${httpStatus}${statusText ? ` ${statusText}` : ""} (${page.url() || targetUrl})`;
        throw this._createVerdictError(
          `Trang web trả về mã lỗi ${actualDesc} khi truy cập ${targetUrl}`,
          {
            oracleSource: ORACLE_SOURCES.MECHANICAL_ACTION,
            assertType: "httpStatus",
            expected: "Mã phản hồi HTTP < 400 (trang truy cập hợp lệ)",
            actual: actualDesc,
            passed: false,
          },
          FAILURE_TYPES.HTTP_ERROR
        );
      }
      return {
        success: true,
        message: `Đã mở trang ${targetUrl}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
        evidence: {
          oracleSource: ORACLE_SOURCES.MECHANICAL_ACTION,
          assertType: "navigate",
          expected: `Truy cập ${targetUrl} (HTTP < 400)`,
          actual: `${page.url() || targetUrl}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
          passed: true,
        },
        recordedAction: { action: "navigate", value: targetUrl },
      };
    }

    // 2. WAIT (Chờ thời gian)
    if (kind === "wait" || kind === "sleep") {
      const ms = Math.min(Math.max(Number(resolvedValue) || 1000, 100), 30000);
      await page.waitForTimeout(ms);
      return {
        success: true,
        message: `Đã chờ ${(ms / 1000).toFixed(1)} giây`,
        recordedAction: { action: "wait", value: String(ms) },
      };
    }

    // 3. SCROLL / RELOAD / GOBACK (Điều khiển trình duyệt)
    if (kind === "scroll") {
      const dir = (resolvedValue || "down").toLowerCase();
      await page.evaluate((d) => {
        if (d === "top" || d === "up") window.scrollTo({ top: 0, behavior: "smooth" });
        else if (d === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        else window.scrollBy({ top: 450, behavior: "smooth" });
      }, dir);
      await page.waitForTimeout(400);
      return {
        success: true,
        message: `Đã cuộn trang (${dir})`,
        recordedAction: { action: "scroll", value: dir },
      };
    }

    if (kind === "reload" || kind === "refresh") {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      return {
        success: true,
        message: "Đã tải lại trang (F5)",
        recordedAction: { action: "reload" },
      };
    }

    if (kind === "goback" || kind === "back") {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => { });
      await page.waitForTimeout(400);
      return {
        success: true,
        message: "Đã quay lại trang trước",
        recordedAction: { action: "goback" },
      };
    }

    // 4. SWITCH TAB (Quản lý Đa Tab: sang tab mới, về tab đầu, đóng tab hiện tại)
    if (kind === "switchtab" || kind === "tab") {
      const mode = (resolvedValue || "latest").toLowerCase();
      const allPages = session.context.pages().filter((p) => p && !p.isClosed());
      if (allPages.length === 0) {
        throw new Error("Không còn tab trình duyệt nào đang mở");
      }
      if (mode === "close" || mode === "closecurrent") {
        if (allPages.length > 1 && page && !page.isClosed()) {
          await page.close().catch(() => { });
          const remaining = session.context.pages().filter((p) => p && !p.isClosed());
          if (remaining.length > 0) {
            session.currentPage = remaining[remaining.length - 1];
            session.pagesCount = remaining.length;
            await session.currentPage.bringToFront().catch(() => { });
          }
        }
        return {
          success: true,
          message: `Đã đóng tab hiện tại và chuyển về tab còn lại`,
          recordedAction: { action: "switchTab", value: "close" },
        };
      } else if (mode === "first" || mode === "main" || mode === "0" || mode === "1") {
        session.currentPage = allPages[0];
        session.pagesCount = allPages.length;
        await session.currentPage.bringToFront().catch(() => { });
        await session.currentPage.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => { });
        return {
          success: true,
          message: `Đã chuyển về Tab gốc [1/${allPages.length}]`,
          recordedAction: { action: "switchTab", value: "first" },
        };
      } else {
        session.currentPage = allPages[allPages.length - 1];
        session.pagesCount = allPages.length;
        await session.currentPage.bringToFront().catch(() => { });
        await session.currentPage.waitForLoadState("domcontentloaded", { timeout: 1500 }).catch(() => { });
        return {
          success: true,
          message: `Đã chuyển sang Tab mới nhất [${allPages.length}/${allPages.length}]`,
          recordedAction: { action: "switchTab", value: "latest" },
        };
      }
    }

    // 5. HANDLE DIALOG (Đặt chế độ xử lý hộp thoại Alert / Confirm / Prompt: accept/dismiss + promptText)
    if (kind === "handledialog" || kind === "dialog") {
      const decision = /dismiss|cancel|hủy|từ chối|không/i.test(resolvedValue) ? "dismiss" : "accept";
      const rawPrompt = action.promptText !== undefined && action.promptText !== null
        ? String(action.promptText)
        : !/^(?:accept|dismiss|cancel|ok|yes|no)$/i.test(resolvedValue.trim()) && resolvedValue.trim()
          ? rawValue
          : undefined;
      const resolvedPromptText =
        rawPrompt !== undefined ? this.resolveVars(rawPrompt, session.vars) : undefined;

      session.nextDialogDecision = decision;
      session.nextDialogPromptText = resolvedPromptText;

      // Nếu có hộp thoại đang treo chờ xử lý ngay lúc này
      if (session.pendingDialog) {
        const dlg = session.pendingDialog;
        session.pendingDialog = null;
        if (decision === "dismiss") {
          await dlg.dismiss().catch(() => { });
        } else if (dlg.type?.() === "prompt" && resolvedPromptText !== undefined) {
          await dlg.accept(resolvedPromptText).catch(() => { });
        } else {
          await dlg.accept().catch(() => { });
        }
      }

      const displayPrompt =
        resolvedPromptText !== undefined
          ? ` (nhập "${this._formatDisplayValue(rawPrompt, resolvedPromptText, session)}")`
          : "";
      return {
        success: true,
        message: `Đã xử lý hộp thoại với quyết định: ${decision === "dismiss" ? "Hủy bỏ (Dismiss)" : "Đồng ý (Accept)"}${displayPrompt}`,
        recordedAction: {
          action: "handleDialog",
          value: decision,
          ...(rawPrompt !== undefined ? { promptText: rawPrompt } : {}),
        },
      };
    }

    // 6. PRESS KEY (Nhấn phím bàn phím: Enter, Tab, Escape...)
    if (kind === "presskey" || kind === "press" || kind === "key") {
      const keyName = resolvedValue || action.key || "Enter";
      const isEnterKey = /^enter$/i.test(String(keyName || "").trim());
      if (action.targetId || action.fingerprint) {
        const { locator, fingerprint } = await this.resolveLocator(page, action, elementMap);
        const actionMeta = isEnterKey
          ? await this._inspectSubmitContext(locator, { isEnterKey: true })
          : { isSubmitAction: false, isFormSubmit: false, formKey: null };
        await locator.press(keyName, { timeout: 5000 });
        await page.waitForTimeout(250);
        return {
          success: true,
          message: `Đã nhấn phím "${keyName}" trên phần tử`,
          actionMeta,
          recordedAction: { action: "pressKey", value: keyName, fingerprint },
        };
      } else {
        const actionMeta = isEnterKey
          ? await this._inspectActiveElementSubmitContext(page)
          : { isSubmitAction: false, isFormSubmit: false, formKey: null };
        await page.keyboard.press(keyName);
        await page.waitForTimeout(250);
        return {
          success: true,
          message: `Đã nhấn phím "${keyName}"`,
          actionMeta,
          recordedAction: { action: "pressKey", value: keyName },
        };
      }
    }

    // 6b. CLICK OUTSIDE (Bấm chuột ra ngoài vùng trống an toàn để đóng Dropdown/Popover tự chế)
    if (kind === "clickoutside" || kind === "clickblank" || kind === "dismissoverlay") {
      const pt = await this.obstructionResolver.clickSafeOutside(page);
      await page.waitForTimeout(250);
      return {
        success: true,
        message: `Đã bấm chuột ra vùng trống an toàn (${pt.x}, ${pt.y}) để đóng bảng nổi`,
        recordedAction: { action: "clickOutside" },
      };
    }

    // 7. UPLOAD FILE (Đính kèm tệp lên input[type="file"])
    if (kind === "uploadfile" || kind === "upload") {
      const fileName = resolvedValue || "tai_lieu_kiem_thu.xlsx";
      const localFilePath = await this.storage.createTempUploadFile(fileName);

      let uploaded = false;
      let savedFp = action.fingerprint || null;

      if (action.targetId || action.fingerprint) {
        try {
          const { locator, fingerprint } = await this.resolveLocator(page, action, elementMap);
          savedFp = fingerprint;
          const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
          const type = await locator.evaluate((el) => (el.type || "").toLowerCase()).catch(() => "");
          if (tag === "input" && type === "file") {
            await locator.setInputFiles(localFilePath);
            uploaded = true;
          } else {
            // Tìm input[type="file"] nằm gần hoặc mở filechooser khi click
            const [fileChooser] = await Promise.all([
              page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null),
              locator.click({ timeout: 3000 }).catch(() => { }),
            ]);
            if (fileChooser) {
              await fileChooser.setFiles(localFilePath);
              uploaded = true;
            }
          }
        } catch { }
      }

      if (!uploaded) {
        for (const frame of page.frames()) {
          const fileInput = frame.locator('input[type="file"]').first();
          if ((await fileInput.count().catch(() => 0)) > 0) {
            await fileInput.setInputFiles(localFilePath);
            uploaded = true;
            break;
          }
        }
      }

      if (!uploaded) {
        throw new Error(`Không tìm thấy ô tải tệp (input[type="file"]) để đính kèm "${fileName}"`);
      }

      await page.waitForTimeout(400);
      return {
        success: true,
        message: `Đã tải lên tệp "${fileName}" thành công`,
        recordedAction: { action: "uploadFile", value: fileName, fingerprint: savedFp },
      };
    }

    // 8. ASSERT (Bộ 8 Nguyên thủy Kiểm chứng Tất định Có Ngữ cảnh + Trọng tài AI assertVerdict)
    if (kind === "assert" || kind === "verify" || kind === "observe" || kind === "asserttext") {
      return await this.executePollingAssert(
        { ...action, assertType: action.assertType || "visible" },
        session,
        elementMap,
        takeShotFn
      );
    }

    // 8b. NEGATIVE ASSERT (Kiểm tra không xuất hiện / biến mất / đã bị xóa)
    if (
      kind === "assertnotexists" ||
      kind === "asserthidden" ||
      kind === "assertnotvisible" ||
      kind === "verifynotexists" ||
      kind === "verifyhidden"
    ) {
      return await this.executePollingAssert(
        { ...action, assertType: "hidden" },
        session,
        elementMap,
        takeShotFn
      );
    }

    // 8c. ASSERT URL (Kiểm tra URL / đường dẫn trang hiện tại)
    if (kind === "asserturl" || kind === "verifyurl" || kind === "asserturlnot") {
      return await this.executeAssertUrl(
        { ...action, negate: kind === "asserturlnot" || action.negate === true },
        session,
        takeShotFn
      );
    }

    // 8d. ASSERT STATE (Kiểm tra trạng thái phần tử: visible|hidden|enabled|disabled|checked|unchecked)
    if (kind === "assertstate" || kind === "verifystate") {
      return await this.executeAssertState(action, session, elementMap, takeShotFn);
    }

    // 8e. ASSERT VALUE (Kiểm tra giá trị ô input / select / textarea / Shadow DOM, hỗ trợ nonEmpty)
    if (kind === "assertvalue" || kind === "verifyvalue") {
      return await this.executeAssertValue(action, session, elementMap, takeShotFn);
    }

    // 8f. ASSERT COUNT (Kiểm tra số lượng phần tử / dòng bảng / thẻ chip: ==, >=, >, <=, <)
    if (kind === "assertcount" || kind === "verifycount") {
      return await this.executeAssertCount(action, session, elementMap, takeShotFn);
    }

    // 8g. ASSERT DOWNLOAD (Kiểm tra tệp tải về khớp tên & dung lượng > 0 bytes)
    if (kind === "assertdownload" || kind === "verifydownload") {
      return await this.executeAssertDownload(action, session, takeShotFn);
    }

    // 8h. ASSERT COMPARE / MATH (Kiểm tra đối chiếu giá trị số/tiền tệ/biến đã trích xuất)
    if (kind === "assertcompare" || kind === "assertmath" || kind === "verifycompare") {
      return await this.executeAssertCompare(action, session, elementMap, takeShotFn);
    }

    // 8i. ASSERT VERDICT (Trọng tài AI minh bạch kèm Expected/Actual — chống tự chấm đậu, không lưu cache mù)
    if (kind === "assertverdict" || kind === "judgeverdict") {
      return await this.executeAssertVerdict(action, session, takeShotFn);
    }

    // 9. EXTRACT (Đọc dữ liệu trên màn hình và cất vào Kho Biến session.vars)
    if (kind === "extract" || kind === "read") {
      return await this.executeExtract(action, session, elementMap, takeShotFn);
    }

    // Các thao tác còn lại đều cần định vị phần tử mục tiêu (click, hover, fill, select, setCheck, dragAndDrop)
    const { locator, frame, meta, fingerprint } = await this.resolveLocator(page, action, elementMap);

    // Tô viền đỏ trước khi tương tác và chụp ảnh before nếu chưa chụp
    await this.highlightLocator(locator, { color: "#dc2626", badge: "MỤC TIÊU TƯƠNG TÁC" });
    if (takeShotFn && !session.tookBeforeShotInCurrentStep) {
      session.tookBeforeShotInCurrentStep = true;
      await takeShotFn("before", {
        label: "Trước khi thực hiện",
        sublabel: `${kind.toUpperCase()}: ${fingerprint.cleanLabel || fingerprint.label || fingerprint.text || fingerprint.alt || fingerprint.placeholder || fingerprint.iconHint || fingerprint.elemId || ""}`.slice(0, 60),
      });
    }
    await this.clearHighlights(page);

    // 10. HOVER (Di chuột vào phần tử / dòng để làm hiện nút ẩn)
    if (kind === "hover") {
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => { });
      await locator.hover({ timeout: 5000 });
      await page.waitForTimeout(400);
      return {
        success: true,
        message: `Đã di chuột (hover) vào "${fingerprint.cleanLabel || fingerprint.label || fingerprint.text || fingerprint.alt || fingerprint.containerAnchor || fingerprint.elemId}"`,
        recordedAction: { action: "hover", fingerprint },
      };
    }

    // 11. FILL (Điền văn bản: tự chữa lành vật cản đè, hỗ trợ OTP 6 ô, Rich Text và Fallback có cảnh báo UX)
    if (kind === "fill" || kind === "type" || kind === "input") {
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => { });
      const targetLabel =
        fingerprint.cleanLabel ||
        fingerprint.label ||
        fingerprint.placeholder ||
        fingerprint.name ||
        fingerprint.elemId ||
        "ô nhập liệu";
      let uxWarning = null;
      const healNotes = [];

      // Tầng 2 (Nhịp 1 & 2): Phát hiện và tự giải phóng vật cản (dropdown, div giả checkbox, toast, modal, sticky bar) trước khi điền
      const preHeal = await this.obstructionResolver.ensureUnobstructed(page, frame, locator);
      if (preHeal.actionsTaken.length > 0) {
        healNotes.push(...preHeal.actionsTaken);
      }

      const elInfo = await locator
        .evaluate((el) => ({
          tag: el.tagName.toLowerCase(),
          type: (el.type || "").toLowerCase(),
          maxLength: el.maxLength,
          contentEditable: el.getAttribute("contenteditable") === "true",
        }))
        .catch(() => ({ tag: "input", type: "text", maxLength: -1, contentEditable: false }));

      // Trường hợp đặc biệt 1: Cụm 6 ô nhập mã OTP rời nhau (maxLength === 1 mà chuỗi điền > 1 ký tự)
      if (elInfo.tag === "input" && elInfo.maxLength === 1 && resolvedValue.length > 1) {
        await locator.evaluate((el, val) => {
          const parent = el.closest("div, form, section") || document.body;
          const otpInputs = Array.from(parent.querySelectorAll('input[maxlength="1"], input:not([type="hidden"])'));
          const startIdx = Math.max(0, otpInputs.indexOf(el));
          for (let i = 0; i < val.length && startIdx + i < otpInputs.length; i++) {
            const box = otpInputs[startIdx + i];
            box.focus();
            box.value = val[i];
            box.dispatchEvent(new Event("input", { bubbles: true }));
            box.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }, resolvedValue);
      } else if (elInfo.contentEditable) {
        // Trường hợp đặc biệt 2: Khung soạn thảo Rich Text (contenteditable="true")
        try {
          await locator.click({ timeout: 4000 });
        } catch {
          await this.obstructionResolver.ensureUnobstructed(page, frame, locator);
          await locator.click({ force: true, timeout: 3000 }).catch(() => { });
        }
        await this.obstructionResolver.forceFillWithFrameworkEvents(locator, resolvedValue);
      } else if (elInfo.type === "range") {
        // Trường hợp đặc biệt 3: Thanh trượt Slider (input[type="range"])
        const numVal = resolvedValue.replace(/[^0-9.]/g, "");
        await locator.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, numVal);
      } else {
        // Ô input / textarea tiêu chuẩn:
        // Nếu sau 3 nhịp dọn vật cản vẫn bị lỗi CSS cứng đè lên -> dùng Fallback cưỡng bức tương thích React/Vue + gắn Cảnh báo UX
        if (!preHeal.cleared && preHeal.lastInspection?.obstructed) {
          logger.warn(
            `[Self-Healing UX Warning] Ô "${targetLabel}" vẫn bị che bởi ${preHeal.lastInspection.blockerDesc} sau khi tự giải phóng -> Chuyển sang điền dự phòng tương thích Framework.`
          );
          await this.obstructionResolver.forceFillWithFrameworkEvents(locator, resolvedValue);
          uxWarning = `Cảnh báo UX: Ô "${targetLabel}" bị che khuất bởi ${preHeal.lastInspection.blockerDesc}, hệ thống đã kích hoạt chế độ nhập dự phòng`;
        } else {
          try {
            // Thao tác chuẩn như người thật: dùng fill() nguyên bản của Playwright
            await locator.fill(resolvedValue, { timeout: 6000 });
          } catch (fillErr) {
            // Bắt trường hợp vật cản đột ngột nhảy ra đúng lúc đang fill
            logger.warn(`[Self-Healing] Lệnh fill vào "${targetLabel}" bị gián đoạn (${fillErr.message.slice(0, 100)}), đang thử tự chữa lành...`);
            const retryHeal = await this.obstructionResolver.ensureUnobstructed(page, frame, locator);
            if (retryHeal.actionsTaken.length > 0) healNotes.push(...retryHeal.actionsTaken);
            try {
              await locator.fill(resolvedValue, { timeout: 3000 });
            } catch (retryErr) {
              // Tầng 2 (Nhịp 3 - Cứu cánh cuối cùng): Focus & Native Setter + React _valueTracker + Cảnh báo UX
              const blocker = retryHeal.lastInspection?.blockerDesc || "vật cản không xác định";
              logger.warn(`[Self-Healing Fallback] Chuyển sang điền dự phòng cho "${targetLabel}" (${retryErr.message.slice(0, 90)})`);
              await this.obstructionResolver.forceFillWithFrameworkEvents(locator, resolvedValue);
              uxWarning = `Cảnh báo UX: Ô "${targetLabel}" bị che khuất (${blocker}), hệ thống đã kích hoạt chế độ nhập dự phòng`;
            }
          }
        }
      }

      const displayValue = this._formatDisplayValue(rawValue, resolvedValue, session);
      await page.waitForTimeout(200);

      // Hậu kiểm cơ học Tầng 1 cho ô input/textarea tiêu chuẩn (chống lỗi framework xóa/từ chối dữ liệu im lặng)
      let actualReadback = null;
      if (
        !elInfo.contentEditable &&
        elInfo.type !== "range" &&
        !(elInfo.tag === "input" && elInfo.maxLength === 1 && resolvedValue.length > 1) &&
        resolvedValue.length > 0
      ) {
        actualReadback = await locator.evaluate((el) => (typeof el.value === "string" ? el.value : null)).catch(() => null);
        if (actualReadback === "") {
          await this.obstructionResolver.forceFillWithFrameworkEvents(locator, resolvedValue).catch(() => {});
          await page.waitForTimeout(120);
          actualReadback = await locator.evaluate((el) => (typeof el.value === "string" ? el.value : null)).catch(() => null);
          if (actualReadback === "") {
            const readbackWarn = `Hậu kiểm nhập liệu: Ô "${targetLabel}" đang trống sau khi điền (có thể bị giới hạn định dạng/mask hoặc chỉ đọc)`;
            uxWarning = uxWarning ? `${uxWarning}; ${readbackWarn}` : readbackWarn;
          }
        }
      }

      const healSuffix = healNotes.length > 0 ? ` [${healNotes[healNotes.length - 1]}]` : "";
      const warnSuffix = uxWarning ? ` ⚠️ (${uxWarning})` : "";
      return {
        success: true,
        message: `Đã điền "${displayValue}" vào "${targetLabel}"${healSuffix}${warnSuffix}`,
        ...(uxWarning ? { uxWarning } : {}),
        evidence: {
          oracleSource: ORACLE_SOURCES.MECHANICAL_ACTION,
          assertType: "fill",
          scope: targetLabel,
          expected: displayValue,
          actual:
            actualReadback !== null
              ? this._formatDisplayValue(rawValue, actualReadback, session)
              : displayValue,
          passed: true,
        },
        recordedAction: { action: "fill", value: rawValue, fingerprint },
      };
    }

    // 12. SELECT (Chọn giá trị trong <select> có đợi tải Cascading Dropdown HOẶC Custom Div Dropdown)
    if (kind === "select" || kind === "selectoption") {
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => { });
      await this.obstructionResolver.ensureUnobstructed(page, frame, locator);
      const tag = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");

      if (tag === "select") {
        // Cơ chế chờ nạp dữ liệu động cho Cascading Dropdown (ví dụ: Chọn Tỉnh xong phải đợi 0.5s-2s Quận mới tải về)
        const waitStart = Date.now();
        let matchedOption = null;

        while (Date.now() - waitStart < 6500) {
          matchedOption = await locator
            .evaluate((selEl, targetText) => {
              const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
              const targetNorm = norm(targetText);
              const opts = Array.from(selEl.options || []);
              // Ưu tiên khớp chính xác trước, sau đó khớp chứa chuỗi
              const exact = opts.find((o) => norm(o.text) === targetNorm || norm(o.value) === targetNorm);
              if (exact) return { value: exact.value, label: exact.text };
              const partial = opts.find(
                (o) => !o.disabled && o.value !== "" && (norm(o.text).includes(targetNorm) || targetNorm.includes(norm(o.text)))
              );
              if (partial) return { value: partial.value, label: partial.text };
              return null;
            }, resolvedValue)
            .catch(() => null);

          if (matchedOption) break;
          await page.waitForTimeout(300);
        }

        if (!matchedOption) {
          throw new Error(`Không tìm thấy lựa chọn "${resolvedValue}" trong danh sách thả xuống sau 6.5 giây chờ nạp dữ liệu`);
        }

        await locator.selectOption({ value: matchedOption.value }, { timeout: 5000 });
        await page.waitForTimeout(300);
        return {
          success: true,
          message: `Đã chọn "${matchedOption.label}" trong "${fingerprint.cleanLabel || fingerprint.label || fingerprint.placeholder || fingerprint.name || fingerprint.elemId || "danh sách"}"`,
          recordedAction: { action: "select", value: rawValue, fingerprint },
        };
      } else {
        // Custom Div Dropdown (React / Antd / MUI Combobox): tìm đúng targetFrame, chỉ chọn option đang visible, ưu tiên listbox nổi & có polling
        await this._selectCustomDropdown(page, frame || page.mainFrame(), locator, resolvedValue);
        await page.waitForTimeout(300);
        const comboLabel =
          fingerprint.cleanLabel ||
          fingerprint.label ||
          fingerprint.placeholder ||
          fingerprint.name ||
          fingerprint.elemId ||
          "";
        return {
          success: true,
          message: comboLabel
            ? `Đã mở hộp chọn "${comboLabel}" và chọn "${resolvedValue}"`
            : `Đã mở hộp chọn và chọn "${resolvedValue}"`,
          recordedAction: { action: "select", value: rawValue, fingerprint },
        };
      }
    }

    // 13. SET CHECK (Đảm bảo trạng thái Tick / Bỏ tick cho Checkbox / Radio / Switch)
    if (kind === "setcheck" || kind === "check" || kind === "uncheck") {
      const desiredState = kind === "uncheck" ? false : resolvedValue === "false" ? false : true;
      await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => { });
      await this.obstructionResolver.ensureUnobstructed(page, frame, locator);

      const isCurrentlyChecked = await locator
        .evaluate((el) => Boolean(el.checked || el.getAttribute("aria-checked") === "true" || el.classList.contains("checked")))
        .catch(() => false);

      if (isCurrentlyChecked !== desiredState) {
        try {
          if (desiredState) {
            await locator.check({ timeout: 3500 });
          } else {
            await locator.uncheck({ timeout: 3500 });
          }
        } catch {
          // Fallback nếu checkbox bị ẩn dưới thẻ <label> trang trí hoặc DIV giả checkbox
          await locator.click({ force: true, timeout: 4000 });
        }
      }

      await page.waitForTimeout(200);
      const checkLabel =
        fingerprint.cleanLabel ||
        fingerprint.label ||
        fingerprint.placeholder ||
        fingerprint.text ||
        fingerprint.elemId ||
        "ô chọn";
      const postCheckState = await locator
        .evaluate((el) => {
          const isNative =
            el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
          const hasAria = el.hasAttribute("aria-checked");
          if (!isNative && !hasAria) return { verifiable: false, checked: null };
          return {
            verifiable: true,
            checked: isNative ? Boolean(el.checked) : el.getAttribute("aria-checked") === "true",
          };
        })
        .catch(() => ({ verifiable: false, checked: null }));

      if (postCheckState.verifiable && postCheckState.checked !== desiredState) {
        throw this._createVerdictError(
          `Hậu kiểm thất bại: "${checkLabel}" vẫn ở trạng thái ${postCheckState.checked ? "đang chọn" : "chưa chọn"} sau thao tác (kỳ vọng: ${desiredState ? "đã chọn" : "bỏ chọn"})`,
          {
            oracleSource: ORACLE_SOURCES.MECHANICAL_ACTION,
            assertType: "setCheck",
            scope: checkLabel,
            expected: desiredState ? "checked (true)" : "unchecked (false)",
            actual: postCheckState.checked ? "checked (true)" : "unchecked (false)",
            passed: false,
          },
          FAILURE_TYPES.POST_CONDITION_FAILED
        );
      }

      return {
        success: true,
        message: `Đã ${desiredState ? "tick chọn" : "bỏ chọn"} "${checkLabel}"`,
        evidence: {
          oracleSource: ORACLE_SOURCES.MECHANICAL_ACTION,
          assertType: "setCheck",
          scope: checkLabel,
          expected: desiredState ? "checked (true)" : "unchecked (false)",
          actual: desiredState ? "checked (true)" : "unchecked (false)",
          passed: true,
        },
        recordedAction: { action: "setCheck", value: String(desiredState), fingerprint },
      };
    }

    // 14. DRAG AND DROP (Kéo thả Kanban hoặc Slider)
    if (kind === "draganddrop" || kind === "drag") {
      if (!action.destId && !action.destFingerprint) {
        throw new Error("Thiếu phần tử đích (destId / destFingerprint) để thực hiện thao tác kéo thả");
      }
      const destResolved = await this.resolveLocator(
        page,
        { targetId: action.destId, fingerprint: action.destFingerprint },
        elementMap
      );
      await locator.dragTo(destResolved.locator, { timeout: 6000 });
      await page.waitForTimeout(350);
      return {
        success: true,
        message: `Đã kéo thả "${fingerprint.cleanLabel || fingerprint.label || fingerprint.text}" sang "${destResolved.fingerprint.cleanLabel || destResolved.fingerprint.label || destResolved.fingerprint.text}"`,
        recordedAction: {
          action: "dragAndDrop",
          fingerprint,
          destFingerprint: destResolved.fingerprint,
        },
      };
    }

    // 15. CLICK (Mặc định: Bấm chuột vào phần tử — có tự chữa lành vật cản che khuất 3 nhịp + cảnh báo UX)
    await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => { });
    const clickTargetLabel =
      fingerprint.cleanLabel ||
      fingerprint.label ||
      fingerprint.text ||
      fingerprint.alt ||
      fingerprint.placeholder ||
      fingerprint.iconHint ||
      fingerprint.elemId ||
      fingerprint.tag;
    const actionMeta = await this._inspectSubmitContext(locator);
    let clickUxWarning = null;
    const clickHealNotes = [];

    const preClickHeal = await this.obstructionResolver.ensureUnobstructed(page, frame, locator);
    if (preClickHeal.actionsTaken.length > 0) {
      clickHealNotes.push(...preClickHeal.actionsTaken);
    }

    try {
      await locator.click({ timeout: 6000 });
    } catch (clickErr) {
      logger.debug(`Click tiêu chuẩn bị chặn (${clickErr.message.slice(0, 80)}), đang thử tự giải phóng vật cản...`);
      const retryClickHeal = await this.obstructionResolver.ensureUnobstructed(page, frame, locator);
      if (retryClickHeal.actionsTaken.length > 0) {
        clickHealNotes.push(...retryClickHeal.actionsTaken);
      }
      try {
        await locator.click({ timeout: 2500 });
      } catch {
        // Nếu bị lớp phủ cứng không thể dọn (không phải label), ghi Cảnh báo UX rồi cưỡng bức click
        if (retryClickHeal.lastInspection?.obstructed) {
          clickUxWarning = `Cảnh báo UX: Phần tử "${clickTargetLabel}" bị che khuất bởi ${retryClickHeal.lastInspection.blockerDesc}, hệ thống đã kích hoạt click dự phòng`;
          logger.warn(`[Self-Healing UX Warning] ${clickUxWarning}`);
        }
        await locator.click({ force: true, timeout: 4000 });
      }
    }
    await page.waitForTimeout(350);

    const clickHealSuffix = clickHealNotes.length > 0 ? ` [${clickHealNotes[clickHealNotes.length - 1]}]` : "";
    const clickWarnSuffix = clickUxWarning ? ` ⚠️ (${clickUxWarning})` : "";
    return {
      success: true,
      message: `Đã bấm vào "${clickTargetLabel}"${fingerprint.containerAnchor ? ` (dòng "${fingerprint.containerAnchor}")` : ""
        }${clickHealSuffix}${clickWarnSuffix}`,
      actionMeta,
      ...(clickUxWarning ? { uxWarning: clickUxWarning } : {}),
      recordedAction: { action: "click", fingerprint },
    };
  }

  /**
   * Thực thi bước Đọc / Trích xuất dữ liệu (Extract) và lưu vào Kho Biến session.vars
   */
  async executeExtract(action, session, elementMap = null, takeShotFn = null) {
    const page = session.currentPage;
    const rawVarName = String(action.varName || action.variable || "").replace(/[^a-zA-Z0-9_]/g, "");
    const varName = rawVarName || "LAST_EXTRACTED";
    let extractedText = "";
    let savedFp = action.fingerprint || null;

    if (action.targetId !== undefined || action.fingerprint) {
      const { locator, fingerprint } = await this.resolveLocator(page, action, elementMap);
      savedFp = fingerprint;
      await this.highlightLocator(locator, { color: "#0284c7", badge: "ĐỌC DỮ LIỆU" });
      extractedText = await locator
        .evaluate((el) => {
          if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
            return el.value || "";
          }
          return (el.innerText || el.textContent || "").trim();
        })
        .catch(() => "");
    }

    // Nếu có mẫu regex (ví dụ mã đơn DH-2026-XXXX hoặc VIP-8899)
    if (action.pattern) {
      try {
        const regex = new RegExp(action.pattern, "i");
        if (extractedText && regex.test(extractedText)) {
          extractedText = extractedText.match(regex)[0];
        } else {
          const bodyText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
          const m = bodyText.match(regex);
          if (m) extractedText = m[0];
        }
      } catch { }
    }

    // Nếu trích xuất trực tiếp từ giá trị AI đã đọc trên màn hình
    if (!extractedText && action.value) {
      extractedText = String(action.value).trim();
    }

    if (!extractedText) {
      throw new Error("Không đọc được dữ liệu từ phần tử mục tiêu trên màn hình");
    }

    // Lưu vào cả biến có tên riêng lẫn biến mặc định LAST_EXTRACTED
    session.vars[varName] = extractedText;
    session.vars.LAST_EXTRACTED = extractedText;
    logger.info(`[Extract] Đã lưu vào Kho Biến: {{${varName}}} = "${extractedText}"`);

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Dữ liệu trích xuất",
        sublabel: `${varName}: "${extractedText}"`,
      });
    }
    await this.clearHighlights(page);

    return {
      success: true,
      extractedValue: extractedText,
      message: `Đã đọc và lưu dữ liệu "${extractedText}" vào biến {{${varName}}}`,
      recordedAction: {
        action: "extract",
        varName,
        pattern: action.pattern || undefined,
        fingerprint: savedFp,
      },
    };
  }

  /**
   * Chọn mục trong Custom Div Dropdown trên đúng targetFrame (hỗ trợ cả iframe & async loading)
   * - Ưu tiên listbox theo aria-controls/aria-owns -> [role="option"]/floating dropdown -> loại trừ sidebar menu
   */
  async _selectCustomDropdown(page, targetFrame, triggerLocator, resolvedValue) {
    const ariaControls = await triggerLocator
      .evaluate((el) => el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "")
      .catch(() => "");

    await triggerLocator.click({ timeout: 5000 });

    const normTarget = String(resolvedValue || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    const waitStart = Date.now();
    const maxWaitMs = 5500;

    while (Date.now() - waitStart < maxWaitMs) {
      const markedOk = await targetFrame
        .evaluate(
          ({ targetNorm, controlledIdsRaw }) => {
            document.querySelectorAll("[data-at-dropdown-choice]").forEach((n) => {
              n.removeAttribute("data-at-dropdown-choice");
            });

            const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
            const getParentOrHost = (node) =>
              node?.parentElement || node?.getRootNode?.()?.host || null;

            const isOptionVisible = (el) => {
              if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return false;
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
              return rect.width > 2 && rect.height > 2;
            };

            const isInsideSidebarOrNav = (el) => {
              if (
                el.closest(
                  '[role="listbox"], [role="menu"], .ant-select-dropdown, .MuiPopover-root, .MuiAutocomplete-popper'
                )
              ) {
                return false;
              }
              return Boolean(
                el.closest(
                  'nav, aside:not([role="dialog"]), [role="navigation"], [class*="sidebar"], [class*="side-nav"], [class*="left-menu"]'
                )
              );
            };

            const tierQueries = [];
            const controlledIds = String(controlledIdsRaw || "")
              .trim()
              .split(/\s+/)
              .filter(Boolean);
            for (const cid of controlledIds) {
              try {
                const escaped = CSS.escape(cid);
                tierQueries.push(
                  `#${escaped} [role="option"], #${escaped} li, #${escaped} [class*="option"], #${escaped} [class*="item"]`
                );
              } catch { }
            }

            // Tier 1: ARIA option / popup listbox nổi chuẩn của thư viện UI hiện đại
            tierQueries.push(
              [
                '[role="listbox"] [role="option"]',
                '[role="menu"] [role="menuitem"]',
                ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
                ".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item",
                ".MuiPopover-root [role='option']",
                ".MuiAutocomplete-popper [role='option']",
                '[class*="select__menu"] [class*="option"]',
                ".dropdown-menu.show .dropdown-item",
                '[data-state="open"] [role="option"]',
                '[role="option"]',
              ].join(", ")
            );

            // Tier 2: Custom div dropdown ngoài sidebar
            tierQueries.push(
              [
                '[class*="dropdown"] [class*="option"]',
                '[class*="dropdown"] [class*="item"]',
                '[class*="dropdown"] li',
                '[class*="listbox"] li',
                '[class*="select-menu"] li',
                '[class*="options"] [class*="item"]',
              ].join(", ")
            );

            // Tier 3: Fallback cuối cùng trên option/li ngoài thanh điều hướng
            tierQueries.push('[class*="option"], [class*="dropdown-item"], li');

            let bestEl = null;
            let bestScore = Infinity;

            for (let tierIdx = 0; tierIdx < tierQueries.length; tierIdx++) {
              let nodes = [];
              try {
                nodes = Array.from(document.querySelectorAll(tierQueries[tierIdx]));
              } catch {
                nodes = [];
              }

              for (const el of nodes) {
                if (!isOptionVisible(el)) continue;
                if (el.getAttribute("aria-disabled") === "true" || el.disabled) continue;
                if (isInsideSidebarOrNav(el)) continue;

                const txt = norm(el.innerText || el.textContent);
                if (!txt || txt.length > 200) continue;

                let matchScore = Infinity;
                if (txt === targetNorm) {
                  matchScore = tierIdx * 100 + 1;
                } else if (txt.includes(targetNorm)) {
                  matchScore = tierIdx * 100 + 10 + Math.min(txt.length, 80) * 0.01;
                } else if (targetNorm.includes(txt) && txt.length >= 2) {
                  matchScore = tierIdx * 100 + 50;
                }

                if (matchScore < bestScore) {
                  bestScore = matchScore;
                  bestEl = el;
                }
              }

              if (bestEl) break;
            }

            if (bestEl) {
              bestEl.setAttribute("data-at-dropdown-choice", "true");
              return true;
            }
            return false;
          },
          { targetNorm: normTarget, controlledIdsRaw: ariaControls }
        )
        .catch(() => false);

      if (markedOk) {
        const chosenLoc = targetFrame.locator('[data-at-dropdown-choice="true"]').first();
        if ((await chosenLoc.count().catch(() => 0)) > 0) {
          await chosenLoc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
          await chosenLoc.click({ timeout: 5000 });
          await targetFrame
            .evaluate(() => {
              document.querySelectorAll("[data-at-dropdown-choice]").forEach((n) => {
                n.removeAttribute("data-at-dropdown-choice");
              });
            })
            .catch(() => { });
          return;
        }
      }

      await page.waitForTimeout(220);
    }

    throw new Error(
      `Không tìm thấy lựa chọn "${resolvedValue}" đang hiển thị trong danh sách thả xuống sau 5.5 giây chờ nạp dữ liệu`
    );
  }

  /**
   * Tìm kiếm chuỗi văn bản THỰC SỰ ĐANG HIỂN THỊ trên toàn bộ Frames + Shadow DOM (tuyệt đối không khớp thẻ ẩn / script / style)
   */
  async _findVisibleTextMatchInPage(page, expectedNorm) {
    for (const frame of page.frames()) {
      if (frame.isDetached?.()) continue;
      try {
        const foundInFrame = await frame.evaluate((expNorm) => {
          const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (!expNorm) return null;

          // Xóa dấu đánh dấu assert cũ trên cả Light DOM lẫn Shadow DOM
          const clearOldMarks = (root) => {
            if (!root) return;
            const children = root.children || [];
            for (let i = 0; i < children.length; i++) {
              const c = children[i];
              if (c.hasAttribute?.("data-autotest-assert-match")) {
                c.removeAttribute("data-autotest-assert-match");
              }
              if (c.shadowRoot) clearOldMarks(c.shadowRoot);
              clearOldMarks(c);
            }
          };
          clearOldMarks(document.body || document.documentElement);

          const getParentOrHost = (node) =>
            node?.parentElement || node?.getRootNode?.()?.host || null;

          const isElementOwnStyleVisible = (el) => {
            if (!el || el.nodeType !== 1) return false;
            const tag = el.tagName;
            if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
              return false;
            }
            if (el.hidden === true || el.getAttribute?.("aria-hidden") === "true") {
              return false;
            }
            const st = window.getComputedStyle(el);
            if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
              return false;
            }
            if (parseFloat(st.opacity) === 0) return false;
            if (st.display !== "contents" && el.getBoundingClientRect) {
              const rect = el.getBoundingClientRect();
              if (rect.width <= 0.5 || rect.height <= 0.5) return false;
            }
            return true;
          };

          const isNodeFullyVisible = (el) => {
            let cur = el;
            let depth = 0;
            while (cur && depth < 35) {
              if (cur.nodeType === 1 && !isElementOwnStyleVisible(cur)) {
                return false;
              }
              cur = getParentOrHost(cur);
              depth++;
            }
            return true;
          };

          // Chỉ trích xuất chữ từ các Text Node con thực sự đang visible (loại bỏ hoàn toàn chữ trong span/div display:none lồng bên trong)
          const extractVisibleTextOnly = (node) => {
            if (!node) return "";
            if (node.nodeType === 3) {
              return node.nodeValue || "";
            }
            if (node.nodeType !== 1) return "";
            if (!isElementOwnStyleVisible(node)) return "";

            let acc = "";
            if (node.shadowRoot) {
              for (let i = 0; i < node.shadowRoot.childNodes.length; i++) {
                const sub = extractVisibleTextOnly(node.shadowRoot.childNodes[i]);
                if (sub) acc += " " + sub;
              }
            }
            for (let i = 0; i < node.childNodes.length; i++) {
              const sub = extractVisibleTextOnly(node.childNodes[i]);
              if (sub) acc += " " + sub;
            }
            return acc;
          };

          const collectAllDom = (root, out = []) => {
            if (!root) return out;
            const children = root.children || [];
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              out.push(child);
              if (child.shadowRoot) collectAllDom(child.shadowRoot, out);
              collectAllDom(child, out);
            }
            return out;
          };

          const rootEl = document.body || document.documentElement;
          const allDom = collectAllDom(rootEl, []);

          // Kiểm tra ô input / select / textarea đang hiển thị trước (loại trừ hidden & password)
          for (const el of allDom) {
            const tag = el.tagName;
            if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") continue;
            if (tag === "INPUT" && (el.type === "hidden" || el.type === "password")) continue;
            if (!isNodeFullyVisible(el)) continue;

            const rawVal =
              tag === "SELECT"
                ? el.options?.[el.selectedIndex]?.text || el.value || ""
                : el.value || "";
            const valNorm = norm(rawVal);
            if (valNorm && valNorm.includes(expNorm)) {
              el.setAttribute("data-autotest-assert-match", "true");
              return `Ô dữ liệu hiển thị: "${String(rawVal).trim().slice(0, 100)}"`;
            }
          }

          // Kiểm tra cụm từ trên các phần tử nội dung đang hiển thị (tính điểm ưu tiên Exact > WordBoundary > Smallest Substring)
          const escapedRegexText = expNorm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let boundaryRegex = null;
          try {
            boundaryRegex = new RegExp(`(?<![\\p{L}\\p{N}])${escapedRegexText}(?![\\p{L}\\p{N}])`, "u");
          } catch {
            boundaryRegex = null;
          }

          let bestEl = null;
          let bestTier = Infinity;
          let bestLen = Infinity;
          let bestText = "";

          const textContainerTags = new Set([
            "DIV", "SPAN", "P", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6",
            "LI", "BUTTON", "A", "LABEL", "STRONG", "B", "EM", "SMALL", "CODE",
            "PRE", "BLOCKQUOTE", "DD", "DT", "FIGCAPTION", "SUMMARY", "ARTICLE", "SECTION",
          ]);

          for (const el of allDom) {
            if (!textContainerTags.has(el.tagName)) continue;
            if (!isNodeFullyVisible(el)) continue;

            const rawVis = extractVisibleTextOnly(el);
            const visNorm = norm(rawVis);
            if (!visNorm || !visNorm.includes(expNorm)) continue;

            let tier = 3;
            if (visNorm === expNorm) tier = 1;
            else if (boundaryRegex && boundaryRegex.test(visNorm)) tier = 2;

            if (tier < bestTier || (tier === bestTier && visNorm.length < bestLen)) {
              bestTier = tier;
              bestLen = visNorm.length;
              bestEl = el;
              bestText = String(rawVis).replace(/\s+/g, " ").trim().slice(0, 120);
            }
          }

          if (bestEl) {
            bestEl.setAttribute("data-autotest-assert-match", "true");
            return bestText;
          }
          return null;
        }, expectedNorm);

        if (foundInFrame) {
          return { frame, matchedDescription: foundInFrame };
        }
      } catch { }
    }
    return null;
  }

  /**
   * Đọc văn bản hiển thị trong đúng 1 phần tử / khung neo (Scoped Assert — chống khớp nhầm toàn trang)
   */
  async _matchTextInsideLocator(locator, expectedNorm) {
    try {
      const count = await locator.count().catch(() => 0);
      if (count === 0) return { found: false, actualText: "(Không tìm thấy khung/phần tử mục tiêu)" };
      const res = await locator.first().evaluate((el, expNorm) => {
        const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const st = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const vis =
          !el.hidden &&
          el.getAttribute?.("aria-hidden") !== "true" &&
          st.display !== "none" &&
          st.visibility !== "hidden" &&
          st.visibility !== "collapse" &&
          parseFloat(st.opacity) !== 0 &&
          rect.width > 0.5 &&
          rect.height > 0.5;
        if (!vis) return { found: false, actualText: "(Phần tử mục tiêu đang ẩn)" };
        const raw =
          el.tagName === "INPUT" || el.tagName === "TEXTAREA"
            ? el.value || ""
            : el.tagName === "SELECT"
              ? el.options?.[el.selectedIndex]?.text || el.value || ""
              : el.innerText || el.textContent || "";
        const cleaned = String(raw).replace(/\s+/g, " ").trim();
        const actualNorm = norm(cleaned);
        return {
          found: Boolean(actualNorm && actualNorm.includes(expNorm)),
          actualText: cleaned.slice(0, 140) || "(Trống)",
        };
      }, expectedNorm);
      return res;
    } catch {
      return { found: false, actualText: "(Không đọc được nội dung khung mục tiêu)" };
    }
  }

  /**
   * Giải quyết phạm vi kiểm chứng cục bộ (targetId / fingerprint / containerAnchor) cho Scoped Assertion
   */
  async _resolveAssertScope(activePage, action, elementMap) {
    const resolvedAnchor = action.containerAnchor
      ? this.resolveVars(String(action.containerAnchor), {}).trim()
      : "";
    if (action.targetId !== undefined || action.fingerprint) {
      const resolved = await this.resolveLocator(activePage, action, elementMap);
      const label =
        resolved.fingerprint?.label ||
        resolved.fingerprint?.text ||
        resolved.fingerprint?.elemId ||
        resolved.fingerprint?.containerAnchor ||
        resolved.fingerprint?.tag ||
        "phần tử mục tiêu";
      return {
        scoped: true,
        locator: resolved.locator,
        frame: resolved.frame,
        fingerprint: resolved.fingerprint,
        scopeLabel: resolved.fingerprint?.containerAnchor
          ? `${label} (dòng "${resolved.fingerprint.containerAnchor}")`
          : label,
      };
    }
    if (resolvedAnchor) {
      for (const fr of activePage.frames()) {
        if (fr.isDetached?.()) continue;
        const containerLoc = await this._resolveContainerScope(fr, resolvedAnchor);
        if (containerLoc) {
          return {
            scoped: true,
            locator: containerLoc,
            frame: fr,
            fingerprint: null,
            scopeLabel: `khung "${resolvedAnchor}"`,
          };
        }
      }
      return {
        scoped: true,
        locator: null,
        frame: null,
        fingerprint: null,
        scopeLabel: `khung "${resolvedAnchor}"`,
      };
    }
    return { scoped: false, locator: null, frame: null, fingerprint: null, scopeLabel: null };
  }

  /**
   * Thực thi bước Kiểm tra / Nghiệm thu với Cơ chế Canh chừng liên tục (Web-First Polling Assertion)
   * Hỗ trợ cả kiểm tra có ngữ cảnh (targetId / fingerprint / containerAnchor), kiểm tra toàn trang,
   * kiểm tra ẩn/biến mất ("hidden" / "notExists") và trả về bằng chứng chuẩn Expected vs Actual.
   */
  async executePollingAssert(action, session, elementMap = null, takeShotFn = null) {
    const page = session.currentPage;
    const expectedRaw = action.expectedText || action.value || "";
    const expectedText = this.resolveVars(expectedRaw, session.vars).trim();
    const resolvedContainerAnchor = action.containerAnchor
      ? this.resolveVars(String(action.containerAnchor), session.vars).trim()
      : "";
    const isNegative =
      action.assertType === "hidden" ||
      action.assertType === "notExists" ||
      action.negate === true;
    const observeDefaultMs = Number(this.config?.timeouts?.observeTimeoutMs) || 15000;
    const timeoutMs =
      Number(action.timeoutMs) ||
      (isNegative ? Math.min(observeDefaultMs, 10000) : observeDefaultMs);
    const startTime = Date.now();

    const normalize = (str) =>
      String(str || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const expectedNorm = normalize(expectedText);

    // 1. Kiểm tra tệp tải về nếu bước yêu cầu kiểm tra download file (chuyển về executeAssertDownload)
    const getActivePage = () =>
      session.currentPage && !session.currentPage.isClosed?.() ? session.currentPage : page;
    const initialScopedDownloads = this._getScopedTelemetry(session, "downloads");
    if (!isNegative && (action.assertType === "fileDownloaded" || (!expectedText && initialScopedDownloads.length > 0))) {
      return await this.executeAssertDownload(action, session, takeShotFn);
    }

    if (!expectedNorm) {
      throw this._createVerdictError(
        "Thiếu nội dung kỳ vọng cần kiểm tra (assert value trống)",
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: isNegative ? "hidden" : "visible",
          expected: "(Không xác định)",
          actual: "(Thiếu chuỗi kỳ vọng)",
          passed: false,
        },
        FAILURE_TYPES.EXECUTION_ERROR
      );
    }

    const hasExplicitScope = Boolean(
      action.targetId !== undefined || action.fingerprint || resolvedContainerAnchor
    );
    const scopedAction = resolvedContainerAnchor
      ? { ...action, containerAnchor: resolvedContainerAnchor }
      : action;

    // 2. Chế độ NEGATIVE ASSERTION (Kiểm tra không xuất hiện / biến mất / bị xóa khỏi giao diện hiển thị)
    if (isNegative) {
      let lastStillVisibleMatch = null;
      let lastScopeLabel = resolvedContainerAnchor ? `khung "${resolvedContainerAnchor}"` : "Toàn trang";
      let savedFingerprint = action.fingerprint || null;
      let disappearedConfirmed = false;

      while (Date.now() - startTime < timeoutMs) {
        const activePage = getActivePage();
        if (hasExplicitScope) {
          const scope = await this._resolveAssertScope(activePage, scopedAction, elementMap).catch(() => ({
            scoped: true,
            locator: null,
            scopeLabel: lastScopeLabel,
          }));
          if (scope.scopeLabel) lastScopeLabel = scope.scopeLabel;
          if (scope.fingerprint && !savedFingerprint) savedFingerprint = scope.fingerprint;

          if (!scope.locator) {
            disappearedConfirmed = true;
            break;
          }
          const scopedRes = await this._matchTextInsideLocator(scope.locator, expectedNorm);
          if (!scopedRes.found) {
            await activePage.waitForTimeout(150);
            const recheck = await this._matchTextInsideLocator(scope.locator, expectedNorm);
            if (!recheck.found) {
              disappearedConfirmed = true;
              break;
            }
            lastStillVisibleMatch = { locator: scope.locator, matchedDescription: recheck.actualText };
          } else {
            lastStillVisibleMatch = { locator: scope.locator, matchedDescription: scopedRes.actualText };
          }
        } else {
          lastStillVisibleMatch = await this._findVisibleTextMatchInPage(activePage, expectedNorm);
          if (!lastStillVisibleMatch) {
            await activePage.waitForTimeout(150);
            const recheck = await this._findVisibleTextMatchInPage(getActivePage(), expectedNorm);
            if (!recheck) {
              disappearedConfirmed = true;
              break;
            }
            lastStillVisibleMatch = recheck;
          }
        }
        await activePage.waitForTimeout(250);
      }

      const activeNegPage = getActivePage();
      if (!disappearedConfirmed) {
        if (lastStillVisibleMatch?.locator) {
          await this.highlightLocator(lastStillVisibleMatch.locator, { color: "#dc2626", badge: "VẪN CÒN HIỂN THỊ" });
        } else if (lastStillVisibleMatch?.frame) {
          const matchLoc = lastStillVisibleMatch.frame.locator('[data-autotest-assert-match="true"]').first();
          if ((await matchLoc.count().catch(() => 0)) > 0) {
            await this.highlightLocator(matchLoc, { color: "#dc2626", badge: "VẪN CÒN HIỂN THỊ" });
          }
        }
        const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        throw this._createVerdictError(
          `Nội dung "${expectedText}" vẫn đang hiển thị${hasExplicitScope ? ` trong ${lastScopeLabel}` : " trên màn hình"} sau ${elapsedSec} giây (kỳ vọng phải biến mất/không xuất hiện)`,
          {
            oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
            assertType: "hidden",
            scope: lastScopeLabel,
            expected: `Không còn hiển thị "${expectedText}"`,
            actual: `Vẫn đang hiển thị: "${lastStillVisibleMatch?.matchedDescription || expectedText}"`,
            passed: false,
          },
          FAILURE_TYPES.ASSERTION_FAILED
        );
      }

      if (takeShotFn) {
        await takeShotFn("view", {
          label: "Xác nhận không còn hiển thị",
          sublabel: `Đã biến mất: "${expectedText}"`.slice(0, 80),
        });
      }
      await this.clearHighlights(activeNegPage);

      return {
        success: true,
        message: `Xác nhận thành công: "${expectedText}" không còn xuất hiện${hasExplicitScope ? ` trong ${lastScopeLabel}` : " trên giao diện hiển thị"}`,
        evidence: {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "hidden",
          scope: lastScopeLabel,
          expected: `Không còn hiển thị "${expectedText}"`,
          actual: "Đã ẩn / không còn tồn tại trên giao diện",
          passed: true,
        },
        recordedAction: {
          action: "assertHidden",
          assertType: "hidden",
          value: expectedRaw,
          ...(savedFingerprint ? { fingerprint: savedFingerprint } : {}),
          ...(action.containerAnchor ? { containerAnchor: action.containerAnchor } : {}),
        },
      };
    }

    // 3. Chế độ POSITIVE ASSERTION (Ưu tiên kiểm tra theo Scope nếu có targetId/containerAnchor)
    let matchedDescription = null;
    let lastActualObserved = null;
    let lastScopeLabel = resolvedContainerAnchor ? `khung "${resolvedContainerAnchor}"` : "Toàn trang";
    let savedFingerprint = action.fingerprint || null;

    while (Date.now() - startTime < timeoutMs) {
      const activePage = getActivePage();

      if (hasExplicitScope) {
        const scope = await this._resolveAssertScope(activePage, scopedAction, elementMap).catch(() => ({
          scoped: true,
          locator: null,
          scopeLabel: lastScopeLabel,
        }));
        if (scope.scopeLabel) lastScopeLabel = scope.scopeLabel;
        if (scope.fingerprint && !savedFingerprint) savedFingerprint = scope.fingerprint;

        if (scope.locator) {
          const scopedRes = await this._matchTextInsideLocator(scope.locator, expectedNorm);
          lastActualObserved = scopedRes.actualText;
          if (scopedRes.found) {
            matchedDescription = scopedRes.actualText;
            await this.highlightLocator(scope.locator, { color: "#16a34a", badge: "XÁC NHẬN ĐẠT" });
            break;
          }
        } else {
          lastActualObserved = `Không tìm thấy ${lastScopeLabel}`;
        }
      } else {
        const scopedDialogs = this._getScopedTelemetry(session, "dialogs");
        if (scopedDialogs.length > 0) {
          const foundDialog = scopedDialogs.find((d) => normalize(d.message).includes(expectedNorm));
          if (foundDialog) {
            matchedDescription = `Hộp thoại [${foundDialog.type.toUpperCase()}]: "${foundDialog.message}"`;
            lastScopeLabel = "Native Dialog";
            break;
          }
        }

        const frameMatch = await this._findVisibleTextMatchInPage(activePage, expectedNorm);
        if (frameMatch) {
          matchedDescription = frameMatch.matchedDescription;
          const matchLoc = frameMatch.frame.locator('[data-autotest-assert-match="true"]').first();
          if ((await matchLoc.count().catch(() => 0)) > 0) {
            await this.highlightLocator(matchLoc, { color: "#16a34a", badge: "XÁC NHẬN ĐẠT" });
          }
          break;
        }
      }

      await activePage.waitForTimeout(300);
    }

    if (!matchedDescription) {
      const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      const actualSummary = hasExplicitScope
        ? `${lastScopeLabel} hiển thị: "${lastActualObserved || "(Trống)"}"`
        : `Không tìm thấy chữ "${expectedText}" đang hiển thị trên màn hình sau ${elapsedSec}s`;
      throw this._createVerdictError(
        hasExplicitScope
          ? `Không tìm thấy nội dung kỳ vọng "${expectedText}" bên trong ${lastScopeLabel} sau ${elapsedSec} giây (thực tế: "${lastActualObserved || "(Trống)"}")`
          : `Không tìm thấy nội dung kỳ vọng đang hiển thị "${expectedText}" trên màn hình sau ${elapsedSec} giây chờ đợi`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "visible",
          scope: lastScopeLabel,
          expected: `Hiển thị "${expectedText}"`,
          actual: actualSummary,
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận đạt yêu cầu",
        sublabel: matchedDescription.slice(0, 80),
      });
    }
    await this.clearHighlights(getActivePage());

    return {
      success: true,
      message: `Xác nhận thành công: tìm thấy "${matchedDescription}"${hasExplicitScope ? ` trong ${lastScopeLabel}` : ""}`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "visible",
        scope: lastScopeLabel,
        expected: `Hiển thị "${expectedText}"`,
        actual: matchedDescription,
        passed: true,
      },
      recordedAction: {
        action: "assert",
        assertType: "visible",
        value: expectedRaw,
        ...(savedFingerprint ? { fingerprint: savedFingerprint } : {}),
        ...(action.containerAnchor ? { containerAnchor: action.containerAnchor } : {}),
      },
    };
  }

  /**
   * Nguyên thủy #3: ASSERT URL — Kiểm tra đường dẫn/URL trang hiện tại (Web-First Polling)
   */
  async executeAssertUrl(action, session, takeShotFn = null) {
    const expectedRaw = action.value || action.expected || action.url || "";
    const expected = this.resolveVars(String(expectedRaw), session.vars).trim();
    const negate = action.negate === true;
    const timeoutMs = Number(action.timeoutMs) || Math.min(Number(this.config?.timeouts?.observeTimeoutMs) || 15000, 12000);
    const startTime = Date.now();

    if (!expected) {
      throw this._createVerdictError("Thiếu đường dẫn/URL kỳ vọng cho lệnh assertUrl", null, FAILURE_TYPES.EXECUTION_ERROR);
    }

    let regex = null;
    if (action.matchType === "regex" || (expected.startsWith("/") && expected.endsWith("/") && expected.length > 2)) {
      try {
        const body = expected.startsWith("/") && expected.endsWith("/") ? expected.slice(1, -1) : expected;
        regex = new RegExp(body, "i");
      } catch {
        regex = null;
      }
    }

    const matchesUrl = (curUrl) => {
      const str = String(curUrl || "");
      const matched = regex ? regex.test(str) : str.toLowerCase().includes(expected.toLowerCase());
      return negate ? !matched : matched;
    };

    let currentUrl = "";
    let ok = false;
    while (Date.now() - startTime < timeoutMs) {
      const activePage = session.currentPage;
      currentUrl = activePage && !activePage.isClosed?.() ? activePage.url?.() || "" : "";
      if (matchesUrl(currentUrl)) {
        ok = true;
        break;
      }
      await activePage?.waitForTimeout?.(250).catch(() => {});
    }

    const expectedDesc = negate ? `URL KHÔNG chứa "${expected}"` : `URL khớp/chứa "${expected}"`;
    if (!ok) {
      const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      throw this._createVerdictError(
        `URL hiện tại không đạt kỳ vọng sau ${elapsedSec} giây — Kỳ vọng: ${expectedDesc}, Thực tế: "${currentUrl}"`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "url",
          scope: "URL trình duyệt",
          expected: expectedDesc,
          actual: currentUrl || "(Trống)",
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận URL đạt yêu cầu",
        sublabel: currentUrl.slice(0, 80),
      });
    }

    return {
      success: true,
      message: `Xác nhận URL thành công: "${currentUrl}"`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "url",
        scope: "URL trình duyệt",
        expected: expectedDesc,
        actual: currentUrl,
        passed: true,
      },
      recordedAction: {
        action: negate ? "assertUrlNot" : "assertUrl",
        value: expectedRaw,
        ...(action.matchType ? { matchType: action.matchType } : {}),
      },
    };
  }

  /**
   * Nguyên thủy #4: ASSERT STATE — Kiểm tra trạng thái phần tử (visible|hidden|enabled|disabled|checked|unchecked)
   */
  async executeAssertState(action, session, elementMap = null, takeShotFn = null) {
    const rawState = String(action.state || action.value || "visible").trim().toLowerCase();
    const validStates = new Set(["visible", "hidden", "enabled", "disabled", "checked", "unchecked"]);
    const expectedState = validStates.has(rawState) ? rawState : "visible";
    const timeoutMs = Number(action.timeoutMs) || Math.min(Number(this.config?.timeouts?.observeTimeoutMs) || 15000, 12000);
    const startTime = Date.now();

    const { locator, fingerprint } = await this.resolveLocator(session.currentPage, action, elementMap);
    const targetLabel =
      fingerprint.label || fingerprint.text || fingerprint.placeholder || fingerprint.elemId || fingerprint.tag || "phần tử";

    let actualState = "unknown";
    let matched = false;

    while (Date.now() - startTime < timeoutMs) {
      const info = await locator
        .first()
        .evaluate((el) => {
          const st = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const visible =
            !el.hidden &&
            el.getAttribute?.("aria-hidden") !== "true" &&
            st.display !== "none" &&
            st.visibility !== "hidden" &&
            st.visibility !== "collapse" &&
            parseFloat(st.opacity) !== 0 &&
            rect.width > 0.5 &&
            rect.height > 0.5;
          const disabled = Boolean(el.disabled || el.getAttribute?.("aria-disabled") === "true");
          const checked = Boolean(
            el.checked || el.getAttribute?.("aria-checked") === "true" || el.classList?.contains("checked")
          );
          return { visible, disabled, checked };
        })
        .catch(() => ({ visible: false, disabled: false, checked: false, missing: true }));

      if (expectedState === "visible") {
        actualState = info.visible ? "visible" : "hidden";
        matched = info.visible;
      } else if (expectedState === "hidden") {
        actualState = info.visible ? "visible" : "hidden";
        matched = !info.visible;
      } else if (expectedState === "disabled") {
        actualState = info.disabled ? "disabled" : "enabled";
        matched = info.disabled;
      } else if (expectedState === "enabled") {
        actualState = info.disabled ? "disabled" : "enabled";
        matched = !info.disabled && !info.missing;
      } else if (expectedState === "checked") {
        actualState = info.checked ? "checked" : "unchecked";
        matched = info.checked;
      } else if (expectedState === "unchecked") {
        actualState = info.checked ? "checked" : "unchecked";
        matched = !info.checked && !info.missing;
      }

      if (matched) break;
      await session.currentPage?.waitForTimeout?.(250).catch(() => {});
    }

    if (!matched) {
      await this.highlightLocator(locator, { color: "#dc2626", badge: `TRẠNG THÁI: ${actualState.toUpperCase()}` });
      throw this._createVerdictError(
        `Trạng thái phần tử "${targetLabel}" không đạt kỳ vọng — Kỳ vọng: "${expectedState}", Thực tế: "${actualState}"`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "state",
          scope: targetLabel,
          expected: expectedState,
          actual: actualState,
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (expectedState !== "hidden") {
      await this.highlightLocator(locator, { color: "#16a34a", badge: `ĐẠT: ${expectedState.toUpperCase()}` });
    }
    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận trạng thái phần tử",
        sublabel: `"${targetLabel}": ${actualState}`.slice(0, 80),
      });
    }
    await this.clearHighlights(session.currentPage);

    return {
      success: true,
      message: `Xác nhận trạng thái thành công: "${targetLabel}" đang ở trạng thái "${actualState}"`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "state",
        scope: targetLabel,
        expected: expectedState,
        actual: actualState,
        passed: true,
      },
      recordedAction: { action: "assertState", state: expectedState, value: expectedState, fingerprint },
    };
  }

  /**
   * Nguyên thủy #5: ASSERT VALUE — Kiểm tra giá trị thực bên trong ô input/select/textarea (hỗ trợ Shadow DOM & nonEmpty)
   */
  async executeAssertValue(action, session, elementMap = null, takeShotFn = null) {
    const rawExpected = action.value !== undefined && action.value !== null ? String(action.value) : "";
    const resolvedExpected = this.resolveVars(rawExpected, session.vars).trim();
    const checkNonEmpty =
      action.nonEmpty === true ||
      /^(__NON_EMPTY__|non_?empty|not_?empty|khác rỗng|có giá trị)$/i.test(resolvedExpected);
    const checkEmpty = action.empty === true || /^(__EMPTY__|empty|rỗng|trống)$/i.test(resolvedExpected);
    const pattern = action.pattern ? new RegExp(action.pattern, "i") : null;
    const timeoutMs = Number(action.timeoutMs) || Math.min(Number(this.config?.timeouts?.observeTimeoutMs) || 15000, 12000);
    const startTime = Date.now();

    const { locator, fingerprint } = await this.resolveLocator(session.currentPage, action, elementMap);
    const targetLabel =
      fingerprint.label || fingerprint.placeholder || fingerprint.name || fingerprint.elemId || fingerprint.tag || "ô dữ liệu";

    let actualVal = "";
    let matched = false;

    while (Date.now() - startTime < timeoutMs) {
      actualVal = await locator
        .first()
        .evaluate((el) => {
          if (el.tagName === "SELECT") {
            const opt = el.options?.[el.selectedIndex];
            return String(opt?.text || el.value || "").trim();
          }
          if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
            return String(el.value ?? "").trim();
          }
          return String(el.innerText || el.textContent || "").trim();
        })
        .catch(() => "");

      if (checkNonEmpty) {
        matched = actualVal.length > 0;
      } else if (checkEmpty) {
        matched = actualVal.length === 0;
      } else if (pattern) {
        matched = pattern.test(actualVal);
      } else {
        matched = actualVal.toLowerCase().includes(resolvedExpected.toLowerCase());
      }

      if (matched) break;
      await session.currentPage?.waitForTimeout?.(250).catch(() => {});
    }

    const expectedDesc = checkNonEmpty
      ? "Có giá trị (khác rỗng)"
      : checkEmpty
        ? "Rỗng (đã xóa trắng)"
        : pattern
          ? `Khớp mẫu /${action.pattern}/`
          : `"${resolvedExpected}"`;

    if (!matched) {
      await this.highlightLocator(locator, { color: "#dc2626", badge: "GIÁ TRỊ KHÔNG KHỚP" });
      throw this._createVerdictError(
        `Giá trị trong "${targetLabel}" không đạt kỳ vọng — Kỳ vọng: ${expectedDesc}, Thực tế: "${actualVal || "(Trống)"}"`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "value",
          scope: targetLabel,
          expected: expectedDesc,
          actual: actualVal || "(Trống)",
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    await this.highlightLocator(locator, { color: "#16a34a", badge: "GIÁ TRỊ ĐẠT" });
    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận giá trị ô nhập",
        sublabel: `"${targetLabel}" = "${actualVal || "(Trống)"}"`.slice(0, 80),
      });
    }
    await this.clearHighlights(session.currentPage);

    return {
      success: true,
      message: `Xác nhận giá trị thành công: "${targetLabel}" đang có giá trị "${actualVal || "(Trống)"}"`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "value",
        scope: targetLabel,
        expected: expectedDesc,
        actual: actualVal || "(Trống)",
        passed: true,
      },
      recordedAction: {
        action: "assertValue",
        value: rawExpected,
        ...(checkNonEmpty ? { nonEmpty: true } : {}),
        ...(checkEmpty ? { empty: true } : {}),
        ...(action.pattern ? { pattern: action.pattern } : {}),
        fingerprint,
      },
    };
  }

  /**
   * Nguyên thủy #6: ASSERT COUNT — Đếm số lượng dòng bảng / thẻ chip / phần tử đang hiển thị (==, >=, >, <=, <)
   */
  async executeAssertCount(action, session, elementMap = null, takeShotFn = null) {
    const rawExpr = String(action.count ?? action.value ?? ">=1").trim();
    const exprMatch = rawExpr.match(/^(>=|<=|==|=|>|<)?\s*(\d+)$/);
    const op = (action.op || exprMatch?.[1] || "==").replace(/^=$/, "==");
    const expectedNum = Number(action.count ?? exprMatch?.[2] ?? 1);
    const selector = String(action.selector || "").trim();
    const filterText = action.text ? this.resolveVars(String(action.text), session.vars).trim().toLowerCase() : "";
    const timeoutMs = Number(action.timeoutMs) || Math.min(Number(this.config?.timeouts?.observeTimeoutMs) || 15000, 12000);
    const startTime = Date.now();

    let resolvedSelector = selector;
    let scopeLabel = selector || (filterText ? `phần tử chứa "${filterText}"` : "dòng dữ liệu");

    if (!resolvedSelector && (action.targetId !== undefined || action.fingerprint)) {
      const { locator, fingerprint } = await this.resolveLocator(session.currentPage, action, elementMap);
      resolvedSelector = await locator
        .first()
        .evaluate((el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === "table") return "tbody tr";
          if (tag === "tbody" || tag === "ul" || tag === "ol") return ":scope > *";
          const cls = typeof el.className === "string"
            ? el.className.split(/\s+/).filter((c) => c && !/^(active|selected|hover|focus|open)$/.test(c)).slice(0, 2)
            : [];
          return cls.length > 0 ? `${tag}.${cls.join(".")}` : tag;
        })
        .catch(() => "tbody tr");
      scopeLabel = fingerprint.label || fingerprint.elemId || resolvedSelector;
    }

    if (!resolvedSelector) {
      resolvedSelector = "tbody tr, [role='row']:not([role='columnheader'])";
    }

    const compareCount = (actual) => {
      if (op === ">=") return actual >= expectedNum;
      if (op === ">") return actual > expectedNum;
      if (op === "<=") return actual <= expectedNum;
      if (op === "<") return actual < expectedNum;
      return actual === expectedNum;
    };

    let actualCount = 0;
    let ok = false;

    while (Date.now() - startTime < timeoutMs) {
      const activePage = session.currentPage;
      let totalVisible = 0;
      for (const fr of activePage.frames()) {
        if (fr.isDetached?.()) continue;
        const cnt = await fr
          .evaluate(
            ({ sel, txt }) => {
              const isVis = (el) => {
                if (!el || el.hidden || el.getAttribute?.("aria-hidden") === "true") return false;
                const st = window.getComputedStyle(el);
                if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) return false;
                const r = el.getBoundingClientRect();
                return r.width > 0.5 && r.height > 0.5;
              };
              let nodes = [];
              try {
                nodes = Array.from(document.querySelectorAll(sel));
              } catch {
                return 0;
              }
              return nodes.filter((n) => {
                if (!isVis(n)) return false;
                const inner = (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                if (!inner) return false;
                if (txt && !inner.includes(txt)) return false;
                // Loại bỏ dòng placeholder "Không có dữ liệu / No data" trong bảng trống
                if (/^(?:không có dữ liệu|no data|empty|trống|chưa có dữ liệu)$/i.test(inner)) return false;
                return true;
              }).length;
            },
            { sel: resolvedSelector, txt: filterText }
          )
          .catch(() => 0);
        totalVisible += cnt;
      }

      actualCount = totalVisible;
      if (compareCount(actualCount)) {
        ok = true;
        break;
      }
      await activePage?.waitForTimeout?.(250).catch(() => {});
    }

    const expectedDesc = `${op} ${expectedNum} mục (${scopeLabel})`;
    if (!ok) {
      const elapsedSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      throw this._createVerdictError(
        `Số lượng "${scopeLabel}" không đạt kỳ vọng sau ${elapsedSec} giây — Kỳ vọng: ${op} ${expectedNum}, Thực tế: ${actualCount}`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "count",
          scope: scopeLabel,
          expected: expectedDesc,
          actual: `${actualCount} mục đang hiển thị`,
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận số lượng phần tử",
        sublabel: `${scopeLabel}: ${actualCount} mục (kỳ vọng ${op} ${expectedNum})`.slice(0, 80),
      });
    }

    return {
      success: true,
      message: `Xác nhận số lượng thành công: đếm được ${actualCount} mục "${scopeLabel}" (kỳ vọng ${op} ${expectedNum})`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "count",
        scope: scopeLabel,
        expected: expectedDesc,
        actual: `${actualCount} mục đang hiển thị`,
        passed: true,
      },
      recordedAction: {
        action: "assertCount",
        selector: resolvedSelector,
        op,
        count: expectedNum,
        ...(action.text ? { text: action.text } : {}),
      },
    };
  }

  /**
   * Nguyên thủy #7: ASSERT DOWNLOAD — Kiểm tra tệp đã tải về khớp tên/đuôi VÀ dung lượng > minBytes (mặc định > 0KB)
   */
  async executeAssertDownload(action, session, takeShotFn = null) {
    const expectedRaw = action.expectedText || action.value || action.filename || "";
    const expectedName = this.resolveVars(String(expectedRaw), session.vars).trim();
    const expectedNorm = expectedName.toLowerCase();
    const minBytes = Number.isFinite(Number(action.minBytes)) ? Number(action.minBytes) : 1;
    const timeoutMs = Number(action.timeoutMs) || 8000;
    const startTime = Date.now();

    let matchedFile = null;
    let lastSize = 0;

    while (Date.now() - startTime < timeoutMs) {
      const scopedDownloads = this._getScopedTelemetry(session, "downloads");
      for (let idx = scopedDownloads.length - 1; idx >= 0; idx--) {
        const f = scopedDownloads[idx];
        const fname = String(f.filename || "");
        if (expectedNorm && !fname.toLowerCase().includes(expectedNorm)) continue;

        let sizeBytes = Number(f.sizeBytes ?? f.size ?? 0);
        if (!sizeBytes && f.path && fs.existsSync(f.path)) {
          try {
            sizeBytes = fs.statSync(f.path).size;
          } catch {
            sizeBytes = 0;
          }
        }
        lastSize = sizeBytes;
        if (sizeBytes >= minBytes) {
          matchedFile = { ...f, sizeBytes };
          break;
        }
      }
      if (matchedFile) break;
      await session.currentPage?.waitForTimeout?.(250).catch(() => {});
    }

    const expectedDesc = expectedName
      ? `Tải tệp khớp "${expectedName}" với dung lượng >= ${minBytes} bytes`
      : `Tải tệp thành công với dung lượng >= ${minBytes} bytes`;

    if (!matchedFile) {
      const actualDesc =
        this._getScopedTelemetry(session, "downloads").length === 0
          ? "Chưa ghi nhận tệp tải về nào trong bước hiện tại/liền trước"
          : `Tệp tải về không khớp tên hoặc dung lượng chỉ có ${lastSize} bytes`;
      throw this._createVerdictError(
        `Kiểm tra tệp tải về thất bại — Kỳ vọng: ${expectedDesc}, Thực tế: ${actualDesc}`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "fileDownloaded",
          scope: "Download trình duyệt",
          expected: expectedDesc,
          actual: actualDesc,
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận tệp tải về",
        sublabel: `${matchedFile.filename} (${matchedFile.sizeBytes} bytes)`.slice(0, 80),
      });
    }

    return {
      success: true,
      message: `Đã xác nhận tệp tải về thành công: "${matchedFile.filename}" (${matchedFile.sizeBytes} bytes)`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "fileDownloaded",
        scope: "Download trình duyệt",
        expected: expectedDesc,
        actual: `"${matchedFile.filename}" (${matchedFile.sizeBytes} bytes)`,
        passed: true,
      },
      recordedAction: {
        action: "assertDownload",
        value: expectedRaw,
        minBytes,
      },
    };
  }

  /**
   * Nguyên thủy #8: ASSERT COMPARE / MATH — So sánh số học / tiền tệ / chuỗi biến đã trích xuất
   */
  async executeAssertCompare(action, session, elementMap = null, takeShotFn = null) {
    const op = String(action.op || "==").trim().toLowerCase().replace(/^=$/, "==");
    const rawExpected = action.expected ?? action.right ?? action.value ?? "";
    const resolvedExpected = this.resolveVars(String(rawExpected), session.vars).trim();

    let rawActual = action.actual ?? action.left ?? "";
    let scopeLabel = "Biến kịch bản";
    let savedFingerprint = action.fingerprint || null;

    if (action.targetId !== undefined || action.fingerprint) {
      const { locator, fingerprint } = await this.resolveLocator(session.currentPage, action, elementMap);
      savedFingerprint = fingerprint;
      scopeLabel = fingerprint.label || fingerprint.elemId || fingerprint.text || "phần tử mục tiêu";
      rawActual = await locator
        .first()
        .evaluate((el) =>
          el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
            ? String(el.value ?? "").trim()
            : String(el.innerText || el.textContent || "").trim()
        )
        .catch(() => "");
    } else {
      rawActual = this.resolveVars(String(rawActual), session.vars).trim();
    }

    const leftNum = this._parseNumericValue(rawActual);
    const rightNum = this._parseNumericValue(resolvedExpected);
    const numericComparable = leftNum !== null && rightNum !== null;

    let passed = false;
    if (op === "contains") {
      passed = String(rawActual).toLowerCase().includes(resolvedExpected.toLowerCase());
    } else if (numericComparable) {
      const eps = 1e-6;
      if (op === "==") passed = Math.abs(leftNum - rightNum) <= eps;
      else if (op === "!=") passed = Math.abs(leftNum - rightNum) > eps;
      else if (op === ">") passed = leftNum > rightNum;
      else if (op === ">=") passed = leftNum >= rightNum - eps;
      else if (op === "<") passed = leftNum < rightNum;
      else if (op === "<=") passed = leftNum <= rightNum + eps;
    } else {
      const aNorm = String(rawActual).replace(/\s+/g, " ").trim().toLowerCase();
      const bNorm = resolvedExpected.replace(/\s+/g, " ").trim().toLowerCase();
      if (op === "==") passed = aNorm === bNorm;
      else if (op === "!=") passed = aNorm !== bNorm;
    }

    const expectedDesc = `${op} "${resolvedExpected}"${numericComparable ? ` (${rightNum})` : ""}`;
    const actualDesc = `"${rawActual}"${numericComparable ? ` (${leftNum})` : ""}`;

    if (!passed) {
      throw this._createVerdictError(
        `Đối chiếu giá trị thất bại tại ${scopeLabel} — Kỳ vọng: ${expectedDesc}, Thực tế: ${actualDesc}`,
        {
          oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
          assertType: "compare",
          scope: scopeLabel,
          expected: expectedDesc,
          actual: actualDesc,
          passed: false,
        },
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Xác nhận đối chiếu giá trị",
        sublabel: `${actualDesc} ${op} ${expectedDesc}`.slice(0, 80),
      });
    }

    return {
      success: true,
      message: `Xác nhận đối chiếu thành công: ${actualDesc} ${op} "${resolvedExpected}"`,
      evidence: {
        oracleSource: ORACLE_SOURCES.DETERMINISTIC_ASSERT,
        assertType: "compare",
        scope: scopeLabel,
        expected: expectedDesc,
        actual: actualDesc,
        passed: true,
      },
      recordedAction: {
        action: "assertCompare",
        op,
        expected: String(rawExpected),
        ...(action.left !== undefined ? { left: String(action.left) } : {}),
        ...(savedFingerprint ? { fingerprint: savedFingerprint } : {}),
      },
    };
  }

  /**
   * Trọng tài AI minh bạch (AI Judge Fallback — chống AI tự chấm đậu `actions: []`)
   * - Yêu cầu khai báo rõ passed (true|false), expected, actual, evidence.
   * - TUYỆT ĐỐI KHÔNG lưu vào Step Trace Cache (`recordedAction: null`) để lần chạy sau luôn thẩm định lại trung thực.
   */
  async executeAssertVerdict(action, session, takeShotFn = null) {
    const passed = action.passed === true || String(action.value || "").toLowerCase() === "pass";
    const expected = String(action.expected || "").trim();
    const actual = String(action.actual || action.evidence || "").trim();
    const reason = String(action.reason || action.evidence || "").trim();

    if (passed && (!expected || !actual)) {
      throw this._createVerdictError(
        "Trọng tài AI từ chối kết luận ĐẠT vì thiếu bằng chứng đối chiếu (expected / actual trống)",
        {
          oracleSource: ORACLE_SOURCES.AI_JUDGE,
          assertType: "verdict",
          expected: expected || "(Thiếu expected)",
          actual: actual || "(Thiếu actual)",
          passed: false,
        },
        FAILURE_TYPES.EXECUTION_ERROR
      );
    }

    const evidence = {
      oracleSource: ORACLE_SOURCES.AI_JUDGE,
      assertType: "verdict",
      scope: "Thẩm định ngữ nghĩa (AI Judge)",
      expected: expected || "Thỏa mãn điều kiện kiểm tra của bước",
      actual: actual || reason || (passed ? "Đạt yêu cầu" : "Không đạt yêu cầu"),
      passed,
    };

    if (!passed) {
      throw this._createVerdictError(
        `Kiểm tra không đạt — Kỳ vọng: ${evidence.expected} | Thực tế: ${evidence.actual}`,
        evidence,
        FAILURE_TYPES.ASSERTION_FAILED
      );
    }

    if (takeShotFn) {
      await takeShotFn("view", {
        label: "Trọng tài AI xác nhận đạt",
        sublabel: evidence.actual.slice(0, 80),
      });
    }

    return {
      success: true,
      message: `Trọng tài AI xác nhận đạt: ${evidence.actual}`,
      evidence,
      // KHÔNG lưu cache cho assertVerdict để tránh phát lại pass giả ở các lần chạy sau!
      recordedAction: null,
    };
  }
}

export const atomicActionsService = new AtomicActionsService();

