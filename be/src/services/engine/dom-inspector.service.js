import { logger } from "../../utils/logger.js";
import {
  CONTAINER_TIER1_SELECTORS,
  CONTAINER_TIER2_SELECTORS,
} from "./dom-selectors.js";

/**
 * Chuẩn hóa nhãn ngữ nghĩa: loại bỏ ký tự trang trí đầu/cuối như *, :, (bắt buộc), (required), (optional), (?), • và khoảng trắng thừa.
 */
export function cleanSemanticLabel(str, maxLen = 80) {
  let s = String(str || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen + 40);
  if (!s) return "";
  let prev = "";
  let guard = 0;
  while (s !== prev && guard < 6) {
    prev = s;
    guard++;
    s = s
      .replace(
        /^\s*(?:\(\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\)|\[\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\]|[*＊•·:：])+\s*/i,
        ""
      )
      .replace(
        /\s*(?:\(\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\)|\[\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\]|[*＊•·:：])+\s*$/i,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();
  }
  return s.slice(0, maxLen);
}

/**
 * KHỐI 1: BỘ QUAN SÁT TRẠNG THÁI TRÌNH DUYỆT HỢP NHẤT (UNIFIED BROWSER INSPECTOR)
 * - Mô hình Định danh Phần tử Thống nhất 5 chiều chuẩn W3C AOM / Playwright (cleanLabel, groupLabel, alt, region, sectionAnchor, occurrenceIndex/Total).
 * - Quét xuyên qua cả Trang chính (mainFrame), mọi Khung nhúng (iframes) và Open Shadow DOM (el.shadowRoot).
 * - Tự động phát hiện và ưu tiên quét trước / cô lập hộp thoại & ngăn kéo nổi (Modal Portal / Dialog / Drawer / Top-Layer)
 *   để không bị cắt cụt bởi giới hạn 160 phần tử ở bảng dữ liệu dài phía dưới.
 * - Hỗ trợ nhận diện đầy đủ Icon Buttons, Clickable Images, Custom Comboboxes, Choice Groups, Toggle Switches và Repeated Table Rows/Cards.
 * - Trích xuất Fingerprint kèm Khung Neo Dòng Cha (containerAnchor) chuẩn xác, không bắt nhầm lưới Bootstrap/Tailwind .row.
 */
export class DomInspectorService {
  /**
   * Quét toàn diện trang hiện tại và các iframes
   * @param {import('playwright').Page} page
   * @param {object} session - Ngữ cảnh phiên chạy (vars, dialogHistory, downloadedFiles, pages)
   */
  async inspect(page, session = {}) {
    if (!page || page.isClosed?.()) {
      return {
        url: "",
        title: "",
        elements: [],
        elementMap: new Map(),
        visibleNotices: [],
        pageTextBlocks: [],
        activeModal: null,
      };
    }

    const url = page.url();
    const title = await page.title().catch(() => "");
    const frames = page.frames();

    let nextId = 1;
    const allElements = [];
    const elementMap = new Map();
    const allNotices = [];
    const allTextBlocks = [];
    let activeModal = null;

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const frame = frames[frameIndex];
      if (frame.isDetached?.()) continue;

      try {
        const frameResult = await frame.evaluate(
          ({ startId, fIdx, tier1Selectors, tier2Selectors }) => {
            const MAX_ELEMENTS = 160;
            const clean = (str, maxLen = 100) =>
              String(str || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, maxLen);

            const getParentOrHost = (node) => {
              if (!node) return null;
              if (node.parentElement) return node.parentElement;
              const root = node.getRootNode?.();
              return root && root.host ? root.host : null;
            };

            const matchesAny = (el, selector) => {
              if (!el || el.nodeType !== 1 || typeof el.matches !== "function") return false;
              try {
                return el.matches(selector);
              } catch {
                return false;
              }
            };

            const isAncestorHidden = (el) => {
              let cur = el;
              let depth = 0;
              while (cur && depth < 30) {
                if (cur.nodeType === 1) {
                  if (cur.hidden === true) return true;
                  const ariaHidden = cur.getAttribute?.("aria-hidden");
                  if (ariaHidden === "true" && cur !== el) return true;
                  const st = window.getComputedStyle(cur);
                  if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
                    return true;
                  }
                  if (parseFloat(st.opacity) === 0 && cur.tagName !== "INPUT" && cur.tagName !== "SELECT") {
                    return true;
                  }
                }
                cur = getParentOrHost(cur);
                depth++;
              }
              return false;
            };

            const isVisible = (el) => {
              if (!el || el.nodeType !== 1 || !el.getBoundingClientRect) return false;
              const st = window.getComputedStyle(el);
              if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
                return false;
              }
              if (
                el.tagName === "INPUT" &&
                (el.type === "file" || el.type === "checkbox" || el.type === "radio")
              ) {
                // Chỉ ẩn khi tổ tiên bị display:none/visibility:hidden
                return !isAncestorHidden(getParentOrHost(el));
              }
              if (parseFloat(st.opacity) === 0 && el.tagName !== "INPUT" && el.tagName !== "SELECT") {
                return false;
              }
              if (isAncestorHidden(el)) return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 1 && rect.height > 1;
            };

            // Duyệt toàn bộ cây DOM theo đúng thứ tự tài liệu, xuyên cả Open Shadow DOM
            const collectAllDomElements = (root, out = []) => {
              if (!root) return out;
              const children = root.children || [];
              for (let i = 0; i < children.length; i++) {
                const child = children[i];
                out.push(child);
                if (child.shadowRoot) {
                  collectAllDomElements(child.shadowRoot, out);
                }
                collectAllDomElements(child, out);
              }
              return out;
            };

            const docRoot = document.body || document.documentElement;
            const allDomElements = collectAllDomElements(docRoot, []);

            // Xóa dấu vết data-at-id cũ trên cả Light DOM lẫn Shadow DOM
            for (const node of allDomElements) {
              if (node.hasAttribute?.("data-at-id")) {
                node.removeAttribute("data-at-id");
              }
            }

            // Kiểm tra node có nằm trong hậu duệ của 1 container nào đó (kể cả qua ShadowRoot) không
            const isInsideContainer = (node, container) => {
              if (!node || !container) return false;
              let cur = node;
              while (cur) {
                if (cur === container) return true;
                cur = getParentOrHost(cur);
              }
              return false;
            };

            // ─── BƯỚC 1: PHÁT HIỆN MODAL / DIALOG / DRAWER / TOP-LAYER ĐANG MỞ ───
            const modalStaticSelector = [
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

            const modalCandidates = [];
            for (const cand of allDomElements) {
              if (!cand || cand === document.body || cand === document.documentElement) continue;
              let isNativeTopModal = false;
              try {
                isNativeTopModal = cand.matches(":modal");
              } catch { }

              const isExplicitModal = isNativeTopModal || matchesAny(cand, modalStaticSelector);
              let isHighZOverlay = false;
              if (!isExplicitModal) {
                const st = window.getComputedStyle(cand);
                const z = parseInt(st.zIndex, 10);
                const cls = typeof cand.className === "string" ? cand.className.toLowerCase() : "";
                if (
                  (st.position === "fixed" || st.position === "absolute") &&
                  Number.isFinite(z) &&
                  z >= 50 &&
                  !matchesAny(cand, "header, nav, [role='navigation'], [role='banner']") &&
                  /(modal|dialog|drawer|popup|sheet|overlay|popover)/i.test(cls)
                ) {
                  isHighZOverlay = true;
                }
              }

              if (!isExplicitModal && !isHighZOverlay) continue;
              if (cand.getAttribute("aria-hidden") === "true") continue;
              if (!isVisible(cand)) continue;
              const rect = cand.getBoundingClientRect();
              if (rect.width < 120 || rect.height < 60) continue;

              const st = window.getComputedStyle(cand);
              const zIndex = Number.parseInt(st.zIndex, 10);
              const blocking =
                isNativeTopModal ||
                cand.tagName === "DIALOG" ||
                cand.getAttribute("aria-modal") === "true" ||
                matchesAny(cand, ".modal.show, .ant-modal, .MuiDialog-paper, .swal2-popup, [role='alertdialog']");

              modalCandidates.push({
                el: cand,
                zIndex: Number.isFinite(zIndex) ? zIndex : 0,
                domOrder: allDomElements.indexOf(cand),
                blocking,
              });
            }

            // Loại bỏ ứng viên cha nếu đã có ứng viên con bên trong rõ ràng hơn (vd: .modal-wrap chứa [role="dialog"])
            const leafModals = modalCandidates.filter(
              (m) => !modalCandidates.some((other) => other !== m && isInsideContainer(other.el, m.el))
            );

            leafModals.sort((a, b) => {
              if (b.zIndex !== a.zIndex) return b.zIndex - a.zIndex;
              return b.domOrder - a.domOrder;
            });

            const activeTopModal = leafModals.length > 0 ? leafModals[0] : null;
            let modalInfo = null;
            if (activeTopModal) {
              const modalEl = activeTopModal.el;
              const titleNode = modalEl.querySelector(
                "h1, h2, h3, h4, .modal-title, .ant-modal-title, .ant-drawer-title, [class*='modal-title'], [class*='dialog-title'], [id*='title']"
              );
              const modalTitle = clean(
                titleNode?.innerText ||
                titleNode?.textContent ||
                modalEl.getAttribute("aria-label") ||
                "Hộp thoại đang mở",
                80
              );
              modalInfo = {
                title: modalTitle,
                blocking: activeTopModal.blocking,
                zIndex: activeTopModal.zIndex,
              };
            }

            // Các portal popup nổi đi kèm (Combobox Listbox / Menu / Datepicker mở trên body trong lúc modal mở)
            const floatingPopupSelector = [
              '[role="listbox"]',
              '[role="menu"]',
              ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
              ".ant-dropdown:not(.ant-dropdown-hidden)",
              ".MuiPopover-root",
              ".MuiAutocomplete-popper",
              ".dropdown-menu.show",
            ].join(", ");

            const isInFloatingOverlay = (el) => {
              let cur = el;
              let depth = 0;
              while (cur && depth < 15) {
                if (matchesAny(cur, floatingPopupSelector) && isVisible(cur)) {
                  return true;
                }
                cur = getParentOrHost(cur);
                depth++;
              }
              return false;
            };

            // ─── BƯỚC 2: KHUNG NEO DÒNG CHA (CONTAINER ANCHOR) CHÍNH XÁC ───
            const tier1Query = tier1Selectors.join(", ");
            const tier2Query = tier2Selectors.join(", ");
            const isSubPartOrGridWrapper = (cand) => {
              const cls = typeof cand.className === "string" ? cand.className.toLowerCase() : "";
              if (!cls) return false;
              // Tránh bắt nhầm thẻ phần nhỏ bên trong card (footer/actions/badge) hoặc thẻ lưới bao nhiều card (list/grid/group)
              if (
                /(?:^|[\s_-])(header|footer|body|actions|btns|title|meta|icon|badge|label|img|image|thumb)(?:$|[\s_-])/i.test(
                  cls
                )
              ) {
                return true;
              }
              if (
                /(?:^|[\s_-])(products|cards|items|tickets|records|list|grid|group|wrapper|container|row|flex-row|row-cols)/i.test(
                  cls
                )
              ) {
                return true;
              }
              // Tránh bắt nhầm thẻ bọc trường biểu mẫu (AntD .ant-form-item, .form-item-control, .selection-item) làm khung dòng dữ liệu lặp
              if (
                /(?:^|[\s_-])(form-item|form-field|form-control|selection-item|select-item)(?:$|[\s_-])/i.test(
                  cls
                )
              ) {
                return true;
              }
              return false;
            };

            const getContainerContext = (el) => {
              // Ưu tiên Tier 1 (tr, [role="row"], [role="listitem"], article, li) qua Shadow DOM host
              let row = null;
              let cur = getParentOrHost(el);
              let depth = 0;
              while (cur && cur !== document.body && cur !== document.documentElement && depth < 10) {
                if (matchesAny(cur, tier1Query)) {
                  // Bỏ qua nav/menu lớn nếu li chứa quá nhiều nút tương tác (> 10)
                  if (cur.tagName === "LI") {
                    const interactiveCount = cur.querySelectorAll("a, button, [role='button']").length;
                    if (interactiveCount <= 10) {
                      row = cur;
                      break;
                    }
                  } else {
                    row = cur;
                    break;
                  }
                }
                cur = getParentOrHost(cur);
                depth++;
              }

              // Nếu không có Tier 1, tìm Tier 2 ([class*="product"], [class*="card"], [class*="item"], ...) nhỏ nhất hợp lệ
              if (!row) {
                cur = getParentOrHost(el);
                depth = 0;
                while (cur && cur !== document.body && cur !== document.documentElement && depth < 10) {
                  if (matchesAny(cur, tier2Query) && !isSubPartOrGridWrapper(cur)) {
                    row = cur;
                    break;
                  }
                  cur = getParentOrHost(cur);
                  depth++;
                }
              }

              if (!row || row === document.body) return { anchor: "", fullRowText: "" };

              const titleEl = row.querySelector(
                'h1, h2, h3, h4, h5, strong, b, [class*="title"], [class*="name"], [class*="code"], td:first-child, td:nth-child(2)'
              );
              const anchor = titleEl ? clean(titleEl.innerText || titleEl.textContent, 70) : "";
              const fullRowText = clean(row.innerText || row.textContent, 120);
              return {
                anchor: anchor || fullRowText.slice(0, 60),
                fullRowText,
              };
            };

            // ─── BƯỚC 3: TRÍCH XUẤT NHÃN, NGỮ CẢNH & ICON ACCESSIBILITY (5-DIMENSIONAL IDENTITY) ───
            const norm = (str) =>
              String(str || "")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();

            const cleanSemanticLabel = (str, maxLen = 80) => {
              let s = clean(str, maxLen + 40);
              if (!s) return "";
              let prev = "";
              let guard = 0;
              while (s !== prev && guard < 6) {
                prev = s;
                guard++;
                s = s
                  .replace(
                    /^\s*(?:\(\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\)|\[\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\]|[*＊•·:：])+\s*/i,
                    ""
                  )
                  .replace(
                    /\s*(?:\(\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\)|\[\s*(?:bắt buộc|required|optional|tùy chọn|\?)\s*\]|[*＊•·:：])+\s*$/i,
                    ""
                  )
                  .replace(/\s+/g, " ")
                  .trim();
              }
              return s.slice(0, maxLen);
            };

            const closestAcrossShadow = (el, selector) => {
              let cur = el;
              let depth = 0;
              while (cur && cur !== document.body && cur !== document.documentElement && depth < 30) {
                if (matchesAny(cur, selector)) return cur;
                cur = getParentOrHost(cur);
                depth++;
              }
              return null;
            };

            const choiceControlSelector =
              'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]';

            const customComboboxSelector = [
              '[role="combobox"]',
              '[aria-haspopup="listbox"]',
              ".ant-select",
              ".ant-select-selector",
              ".MuiSelect-select",
              '[class*="select-trigger"]',
            ].join(", ");

            const formGroupSelector =
              '.form-group, .field, .input-group, .ant-form-item, .MuiFormControl-root, [class*="form-item"], [class*="field"]';

            const interactiveDescendantSelector =
              'input:not([type="hidden"]), select, textarea, button, a[href], [role="button"], [role="combobox"], [aria-haspopup="listbox"], [role="checkbox"], [role="radio"], [role="switch"], [contenteditable="true"]';

            const isChoiceControl = (el) => {
              if (!el || el.nodeType !== 1) return false;
              const tag = el.tagName;
              const type = (el.getAttribute("type") || "").toLowerCase();
              const role = (el.getAttribute("role") || "").toLowerCase();
              return (
                (tag === "INPUT" && (type === "checkbox" || type === "radio")) ||
                role === "checkbox" ||
                role === "radio" ||
                role === "switch"
              );
            };

            const isCustomCombobox = (el) => {
              if (!el || el.nodeType !== 1) return false;
              if (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                return false;
              }
              return matchesAny(el, customComboboxSelector);
            };

            const isInputButton = (el) => {
              if (!el || el.nodeType !== 1 || el.tagName !== "INPUT") return false;
              const type = (el.getAttribute("type") || "").toLowerCase();
              return type === "button" || type === "submit" || type === "reset" || type === "image";
            };

            const isStandardFormControl = (el) => {
              if (!el || el.nodeType !== 1) return false;
              if (isChoiceControl(el) || isInputButton(el)) return false;
              return (
                el.tagName === "INPUT" ||
                el.tagName === "SELECT" ||
                el.tagName === "TEXTAREA" ||
                el.getAttribute("role") === "combobox" ||
                el.getAttribute("contenteditable") === "true" ||
                isCustomCombobox(el)
              );
            };

            const isFormControl = (el) => isChoiceControl(el) || isStandardFormControl(el);

            const isButtonOrLinkLike = (tag, type, role) =>
              tag === "button" ||
              tag === "a" ||
              role === "button" ||
              role === "link" ||
              role === "tab" ||
              role === "menuitem" ||
              (tag === "input" && (type === "button" || type === "submit" || type === "reset"));

            const extractLabelNodeText = (labelEl, excludeEl = null, maxLen = 80) => {
              if (!labelEl) return "";
              const parts = [];
              const blockTags = new Set(["DIV", "P", "BR", "LI", "TR", "TD", "TH", "DT", "DD", "H1", "H2", "H3", "H4", "H5", "H6"]);
              const walk = (node) => {
                if (!node || node === excludeEl) return;
                if (node.nodeType === 3) {
                  const t = node.nodeValue || "";
                  if (t) parts.push(t);
                  return;
                }
                if (node.nodeType !== 1) return;
                const tag = node.tagName;
                if (
                  tag === "INPUT" ||
                  tag === "SELECT" ||
                  tag === "TEXTAREA" ||
                  tag === "OPTION" ||
                  tag === "OPTGROUP" ||
                  tag === "DATALIST" ||
                  tag === "BUTTON" ||
                  tag === "SCRIPT" ||
                  tag === "STYLE" ||
                  tag === "NOSCRIPT" ||
                  tag === "SVG"
                ) {
                  return;
                }
                if (excludeEl && isCustomCombobox(node) && (node === excludeEl || node.contains(excludeEl))) {
                  return;
                }
                if (node !== labelEl) {
                  try {
                    const st = window.getComputedStyle(node);
                    if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") {
                      return;
                    }
                  } catch { }
                }
                const isBlk = blockTags.has(tag);
                if (isBlk) parts.push(" ");
                for (const child of node.childNodes) {
                  walk(child);
                }
                if (isBlk) parts.push(" ");
              };
              walk(labelEl);
              return clean(parts.join(""), maxLen);
            };

            const stripTrailingBadge = (rawStr, el = null) => {
              const s = clean(rawStr, 100);
              if (!s) return "";

              // 0. Nếu có thẻ badge/counter con mang giá trị số ở cuối (vd: <button>Giỏ hàng<span class="badge">3</span></button>)
              if (el && typeof el.querySelectorAll === "function") {
                const badgeNodes = el.querySelectorAll(
                  '.badge, [class*="badge"], [class*="count"], [class*="counter"], .ant-badge-count, .MuiBadge-badge, sup'
                );
                if (badgeNodes.length > 0) {
                  const lastBadge = badgeNodes[badgeNodes.length - 1];
                  if (isVisible(lastBadge)) {
                    const badgeTxt = clean(lastBadge.innerText || lastBadge.textContent, 20);
                    if (badgeTxt && /^[\(\[]?\s*\d+\+?\s*[\)\]]?$/.test(badgeTxt) && s.endsWith(badgeTxt)) {
                      const candidateBase = cleanSemanticLabel(s.slice(0, s.length - badgeTxt.length), 80);
                      if (candidateBase && /[a-zA-ZÀ-ỹ\u00C0-\u024F\u1E00-\u1EFF]/i.test(candidateBase)) {
                        return candidateBase;
                      }
                    }
                  }
                }
              }

              // 1. Hậu tố bộ đếm trong ngoặc tròn / ngoặc vuông: "Giỏ hàng (3)", "Tin nhắn [5]", "Thông báo (99+)"
              let m = s.match(/^(.+?)\s*(?:[•·|-]\s*)?[\(\[]\s*\d+\+?\s*[\)\]]\s*$/);
              if (m && m[1]) {
                const base = cleanSemanticLabel(m[1], 80);
                if (base && /[a-zA-ZÀ-ỹ\u00C0-\u024F\u1E00-\u1EFF]/i.test(base)) {
                  return base;
                }
              }

              // 2. Hậu tố số tách biệt: "Thông báo 12", "Giỏ hàng 3", "Thông báo • 12", "Inbox 99+"
              m = s.match(/^(.+?)(?:\s*[•·|-]\s*|\s+)(\d+\+?)\s*$/);
              if (m && m[1] && m[2]) {
                const base = cleanSemanticLabel(m[1], 80);
                const numToken = m[2];
                const hasBadgeChild = Boolean(
                  el?.querySelector?.(
                    '.badge, [class*="badge"], [class*="count"], [class*="counter"], .ant-badge-count, .MuiBadge-badge, sup'
                  )
                );
                const isLikelyYear = /^(?:19|20)\d{2}$/.test(numToken);
                const isOrdinalLabel =
                  /^(?:trang|page|bước|step|tab|mục|item|option|phần|part|chương|chapter|cấp|level|lớp|class|phiên bản|version|khu|tầng|floor|bàn|table|phòng|room|mẫu|sample|user|tài khoản|nhóm|group|sản phẩm|product|đơn hàng|order|câu|question)$/i.test(
                    base
                  );
                if (
                  base &&
                  /[a-zA-ZÀ-ỹ\u00C0-\u024F\u1E00-\u1EFF]/i.test(base) &&
                  (hasBadgeChild || (!isLikelyYear && !isOrdinalLabel && numToken.length <= 5))
                ) {
                  return base;
                }
              }

              return s;
            };

            const resolveAriaLabelledBy = (el) => {
              const idsRaw = el.getAttribute("aria-labelledby");
              if (!idsRaw) return "";
              const rootNode = el.getRootNode?.() || document;
              const parts = [];
              for (const idToken of idsRaw.trim().split(/\s+/)) {
                if (!idToken) continue;
                const refEl =
                  (typeof rootNode.getElementById === "function" ? rootNode.getElementById(idToken) : null) ||
                  document.getElementById(idToken);
                if (refEl) {
                  const t = extractLabelNodeText(refEl, el, 60);
                  if (t) parts.push(t);
                }
              }
              return clean(parts.join(" "), 80);
            };

            const findLabelForId = (el, targetId) => {
              if (!targetId) return "";
              try {
                const rootNode = el.getRootNode?.() || document;
                const lbl =
                  rootNode.querySelector?.(`label[for="${CSS.escape(targetId)}"]`) ||
                  document.querySelector(`label[for="${CSS.escape(targetId)}"]`);
                if (lbl) {
                  return extractLabelNodeText(lbl, el, 80);
                }
              } catch { }
              return "";
            };

            const isValidSiblingLabelNode = (sib, el, allowedTags, maxLen = 60) => {
              if (!sib || sib.nodeType !== 1) return "";
              if (!allowedTags.has(sib.tagName)) return "";
              if (!isVisible(sib)) return "";
              if (matchesAny(sib, interactiveDescendantSelector) || sib.hasAttribute("onclick")) return "";
              if (sib.querySelector?.(interactiveDescendantSelector)) return "";
              // Bỏ qua label[for] đang trỏ rõ ràng sang 1 phần tử khác
              if (sib.tagName === "LABEL") {
                const forAttr = sib.getAttribute("for");
                if (forAttr && forAttr !== el.id) {
                  const innerId = isCustomCombobox(el) ? el.querySelector?.("input[id]")?.id : "";
                  if (!innerId || forAttr !== innerId) return "";
                }
              }
              // Bỏ qua tiền tố/hậu tố addon của input-group (vd: "https://", "VNĐ", "+84")
              const cls = typeof sib.className === "string" ? sib.className.toLowerCase() : "";
              if (/(?:^|[\s_-])(input-group-text|input-group-prepend|input-group-append|input-prefix|input-suffix|addon)(?:$|[\s_-])/i.test(cls)) {
                return "";
              }
              const txt = extractLabelNodeText(sib, el, maxLen + 10);
              if (!txt || txt.length > maxLen) return "";
              const cleaned = cleanSemanticLabel(txt, maxLen);
              if (!cleaned || !/[a-zA-Z0-9À-ỹ\u00C0-\u024F\u1E00-\u1EFF]/.test(cleaned)) return "";
              return txt;
            };

            const getChoiceOwnLabel = (el) => {
              // 1. aria-label & aria-labelledby
              const ariaLabel = el.getAttribute("aria-label");
              if (ariaLabel) return clean(ariaLabel, 80);

              const labelledBy = resolveAriaLabelledBy(el);
              if (labelledBy) return labelledBy;

              // 2. label[for]
              if (el.id) {
                const forLbl = findLabelForId(el, el.id);
                if (forLbl) return forLbl;
              }

              // 3. Direct wrapping <label> (excluding inner input value/controls)
              const parentLabel = el.closest?.("label");
              if (parentLabel) {
                const wrapTxt = extractLabelNodeText(parentLabel, el, 80);
                if (wrapTxt) return wrapTxt;
              }

              // 4. Immediate sibling <label>/<span> (or text node) inside the same small wrapper
              const choiceSibTags = new Set(["LABEL", "SPAN", "P", "DIV"]);
              const nextElTxt = isValidSiblingLabelNode(el.nextElementSibling, el, choiceSibTags, 80);
              if (nextElTxt) return nextElTxt;

              // Raw text node immediately after checkbox/radio: <div><input type="checkbox"/> Đồng ý</div>
              if (el.nextSibling && el.nextSibling.nodeType === 3) {
                const rawNext = clean(el.nextSibling.nodeValue, 80);
                if (rawNext && rawNext.length <= 80 && cleanSemanticLabel(rawNext)) {
                  return rawNext;
                }
              }

              // Chỉ xét previousElementSibling / parent sibling khi wrapper chỉ chứa đúng 1 choice control
              // (tránh lấy nhầm nhãn nhóm .form-group > label làm nhãn riêng của option!)
              const parent = el.parentElement;
              const isGroupBoundary = (node) =>
                !node ||
                node === document.body ||
                node === document.documentElement ||
                node.tagName === "FORM" ||
                node.tagName === "SECTION" ||
                node.tagName === "MAIN" ||
                node.tagName === "FIELDSET" ||
                matchesAny(node, '[role="radiogroup"], [role="group"]');

              if (parent && !isGroupBoundary(parent)) {
                const isPluralFormWrap = (node) => {
                  const cls = typeof node?.className === "string" ? node.className.toLowerCase() : "";
                  return /(?:^|[\s_-])(fields|form-items|controls|inputs)(?:$|[\s_-])/i.test(cls);
                };
                const siblingChoiceCount = parent.querySelectorAll(choiceControlSelector).length;
                if (siblingChoiceCount === 1 && !isPluralFormWrap(parent)) {
                  const prevElTxt = isValidSiblingLabelNode(el.previousElementSibling, el, choiceSibTags, 80);
                  if (prevElTxt) return prevElTxt;

                  if (el.previousSibling && el.previousSibling.nodeType === 3) {
                    const rawPrev = clean(el.previousSibling.nodeValue, 80);
                    if (rawPrev && rawPrev.length <= 80 && cleanSemanticLabel(rawPrev)) {
                      return rawPrev;
                    }
                  }

                  // Trường hợp toggle switch bọc trong 1 div con nhỏ (vd: .ant-form-item-control hoặc <div class="row"><span>Kích hoạt</span><div class="sw"><button role="switch"/></div></div>)
                  const grandParent = parent.parentElement;
                  if (
                    grandParent &&
                    !isGroupBoundary(grandParent) &&
                    !isPluralFormWrap(grandParent) &&
                    grandParent.querySelectorAll(choiceControlSelector).length === 1
                  ) {
                    const pNextTxt = isValidSiblingLabelNode(parent.nextElementSibling, el, choiceSibTags, 60);
                    if (pNextTxt) return pNextTxt;
                    const pPrevTxt = isValidSiblingLabelNode(parent.previousElementSibling, el, choiceSibTags, 60);
                    if (pPrevTxt) return pPrevTxt;
                  }
                }
              }

              // 5. Đối với custom choice control không phải <input> (vd: <div role="radio">Giao nhanh</div>)
              if (el.tagName !== "INPUT") {
                const selfTxt = clean(el.innerText || el.textContent, 80);
                if (selfTxt) return selfTxt;
              }

              return "";
            };

            const getGroupLabel = (el, ownLabel, ownCleanLabel) => {
              if (!isChoiceControl(el)) return "";

              const ownNorms = new Set([norm(ownLabel), norm(ownCleanLabel)].filter(Boolean));
              const acceptGroup = (raw) => {
                const cleaned = cleanSemanticLabel(raw, 80);
                if (!cleaned) return "";
                if (ownNorms.has(norm(cleaned))) return "";
                return cleaned;
              };

              // 1. Enclosing <fieldset> > <legend>
              const fieldset = closestAcrossShadow(el, "fieldset");
              if (fieldset) {
                const legends = fieldset.querySelectorAll("legend");
                for (const lg of legends) {
                  if (!isVisible(lg) || lg.contains(el)) continue;
                  if (lg.closest("fieldset") !== fieldset) continue;
                  const g = acceptGroup(extractLabelNodeText(lg, el, 80));
                  if (g) return g;
                }
              }

              // 2. Enclosing [role="radiogroup"] hoặc [role="group"]
              const roleGroup = closestAcrossShadow(el, '[role="radiogroup"], [role="group"]');
              if (roleGroup) {
                const rgAria = roleGroup.getAttribute("aria-label");
                if (rgAria) {
                  const g = acceptGroup(rgAria);
                  if (g) return g;
                }
                const rgBy = resolveAriaLabelledBy(roleGroup);
                if (rgBy) {
                  const g = acceptGroup(rgBy);
                  if (g) return g;
                }
                const rgHead = roleGroup.querySelector(
                  "legend, h1, h2, h3, h4, h5, h6, .form-label, .control-label, .label, [class*='group-label'], [class*='group-title']"
                );
                if (rgHead && isVisible(rgHead) && !rgHead.contains(el) && !rgHead.querySelector(choiceControlSelector)) {
                  const g = acceptGroup(extractLabelNodeText(rgHead, el, 80));
                  if (g) return g;
                }
              }

              // 3. Enclosing .form-group / .ant-form-item / .MuiFormControl-root / .field
              let curGroup = closestAcrossShadow(el, formGroupSelector);
              let groupDepth = 0;
              while (curGroup && curGroup !== document.body && groupDepth < 3) {
                groupDepth++;
                const gCls = typeof curGroup.className === "string" ? curGroup.className.toLowerCase() : "";
                const isPluralWrap = /(?:^|[\s_-])(fields|form-items|controls|inputs)(?:$|[\s_-])/i.test(gCls);
                if (!isPluralWrap) {
                  // Thu thập tất cả id của choice controls trong nhóm để loại trừ label[for] của từng option
                  const choiceIds = new Set();
                  for (const ch of curGroup.querySelectorAll(choiceControlSelector)) {
                    if (ch.id) choiceIds.add(ch.id);
                  }

                  const candidates = curGroup.querySelectorAll(
                    ".ant-form-item-label, .MuiFormLabel-root, .form-label, .control-label, legend, h1, h2, h3, h4, h5, label, .label, [class*='label'], [class*='title']"
                  );
                  for (const cand of candidates) {
                    if (!isVisible(cand)) continue;
                    if (cand.contains(el) || cand.querySelector(choiceControlSelector)) continue;
                    if (cand.tagName === "LABEL") {
                      const forAttr = cand.getAttribute("for");
                      if (forAttr && choiceIds.has(forAttr)) continue;
                    }
                    // Loại trừ nhãn nằm ngay sau 1 choice control (nhãn riêng của option khác)
                    if (cand.previousElementSibling && isChoiceControl(cand.previousElementSibling)) continue;
                    // Loại trừ nhãn nằm trong cùng 1 option wrapper con có chứa choice control
                    const cParent = cand.parentElement;
                    if (
                      cParent &&
                      cParent !== curGroup &&
                      curGroup.contains(cParent) &&
                      cParent.querySelector(choiceControlSelector)
                    ) {
                      continue;
                    }
                    const g = acceptGroup(extractLabelNodeText(cand, el, 80));
                    if (g) return g;
                  }
                }
                curGroup = closestAcrossShadow(getParentOrHost(curGroup), formGroupSelector);
              }

              return "";
            };

            const getStandardFormControlLabel = (el) => {
              // 1. aria-label
              const ariaLabel = el.getAttribute("aria-label");
              if (ariaLabel) return clean(ariaLabel, 80);

              // 2. aria-labelledby
              const labelledBy = resolveAriaLabelledBy(el);
              if (labelledBy) return labelledBy;

              // 3. label[for] (hỗ trợ cả inner input[id] bên trong custom combobox wrapper)
              if (el.id) {
                const forLbl = findLabelForId(el, el.id);
                if (forLbl) return forLbl;
              }
              if (isCustomCombobox(el)) {
                const innerId = el.querySelector?.("input[id]")?.id;
                if (innerId) {
                  const forLbl = findLabelForId(el, innerId);
                  if (forLbl) return forLbl;
                }
              }

              // 4. Wrapping <label> (loại trừ text của input/select/option/textarea bên trong!)
              const parentLabel = el.closest?.("label");
              if (parentLabel) {
                const wrapTxt = extractLabelNodeText(parentLabel, el, 80);
                if (wrapTxt) return wrapTxt;
              }

              // 5. Sibling Label: kiểm tra previousElementSibling hoặc previousElementSibling của cha trong flex/grid/table row
              const sibTags = new Set(["LABEL", "SPAN", "DIV", "P", "DT", "TH", "TD"]);
              const directPrev = isValidSiblingLabelNode(el.previousElementSibling, el, sibTags, 60);
              if (directPrev) return directPrev;

              // Đi ngược tối đa 2 lớp wrapper đơn phần tử (vd: <div class="flex"><div class="w-32">Email</div><div class="flex-1"><input/></div></div>)
              let wrapper = el.parentElement;
              for (let lvl = 0; lvl < 2 && wrapper; lvl++) {
                if (
                  wrapper === document.body ||
                  wrapper === document.documentElement ||
                  wrapper.tagName === "FORM" ||
                  wrapper.tagName === "SECTION" ||
                  wrapper.tagName === "MAIN" ||
                  wrapper.tagName === "FIELDSET"
                ) {
                  break;
                }
                // Đảm bảo wrapper chỉ đại diện cho đúng 1 control này (không nhảy sang cột label của dòng khác)
                const innerControls = wrapper.querySelectorAll(
                  'input:not([type="hidden"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"]'
                );
                let distinctControlCount = 0;
                for (const c of innerControls) {
                  if (c === el || el.contains(c)) continue;
                  distinctControlCount++;
                }
                if (distinctControlCount > 0) break;

                const parentPrev = isValidSiblingLabelNode(wrapper.previousElementSibling, el, sibTags, 60);
                if (parentPrev) return parentPrev;
                wrapper = wrapper.parentElement;
              }

              // 6. Enclosing .form-group / .field / .input-group / .ant-form-item / .MuiFormControl-root / [class*="form-item"] / [class*="field"]
              let formGroup = el.closest?.(formGroupSelector);
              let fgDepth = 0;
              while (formGroup && formGroup !== document.body && fgDepth < 3) {
                fgDepth++;
                const fgCls = typeof formGroup.className === "string" ? formGroup.className.toLowerCase() : "";
                const isPluralWrap = /(?:^|[\s_-])(fields|form-items|controls|inputs)(?:$|[\s_-])/i.test(fgCls);
                if (!isPluralWrap) {
                  const lblCandidates = formGroup.querySelectorAll(
                    ".ant-form-item-label, .MuiFormLabel-root, label, .label, [class*='label']"
                  );
                  for (const lbl of lblCandidates) {
                    if (!isVisible(lbl) || lbl.contains(el)) continue;
                    if (lbl.tagName === "LABEL") {
                      const forAttr = lbl.getAttribute("for");
                      const innerId = isCustomCombobox(el) ? el.querySelector?.("input[id]")?.id : "";
                      if (forAttr && forAttr !== el.id && (!innerId || forAttr !== innerId)) continue;
                    }
                    const txt = extractLabelNodeText(lbl, el, 80);
                    if (txt) return txt;
                  }
                }
                formGroup = formGroup.parentElement?.closest?.(formGroupSelector) || null;
              }

              return "";
            };

            const getElementLabel = (el) => {
              if (isChoiceControl(el)) {
                return getChoiceOwnLabel(el);
              }
              if (isStandardFormControl(el)) {
                return getStandardFormControlLabel(el);
              }

              const ariaLabel = el.getAttribute("aria-label");
              if (ariaLabel) return clean(ariaLabel, 80);

              const labelledBy = resolveAriaLabelledBy(el);
              if (labelledBy) return labelledBy;

              if (el.tagName === "IMG" || el.getAttribute("alt")) {
                const selfAlt = el.getAttribute("alt");
                if (selfAlt) return clean(selfAlt, 80);
                const selfTitle = el.getAttribute("title");
                if (selfTitle) return clean(selfTitle, 80);
              }

              // Hỗ trợ đọc alt của ảnh hoặc <svg><title> bên trong nút/link
              const imgAlt = el.querySelector?.("img[alt]")?.getAttribute("alt");
              if (imgAlt) return clean(imgAlt, 80);

              const svgTitle = el.querySelector?.("svg title")?.textContent;
              if (svgTitle) return clean(svgTitle, 80);

              const svgAria = el.querySelector?.("svg[aria-label]")?.getAttribute("aria-label");
              if (svgAria) return clean(svgAria, 80);

              return "";
            };

            const extractCustomComboboxState = (el) => {
              const attrPlaceholder = clean(
                el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || "",
                80
              );
              const hasDataPlaceholderAttr = el.hasAttribute("data-placeholder");
              const dataPlaceholderVal = clean(el.getAttribute("data-placeholder"), 80);

              const rawDisplayed = clean(el.innerText || el.textContent, 80);
              const cleanedDisplayed = rawDisplayed.replace(/^[\s▼▾⌄▲▴]+|[\s▼▾⌄▲▴]+$/g, "").trim();

              const innerInputPh = clean(
                el.querySelector?.("input[placeholder]")?.getAttribute("placeholder"),
                80
              );

              const selfCls =
                typeof el.className === "string" ? el.className : el.getAttribute?.("class") || "";
              const isSelfPlaceholderClass = /placeholder/i.test(selfCls);

              // 1. Radix/Shadcn boolean data-placeholder="" hoặc bản thân phần tử có class placeholder
              if ((hasDataPlaceholderAttr && !dataPlaceholderVal) || isSelfPlaceholderClass) {
                return {
                  value: "",
                  placeholder: cleanedDisplayed || attrPlaceholder || dataPlaceholderVal || innerInputPh || "",
                };
              }

              // 2. Kiểm tra node con placeholder rõ ràng (vd: .ant-select-selection-placeholder, [class*="placeholder"])
              let visiblePlaceholderText = "";
              const phNodes =
                el.querySelectorAll?.(
                  '.ant-select-selection-placeholder, [class*="placeholder"], [data-placeholder]'
                ) || [];
              for (const pn of phNodes) {
                if (!isVisible(pn)) continue;
                const t = clean(pn.innerText || pn.textContent, 80);
                if (t) {
                  visiblePlaceholderText = t;
                  break;
                }
              }

              // 3. Kiểm tra node con giá trị đang chọn rõ ràng (vd: .ant-select-selection-item, React-Select single-value)
              const selectedNodes =
                el.querySelectorAll?.(
                  '.ant-select-selection-item, [class*="single-value"], [class*="selected-value"]'
                ) || [];
              const visibleSelectedTexts = [];
              for (const sn of selectedNodes) {
                if (!isVisible(sn)) continue;
                const snCls = typeof sn.className === "string" ? sn.className : "";
                if (/placeholder/i.test(snCls) || sn.hasAttribute("data-placeholder")) continue;
                const t = clean(sn.innerText || sn.textContent, 60);
                if (t) visibleSelectedTexts.push(t);
              }
              const explicitSelected = clean(visibleSelectedTexts.join(", "), 80);

              const knownPh = attrPlaceholder || dataPlaceholderVal || innerInputPh;

              if (explicitSelected) {
                return {
                  value: explicitSelected,
                  placeholder: knownPh || "",
                };
              }

              if (
                visiblePlaceholderText &&
                (!cleanedDisplayed || norm(cleanedDisplayed) === norm(visiblePlaceholderText))
              ) {
                return {
                  value: "",
                  placeholder: visiblePlaceholderText,
                };
              }

              if (knownPh && cleanedDisplayed && norm(cleanedDisplayed) === norm(knownPh)) {
                return {
                  value: "",
                  placeholder: knownPh,
                };
              }

              return {
                value: cleanedDisplayed,
                placeholder: knownPh || "",
              };
            };

            const getRegion = (el, inModal) => {
              if (inModal) return "modal";
              if (closestAcrossShadow(el, 'header, [role="banner"]')) return "header";
              if (closestAcrossShadow(el, 'footer, [role="contentinfo"]')) return "footer";
              if (closestAcrossShadow(el, 'nav, [role="navigation"], [class*="sidebar"]')) return "nav";
              if (closestAcrossShadow(el, 'aside, [role="complementary"]')) return "aside";
              return "main";
            };

            const sectionContainerSelector = 'fieldset, form, section, [class*="card"], [class*="panel"]';
            const isSubPartOrGridSection = (cand) => {
              if (cand.tagName === "FIELDSET" || cand.tagName === "FORM" || cand.tagName === "SECTION") {
                return false;
              }
              const cls = typeof cand.className === "string" ? cand.className.toLowerCase() : "";
              if (!cls) return false;
              return /(?:^|[\s_-])(header|footer|body|actions|title|meta|icon|badge|cards|panels|list|grid|wrapper|container)(?:$|[\s_-])/i.test(
                cls
              );
            };

            const getHeadingTextForSection = (sectionEl, el) => {
              if (sectionEl.tagName === "FIELDSET") {
                const legends = sectionEl.querySelectorAll("legend");
                for (const lg of legends) {
                  if (!isVisible(lg) || lg.contains(el)) continue;
                  if (lg.closest("fieldset") !== sectionEl) continue;
                  const t = extractLabelNodeText(lg, el, 100);
                  if (t) return t;
                }
                return "";
              }

              const headingCandidates = sectionEl.querySelectorAll(
                "h1, h2, h3, h4, .section-title, .panel-title, .card-title, .card-header, .panel-heading"
              );
              for (const h of headingCandidates) {
                if (!isVisible(h) || h.contains(el)) continue;
                let owner = getParentOrHost(h);
                let belongsToSection = false;
                while (owner && owner !== document.body && owner !== document.documentElement) {
                  if (owner === sectionEl) {
                    belongsToSection = true;
                    break;
                  }
                  if (
                    (matchesAny(owner, sectionContainerSelector) && !isSubPartOrGridSection(owner)) ||
                    matchesAny(owner, 'tr, [role="row"], article, li')
                  ) {
                    break;
                  }
                  owner = getParentOrHost(owner);
                }
                if (!belongsToSection) continue;

                const innerHeading = matchesAny(h, ".card-header, .panel-heading")
                  ? h.querySelector?.("h1, h2, h3, h4, .section-title, .panel-title, .card-title")
                  : null;
                const rawHeading = extractLabelNodeText(innerHeading || h, el, 100);
                if (rawHeading) return rawHeading;
              }
              return "";
            };

            const getSectionAnchor = (el, ctx) => {
              const forbidden = new Set(
                [ctx.containerAnchor, ctx.label, ctx.cleanLabel, ctx.groupLabel, ctx.text]
                  .map((v) => norm(v))
                  .filter(Boolean)
              );
              let cur = getParentOrHost(el);
              let depth = 0;
              while (cur && cur !== document.body && cur !== document.documentElement && depth < 14) {
                if (ctx.inModal && activeTopModal && cur === getParentOrHost(activeTopModal.el)) {
                  break;
                }
                if (matchesAny(cur, sectionContainerSelector) && !isSubPartOrGridSection(cur)) {
                  const rawHeading = getHeadingTextForSection(cur, el);
                  if (rawHeading) {
                    const cleaned = cleanSemanticLabel(rawHeading, 100);
                    if (cleaned && cleaned.length <= 70 && !forbidden.has(norm(cleaned))) {
                      return cleaned;
                    }
                  }
                }
                cur = getParentOrHost(cur);
                depth++;
              }
              return "";
            };

            const extractIconInfo = (el) => {
              const iconNode = el.querySelector?.(
                'svg, i[class], span[class*="icon"], span[class*="fa-"], [class*="lucide"], .material-icons, .glyphicon'
              );
              const selfCls =
                typeof el.className === "string" ? el.className : el.getAttribute?.("class") || "";
              const selfMeta = `${selfCls} ${el.id || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("title") || ""}`.toLowerCase();

              if (!iconNode && !el.matches?.('svg, i[class], [class*="icon"]')) {
                // Vẫn nhận diện các nút đóng chỉ có class/ký tự × (như .btn-close, .modal-close)
                if (/(?:^|[\s_-])(close|dismiss|cancel|btn-close|modal-close)(?:$|[\s_-])/i.test(selfMeta)) {
                  return { hasIcon: true, iconHint: "close-x" };
                }
                return { hasIcon: false, iconHint: "" };
              }
              const target = iconNode || el;
              const explicitIcon =
                target.getAttribute?.("data-icon") ||
                target.getAttribute?.("data-lucide") ||
                target.getAttribute?.("aria-label") ||
                "";
              if (explicitIcon) return { hasIcon: true, iconHint: clean(explicitIcon, 40) };

              const cls =
                typeof target.className === "string"
                  ? target.className
                  : target.getAttribute?.("class") || "";
              const matText = cls.includes("material-icons") ? clean(target.textContent, 30) : "";
              if (matText) return { hasIcon: true, iconHint: matText };

              const matchIconCls = `${cls} ${selfCls}`.match(
                /(?:lucide-|fa-|icon-|glyphicon-|bi-)([a-z0-9-]+)/i
              );
              if (matchIconCls?.[1]) {
                return { hasIcon: true, iconHint: matchIconCls[1] };
              }

              // Nhận diện ngữ nghĩa nút đóng 'X' từ class/id của phần tử cha hoặc hình học 2 nét chéo của <svg>
              const combinedMeta = `${cls} ${selfMeta}`.toLowerCase();
              if (/(close|dismiss|cancel|times|xmark|remove-modal)/i.test(combinedMeta)) {
                return { hasIcon: true, iconHint: "close-x" };
              }
              if (target.tagName.toLowerCase() === "svg") {
                const lines = target.querySelectorAll?.("line") || [];
                if (lines.length === 2) {
                  return { hasIcon: true, iconHint: "close-x" };
                }
                // Hoặc <svg> nhỏ không có chữ nằm ở góc phải trên cùng của Modal
                if (activeTopModal && isInsideContainer(el, activeTopModal.el)) {
                  const mRect = activeTopModal.el.getBoundingClientRect();
                  const eRect = el.getBoundingClientRect();
                  if (
                    eRect.width <= 52 &&
                    eRect.height <= 52 &&
                    eRect.top <= mRect.top + 80 &&
                    eRect.right >= mRect.right - 90
                  ) {
                    return { hasIcon: true, iconHint: "close-x" };
                  }
                }
              }
              return { hasIcon: true, iconHint: target.tagName.toLowerCase() === "svg" ? "svg" : "icon" };
            };

            // ─── BƯỚC 4: THU THẬP & PHÂN LOẠI PHẦN TỬ TƯƠNG TÁC (CẢ LIGHT DOM & SHADOW DOM) ───
            const primaryInteractiveSelector = [
              "button",
              "a[href]",
              "input:not([type='hidden'])",
              "select",
              "textarea",
              "summary",
              "[role='button']",
              "[role='link']",
              "[role='menuitem']",
              "[role='option']",
              "[role='tab']",
              "[role='checkbox']",
              "[role='radio']",
              "[role='switch']",
              "[role='combobox']",
              "[role='slider']",
              "[aria-haspopup='listbox']",
              ".ant-select",
              ".ant-select-selector",
              ".MuiSelect-select",
              "[class*='select-trigger']",
              "[contenteditable='true']",
              "[onclick]",
            ].join(", ");

            const pointerClickableSelector = [
              "div",
              "span",
              "li",
              "td",
              "img",
              "svg",
              "i",
              "[tabindex]:not([tabindex='-1'])",
              "[class*='btn']",
              "[class*='close']",
              "[class*='tab']",
              "[class*='option']",
              "[class*='select']",
              "[class*='dropdown']",
              "[class*='menu-item']",
            ].join(", ");

            const interactiveNodes = [];
            for (const el of allDomElements) {
              if (!isVisible(el)) continue;

              const isPrimary = matchesAny(el, primaryInteractiveSelector);
              let accepted = isPrimary;

              // Tránh nhân bản wrapper .ant-select ngoài khi bên trong đã có trigger (.ant-select-selector / combobox / select)
              if (
                accepted &&
                matchesAny(el, ".ant-select") &&
                !matchesAny(el, ".ant-select-selector, [role='combobox'], [aria-haspopup='listbox'], [onclick]")
              ) {
                const innerTrigger = el.querySelector?.(
                  ".ant-select-selector, [role='combobox'], [aria-haspopup='listbox'], select"
                );
                if (innerTrigger && isVisible(innerTrigger)) {
                  accepted = false;
                }
              }

              if (!accepted && matchesAny(el, pointerClickableSelector)) {
                const st = window.getComputedStyle(el);
                const isFocusableImg =
                  el.tagName === "IMG" && matchesAny(el, "[tabindex]:not([tabindex='-1'])");
                if (st.cursor === "pointer" || isFocusableImg) {
                  // Không nhân bản các thẻ span/icon/img trang trí nằm bên trong <button>/<a> đã được đánh số
                  const insidePrimaryParent = Boolean(
                    !el.matches("[role], [onclick], [tabindex]") &&
                    el.closest("button, a[href], [role='button'], [role='menuitem'], [role='option'], label")
                  );
                  const isRedundantSelectWrap =
                    matchesAny(el, ".ant-select") &&
                    !matchesAny(el, ".ant-select-selector") &&
                    Boolean(
                      el.querySelector?.(".ant-select-selector, [role='combobox'], [aria-haspopup='listbox'], select")
                    );
                  if (!insidePrimaryParent && !isRedundantSelectWrap && el.children.length <= 6) {
                    const txt = clean(el.innerText || el.textContent, 80);
                    const hasAccessibleMeta = Boolean(
                      el.getAttribute("aria-label") ||
                      el.getAttribute("aria-labelledby") ||
                      el.getAttribute("alt") ||
                      el.getAttribute("title") ||
                      el.getAttribute("data-testid") ||
                      el.getAttribute("data-test")
                    );
                    const { hasIcon } = extractIconInfo(el);
                    const rect = el.getBoundingClientRect();
                    const isIconSized = rect.width <= 200 && rect.height <= 140;

                    if (txt.length > 0 || hasAccessibleMeta || (hasIcon && isIconSized)) {
                      accepted = true;
                    }
                  }
                }
              }

              if (accepted) {
                interactiveNodes.push(el);
              }
            }

            // Phân tách phần tử trong Modal/Popup nổi (ưu tiên đứng đầu!) vs phần tử nền phía dưới
            let orderedEntries = [];
            if (activeTopModal) {
              const modalEntries = [];
              const backgroundEntries = [];
              for (const el of interactiveNodes) {
                const inModal =
                  isInsideContainer(el, activeTopModal.el) || isInFloatingOverlay(el);
                if (inModal) {
                  modalEntries.push({ el, inModal: true });
                } else if (!activeTopModal.blocking) {
                  backgroundEntries.push({ el, inModal: false });
                }
              }
              orderedEntries = [...modalEntries, ...backgroundEntries];
            } else {
              orderedEntries = interactiveNodes.map((el) => ({ el, inModal: false }));
            }

            let currentId = startId;
            const elements = [];

            for (const entry of orderedEntries) {
              const el = entry.el;
              const tag = el.tagName.toLowerCase();
              const type = (el.getAttribute("type") || "").toLowerCase();
              const role = (el.getAttribute("role") || "").toLowerCase();
              const elemId = el.id || "";
              const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || "";
              const name = el.getAttribute("name") || "";
              const alt = clean(
                el.getAttribute("alt") || el.querySelector?.("img[alt]")?.getAttribute("alt") || "",
                80
              );
              let placeholder = clean(
                el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || "",
                80
              );
              const titleAttr = clean(el.getAttribute("title"), 80);
              const isCombobox = isCustomCombobox(el);
              const isChoice = isChoiceControl(el);
              const isStdForm = isStandardFormControl(el);
              const label = getElementLabel(el);
              const { hasIcon, iconHint } = extractIconInfo(el);

              let text = "";
              let value = "";
              let options = [];

              if (isCombobox) {
                // Custom Combobox: tuyệt đối không đổ giá trị đang chọn vào text; tách rạch ròi sang value / placeholder
                text = "";
                const comboState = extractCustomComboboxState(el);
                value = comboState.value;
                placeholder = comboState.placeholder || placeholder;
              } else if (tag === "input" && (type === "button" || type === "submit" || type === "reset")) {
                text = clean(el.value, 80);
                value = clean(el.value, 80);
              } else if (tag === "select") {
                const selectedOpt = el.options?.[el.selectedIndex];
                value = selectedOpt ? clean(selectedOpt.text || selectedOpt.value, 60) : clean(el.value, 60);
                options = Array.from(el.options || [])
                  .slice(0, 25)
                  .map((o) => clean(o.text || o.value, 50))
                  .filter(Boolean);
              } else if (tag === "input" || tag === "textarea") {
                if (type !== "password") {
                  value = clean(el.value, 80);
                } else {
                  value = el.value ? "******" : "";
                }
              } else if (el.getAttribute("contenteditable") === "true") {
                text = clean(el.innerText || el.textContent, 90);
                value = clean(el.innerText || el.textContent, 80);
              } else {
                text = clean(el.innerText || el.textContent, 90);
              }

              // Tính cleanLabel chuẩn W3C:
              // - Form controls (bao gồm choice & custom combobox): cleanSemanticLabel(label)
              // - Nút / Liên kết / Trigger có bộ đếm badge động ở cuối: cắt hậu tố số nhưng giữ nguyên text gốc
              let cleanLabel = "";
              if (isChoice || isStdForm) {
                cleanLabel = cleanSemanticLabel(label, 80);
              } else if (label) {
                const baseFromLabel = isButtonOrLinkLike(tag, type, role)
                  ? stripTrailingBadge(label, el)
                  : label;
                cleanLabel = cleanSemanticLabel(baseFromLabel, 80);
              } else if (text) {
                const strippedText = stripTrailingBadge(text, el);
                if (strippedText && strippedText !== text) {
                  cleanLabel = strippedText;
                }
              }

              const groupLabel = getGroupLabel(el, label, cleanLabel);

              const checked = isChoice
                ? Boolean(el.checked || el.getAttribute("aria-checked") === "true")
                : undefined;

              const disabled = Boolean(el.disabled || el.getAttribute("aria-disabled") === "true");
              const { anchor: containerAnchor, fullRowText: containerText } = getContainerContext(el);
              const region = getRegion(el, entry.inModal);
              const sectionAnchor = getSectionAnchor(el, {
                inModal: entry.inModal,
                containerAnchor,
                label,
                cleanLabel,
                groupLabel,
                text,
              });

              const hasIdentity = Boolean(
                text ||
                label ||
                cleanLabel ||
                alt ||
                titleAttr ||
                iconHint ||
                placeholder ||
                elemId ||
                name ||
                testId ||
                isCombobox ||
                isChoice ||
                tag === "input" ||
                tag === "select" ||
                tag === "textarea"
              );
              if (!hasIdentity) continue;

              const assignedId = currentId++;
              el.setAttribute("data-at-id", String(assignedId));

              elements.push({
                id: assignedId,
                frameIndex: fIdx,
                inModal: entry.inModal,
                inShadowDom: el.getRootNode?.() instanceof ShadowRoot,
                tag,
                type,
                role,
                elemId,
                testId,
                name,
                alt,
                label,
                cleanLabel,
                groupLabel,
                title: titleAttr && titleAttr !== label && titleAttr !== text ? titleAttr : "",
                iconHint: hasIcon ? iconHint : "",
                placeholder,
                text,
                value,
                checked,
                disabled,
                options: options.length > 0 ? options : undefined,
                containerAnchor,
                containerText,
                region,
                sectionAnchor,
                occurrenceIndex: 0,
                occurrenceTotal: 1,
              });

              if (elements.length >= MAX_ELEMENTS) break;
            }

            // Tính chỉ số xuất hiện thực tế (occurrenceIndex / occurrenceTotal) theo khóa phạm vi + định danh chuẩn
            const occurrenceGroups = new Map();
            for (const item of elements) {
              const identityKey = norm(
                item.cleanLabel || item.label || item.text || item.alt || item.placeholder || item.iconHint
              );
              const scopeKey = `${item.inModal ? "M" : "P"}|${norm(item.containerAnchor)}|${item.tag}|${item.type}|${item.role}|${identityKey}`;
              if (!occurrenceGroups.has(scopeKey)) {
                occurrenceGroups.set(scopeKey, []);
              }
              occurrenceGroups.get(scopeKey).push(item);
            }
            for (const group of occurrenceGroups.values()) {
              const total = group.length;
              for (let i = 0; i < total; i++) {
                group[i].occurrenceIndex = i;
                group[i].occurrenceTotal = total;
              }
            }

            // ─── BƯỚC 5: THU THẬP THÔNG BÁO & VĂN BẢN HIỂN THỊ (ƯU TIÊN MODAL + XUYÊN SHADOW DOM) ───
            const noticeSelectors = [
              "[role='alert']",
              "[role='status']",
              ".alert",
              ".toast",
              "[class*='toast']",
              "[class*='notification']",
              "[class*='message']",
              "[class*='error']",
              "[class*='success']",
              "[class*='modal'] h1, [class*='modal'] h2, [class*='modal'] h3, [class*='modal-title']",
              "[id*='alert'], [id*='toast'], [id*='msg'], [id*='status'], [id*='result'], [id*='order'], [id*='total']",
            ].join(", ");

            const notices = [];
            const modalNoticeNodes = [];
            const bgNoticeNodes = [];
            for (const el of allDomElements) {
              if (!matchesAny(el, noticeSelectors)) continue;
              if (!isVisible(el)) continue;
              if (activeTopModal && isInsideContainer(el, activeTopModal.el)) {
                modalNoticeNodes.push(el);
              } else {
                bgNoticeNodes.push(el);
              }
            }
            for (const nEl of [...modalNoticeNodes, ...bgNoticeNodes]) {
              const t = clean(nEl.innerText || nEl.textContent, 150);
              if (t && !notices.includes(t)) {
                notices.push(t);
              }
            }

            const blockSelector =
              "h1, h2, h3, h4, .info-box, .card-title, tr, [class*='summary'], [class*='total'], [class*='price'], [class*='code'], [class*='badge'], p";
            const textBlocks = [];
            const modalTextNodes = [];
            const bgTextNodes = [];
            for (const el of allDomElements) {
              if (!matchesAny(el, blockSelector)) continue;
              if (!isVisible(el)) continue;
              if (activeTopModal && isInsideContainer(el, activeTopModal.el)) {
                modalTextNodes.push(el);
              } else if (!activeTopModal?.blocking) {
                bgTextNodes.push(el);
              }
            }
            for (const bNode of [...modalTextNodes, ...bgTextNodes]) {
              const txt = clean(bNode.innerText || bNode.textContent, 140);
              if (txt && txt.length >= 2 && !textBlocks.includes(txt)) {
                textBlocks.push(txt);
                if (textBlocks.length >= 45) break;
              }
            }

            return {
              nextId: currentId,
              modalInfo,
              elements,
              notices,
              textBlocks,
            };
          },
          {
            startId: nextId,
            fIdx: frameIndex,
            tier1Selectors: CONTAINER_TIER1_SELECTORS,
            tier2Selectors: CONTAINER_TIER2_SELECTORS,
          }
        );

        nextId = frameResult.nextId;
        if (frameResult.modalInfo && !activeModal) {
          activeModal = { ...frameResult.modalInfo, frameIndex };
        }
        for (const el of frameResult.elements) {
          el.frameName = frame.name() || "";
          el.frameUrl = frameIndex === 0 ? "" : frame.url();
          allElements.push(el);
          elementMap.set(el.id, el);
        }
        for (const n of frameResult.notices) {
          if (!allNotices.includes(n)) allNotices.push(n);
        }
        for (const tb of frameResult.textBlocks) {
          if (!allTextBlocks.includes(tb)) allTextBlocks.push(tb);
        }
      } catch (frameErr) {
        logger.debug(`Bỏ qua lỗi quét frame [${frameIndex}]: ${frameErr.message}`);
      }
    }

    return {
      url,
      title,
      activeModal,
      elements: allElements,
      elementMap,
      visibleNotices: allNotices,
      pageTextBlocks: allTextBlocks,
    };
  }

  /**
   * Chuyển đổi kết quả quét sang định dạng văn bản cô đọng cho LLM (Qwen 3.8-27B / Gemini / OpenAI)
   */
  formatSnapshotForLlm(snapshot, session = {}) {
    const lines = [];
    lines.push(`=== TRẠNG THÁI TRÌNH DUYỆT HIỆN TẠI ===`);
    lines.push(`URL: ${snapshot.url}`);
    lines.push(`Tiêu đề trang: ${snapshot.title}`);

    // Thông tin Tabs nếu có nhiều hơn 1 tab
    const pagesCount = session.pagesCount || 1;
    if (pagesCount > 1) {
      let activeTabIdx = -1;
      if (session.context && session.currentPage) {
        const allPages = session.context.pages().filter((p) => p && !p.isClosed());
        activeTabIdx = allPages.indexOf(session.currentPage);
      }
      const tabPositionStr =
        activeTabIdx >= 0
          ? `Đang đứng ở Tab #${activeTabIdx + 1}/${pagesCount}${activeTabIdx === 0
            ? " [Tab gốc/đầu tiên]"
            : activeTabIdx === pagesCount - 1
              ? " [Tab mới nhất/cuối cùng]"
              : ""
          }`
          : "Đang đứng ở Tab hiện tại";
      lines.push(`Số Tab đang mở: ${pagesCount} (${tabPositionStr})`);
    }

    // Cảnh báo Modal / Hộp thoại nổi đang mở (để AI ưu tiên thao tác bên trong Modal)
    if (snapshot.activeModal) {
      lines.push(
        `\n[MODAL ĐANG MỞ]: "${snapshot.activeModal.title}"${snapshot.activeModal.blocking
          ? " (Đã cô lập lớp nổi — các phần tử bên dưới đã được ưu tiên quét trước)"
          : " (Các phần tử trong lớp nổi được ưu tiên đánh số đầu tiên)"
        }`
      );
    }

    // Thông tin Hộp thoại Native (Alert / Confirm / Prompt) phát sinh trong bước hiện tại hoặc ngay bước liền trước
    const scopedDialogs =
      Array.isArray(session.currentStepDialogs) && session.currentStepDialogs.length > 0
        ? session.currentStepDialogs
        : Array.isArray(session.prevStepDialogs)
          ? session.prevStepDialogs
          : [];
    if (scopedDialogs.length > 0) {
      lines.push(`\n[HỘP THOẠI NATIVE ĐÃ GHI NHẬN TRONG BƯỚC NÀY]:`);
      scopedDialogs.slice(-3).forEach((d) => {
        lines.push(`- [${d.type.toUpperCase()}] "${d.message}" (Đã xử lý: ${d.handledAs})`);
      });
    }

    // Thông tin Tệp đã tải về phát sinh trong bước hiện tại hoặc ngay bước liền trước
    const scopedDownloads =
      Array.isArray(session.currentStepDownloads) && session.currentStepDownloads.length > 0
        ? session.currentStepDownloads
        : Array.isArray(session.prevStepDownloads)
          ? session.prevStepDownloads
          : [];
    if (scopedDownloads.length > 0) {
      lines.push(`\n[TỆP ĐÃ TẢI VỀ THÀNH CÔNG TRONG BƯỚC NÀY]:`);
      scopedDownloads.forEach((f) => {
        lines.push(`- Tên tệp: "${f.filename}"`);
      });
    }

    // Thông tin Kho Biến Kịch Bản (vars) — ẩn giá trị thực nếu là biến bí mật (isSecret)
    const varsEntries = Object.entries(session.vars || {});
    if (varsEntries.length > 0) {
      lines.push(`\n[KHO BIẾN KỊCH BẢN (vars)]:`);
      for (const [k, v] of varsEntries) {
        const isSecret = session.secretKeys instanceof Set && session.secretKeys.has(k);
        if (isSecret) {
          lines.push(`- {{${k}}} = "[BIẾN BÍ MẬT — điền đúng {{${k}}} vào trường value, KHÔNG tự bịa giá trị]"`);
        } else {
          lines.push(`- {{${k}}} = "${v}"`);
        }
      }
    }

    // Thông báo nổi (Toast / Alert / Status)
    if (snapshot.visibleNotices.length > 0) {
      lines.push(`\n[THÔNG BÁO / TRẠNG THÁI NỔI BẬT TRÊN MÀN HÌNH]:`);
      snapshot.visibleNotices.slice(0, 12).forEach((n) => {
        lines.push(`* ${n}`);
      });
    }

    // Nội dung văn bản tóm tắt trên trang
    if (snapshot.pageTextBlocks.length > 0) {
      lines.push(`\n[NỘI DUNG CHỮ & DỮ LIỆU HIỂN THỊ TRÊN MÀN HÌNH]:`);
      snapshot.pageTextBlocks.slice(0, 30).forEach((tb) => {
        lines.push(`| ${tb}`);
      });
    }

    // Danh sách phần tử tương tác đánh số [1]..[N]
    lines.push(`\n[DANH SÁCH PHẦN TỬ TƯƠNG TÁC ĐÁNH SỐ]:`);
    if (snapshot.elements.length === 0) {
      lines.push(`(Không có phần tử tương tác nào đang hiển thị)`);
    } else {
      for (const el of snapshot.elements) {
        const parts = [`[${el.id}]`];
        if (el.inModal) {
          parts.push(`[TRONG MODAL]`);
        } else if (el.region === "header") {
          parts.push(`[HEADER]`);
        } else if (el.region === "nav") {
          parts.push(`[SIDEBAR]`);
        } else if (el.region === "footer") {
          parts.push(`[FOOTER]`);
        }
        if (el.frameIndex > 0) {
          parts.push(`(Iframe #${el.frameIndex})`);
        }
        if (el.inShadowDom) {
          parts.push(`(ShadowDOM)`);
        }
        parts.push(`<${el.tag}${el.type ? ` type="${el.type}"` : ""}${el.role ? ` role="${el.role}"` : ""}>`);

        const displayLabel = el.cleanLabel || el.label;
        if (el.text) parts.push(`text="${el.text}"`);
        if (displayLabel && displayLabel !== el.text) parts.push(`label="${displayLabel}"`);
        if (el.groupLabel) parts.push(`group="${el.groupLabel}"`);
        if (el.alt) parts.push(`alt="${el.alt}"`);
        if (el.name) parts.push(`name="${el.name}"`);
        if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
        if (el.title) parts.push(`title="${el.title}"`);
        if (el.iconHint) parts.push(`icon="${el.iconHint}"`);
        if (el.testId) parts.push(`testid="${el.testId}"`);
        if (el.elemId) parts.push(`id="#${el.elemId}"`);
        if (el.value !== undefined && el.value !== "") parts.push(`value="${el.value}"`);
        if (el.checked !== undefined) parts.push(`checked=${el.checked}`);
        if (el.disabled) parts.push(`[DISABLED]`);
        if (el.options && el.options.length > 0) {
          parts.push(`options=[${el.options.map((o) => `"${o}"`).join(", ")}]`);
        }
        if (Number.isInteger(el.occurrenceTotal) && el.occurrenceTotal > 1) {
          const occIdx =
            Number.isInteger(el.occurrenceIndex) && el.occurrenceIndex >= 0 ? el.occurrenceIndex : 0;
          parts.push(`(#${occIdx + 1}/${el.occurrenceTotal})`);
        }
        if (el.containerAnchor && el.containerAnchor !== el.text) {
          parts.push(`(Thuộc dòng/khung: "${el.containerAnchor}")`);
        }
        if (
          el.sectionAnchor &&
          el.sectionAnchor !== el.containerAnchor &&
          el.sectionAnchor !== el.groupLabel
        ) {
          parts.push(`(Khối: "${el.sectionAnchor}")`);
        }

        lines.push(parts.join(" "));
      }
    }

    return lines.join("\n");
  }
}

export const domInspectorService = new DomInspectorService();

