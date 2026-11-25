import { logger } from "../../utils/logger.js";

/**
 * KHỐI TỰ CHỮA LÀNH VẬT CẢN GIAO DIỆN (SELF-HEALING OBSTRUCTION RESOLVER)
 * - Phát hiện chính xác phần tử đang vật lý che khuất mục tiêu bằng `elementsFromPoint(cx, cy)`.
 * - Phân loại vật cản thành 5 nhóm:
 *   1. `toast`: Thông báo nổi/Snackbar (kể cả khi chồng 20 thông báo) -> Cho phép thao tác xuyên qua (giữ nguyên hiển thị cho Assert & Ảnh chụp).
 *   2. `dropdown_popover`: Bảng chọn nổi / DIV giả checkbox không tự đóng -> Thử Escape, nếu không đóng tự tìm tọa độ trống an toàn ngoài vật cản để Click Outside.
 *   3. `modal`: Hộp thoại/Banner bất ngờ KHÔNG chứa phần tử mục tiêu -> Tự tìm nút đóng (SVG 'x', Close, Cancel, Đóng, Hủy, Bỏ qua) để dập tắt.
 *   4. `sticky_bar` / `offscreen`: Thanh điều hướng cố định che mép -> Cuộn phần tử mục tiêu vào chính giữa màn hình.
 *   5. `hard_overlap`: Lỗi vỡ CSS cứng không thể gỡ -> Báo về cho tầng gọi kích hoạt Fallback có kèm Cảnh báo UX (tránh False Positive).
 */
export class ObstructionResolverService {
  /**
   * Kiểm tra nhanh (< 5ms) xem phần tử mục tiêu có đang bị vật cản khác che khuất tọa độ tâm hay không
   */
  async inspectObstruction(locator) {
    try {
      return await locator.evaluate((el) => {
        const doc = el.ownerDocument;
        const win = doc.defaultView || window;
        if (!el || !el.isConnected) {
          return { obstructed: false, reason: "disconnected" };
        }

        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) {
          return { obstructed: false, reason: "zero_rect" };
        }

        const vw = win.innerWidth || doc.documentElement.clientWidth || 1280;
        const vh = win.innerHeight || doc.documentElement.clientHeight || 800;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        // Nằm ngoài khung nhìn hiện tại -> cần cuộn vào giữa
        if (cx < 2 || cy < 2 || cx > vw - 2 || cy > vh - 2) {
          return {
            obstructed: true,
            type: "offscreen",
            blockerDesc: "ngoài vùng hiển thị (viewport)",
            blockerRect: null,
          };
        }

        // Thu thập chuỗi phần tử tại tọa độ tâm (xuyên cả Open Shadow DOM nếu có)
        const getDeepHits = (root, x, y) => {
          const hits = Array.from(root.elementsFromPoint ? root.elementsFromPoint(x, y) : []);
          if (hits.length > 0 && hits[0]?.shadowRoot?.elementsFromPoint) {
            const inner = getDeepHits(hits[0].shadowRoot, x, y);
            return [...inner, ...hits];
          }
          return hits;
        };

        const hits = getDeepHits(doc, cx, cy);
        if (hits.length === 0) {
          return { obstructed: false, reason: "no_hits" };
        }

        const isSameControl = (cand) => {
          if (!cand) return false;
          if (cand === el || el.contains(cand)) return true;
          // Thẻ <label> bao bọc hoặc trỏ for="..." tới input, hoặc anh em trang trí trong cùng <label>
          const elLabel = el.closest?.("label");
          const candLabel = cand.closest?.("label");
          if (elLabel && candLabel && elLabel === candLabel) return true;
          if (el.id && candLabel && candLabel.getAttribute("for") === el.id) return true;
          if (cand.tagName === "LABEL" && (cand.contains(el) || (el.id && cand.getAttribute("for") === el.id))) {
            return true;
          }
          // Nút <button> / <a> bọc trực tiếp phần tử con bên trong
          if (cand.contains(el) && cand.matches?.("button, a, [role='button'], [role='checkbox'], [role='radio']")) {
            return true;
          }
          return false;
        };

        const topHit = hits[0];
        if (isSameControl(topHit)) {
          return { obstructed: false, reason: "clear" };
        }

        // Tìm toàn bộ phần tử nằm phía trên phần tử mục tiêu
        const blockingHits = [];
        for (const h of hits) {
          if (isSameControl(h) || h.contains(el)) break;
          blockingHits.push(h);
        }
        if (blockingHits.length === 0) {
          return { obstructed: false, reason: "ancestor_only" };
        }

        const describeEl = (node) => {
          if (!node) return "unknown";
          const tag = (node.tagName || "").toLowerCase();
          const id = node.id ? `#${node.id}` : "";
          const cls =
            typeof node.className === "string" && node.className.trim()
              ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".")
              : "";
          return `<${tag}${id}${cls}>`;
        };

        const getClsStr = (node) => {
          if (!node) return "";
          const cls = typeof node.className === "string" ? node.className : node.getAttribute?.("class") || "";
          const id = node.id || "";
          return `${cls} ${id}`.toLowerCase();
        };

        const isToastNode = (node) => {
          if (!node || node === doc.body || node === doc.documentElement) return false;
          const role = (node.getAttribute?.("role") || "").toLowerCase();
          const clsId = getClsStr(node);
          if (role === "status") return true;
          if (
            /(?:^|[\s_-])(toast|toastify|snackbar|notistack|sonner|ant-message|ant-notification|el-message|el-notification|vue-notification|swal2-toast|flash-message|floating-alert|notif-toast|toast-item|toast-msg)(?:$|[\s_-])/i.test(
              clsId
            )
          ) {
            return true;
          }
          if (role === "alert" && !/(dialog|modal)/i.test(clsId)) {
            const st = win.getComputedStyle(node);
            if (st.position === "fixed" || st.position === "absolute") return true;
            // Kiểm tra cha gần nhất có phải container cố định không
            let p = node.parentElement;
            for (let d = 0; p && d < 4; d++, p = p.parentElement) {
              const pst = win.getComputedStyle(p);
              if (pst.position === "fixed" || pst.position === "absolute") return true;
            }
          }
          return false;
        };

        const isStickyBarNode = (node) => {
          if (!node || node === doc.body || node === doc.documentElement) return false;
          const st = win.getComputedStyle(node);
          if (st.position !== "fixed" && st.position !== "sticky") return false;
          const r = node.getBoundingClientRect();
          const role = (node.getAttribute?.("role") || "").toLowerCase();
          const tag = (node.tagName || "").toLowerCase();
          const touchesTopOrBottom = r.top <= 12 || r.bottom >= vh - 12;
          if (
            (tag === "header" || tag === "nav" || tag === "footer" || role === "banner" || role === "navigation" || role === "contentinfo") &&
            r.height <= 200
          ) {
            return true;
          }
          if (touchesTopOrBottom && r.width >= vw * 0.5 && r.height <= 160) {
            return true;
          }
          return false;
        };

        const isModalNode = (node) => {
          if (!node || node === doc.body || node === doc.documentElement) return false;
          const role = (node.getAttribute?.("role") || "").toLowerCase();
          const clsId = getClsStr(node);
          if (
            node.tagName === "DIALOG" ||
            role === "dialog" ||
            role === "alertdialog" ||
            node.getAttribute?.("aria-modal") === "true"
          ) {
            return true;
          }
          if (
            /(?:^|[\s_-])(modal|modal-wrap|modal-mask|modal-backdrop|modal-overlay|dialog|backdrop|swal2-container|swal2-popup|cookie-banner|cookie-consent|consent-banner|promo-popup|ant-modal|mui-dialog|muidialog|muibackdrop)(?:$|[\s_-])/i.test(
              clsId
            )
          ) {
            return true;
          }
          // Lớp phủ toàn màn hình (fixed covering >= 70% viewport)
          const st = win.getComputedStyle(node);
          if (st.position === "fixed") {
            const r = node.getBoundingClientRect();
            if (r.width >= vw * 0.7 && r.height >= vh * 0.7) return true;
          }
          return false;
        };

        const isDropdownOrPopoverNode = (node) => {
          if (!node || node === doc.body || node === doc.documentElement) return false;
          const role = (node.getAttribute?.("role") || "").toLowerCase();
          const clsId = getClsStr(node);
          if (role === "listbox" || role === "menu" || role === "tooltip" || role === "tree") return true;
          if (
            /(?:^|[\s_-])(dropdown|popover|popper|menu|select-dropdown|select-list|options|option-list|picker|datepicker|calendar|autocomplete|tooltip|overlay|panel|checkbox-list|multi-select|multiselect|popup)(?:$|[\s_-])/i.test(
              clsId
            )
          ) {
            return true;
          }
          const st = win.getComputedStyle(node);
          const z = parseInt(st.zIndex, 10);
          if ((st.position === "absolute" || st.position === "fixed") && Number.isFinite(z) && z >= 2) {
            return true;
          }
          return false;
        };

        // Bước 1: Kiểm tra xem vật cản hàng đầu có phải là Toast / Thông báo nổi không
        // (Ưu tiên nhận diện Toast trước để xử lý luôn cả chồng 20 toast cùng lúc!)
        for (const h of blockingHits) {
          let cur = h;
          let depth = 0;
          while (cur && cur !== doc.body && cur !== doc.documentElement && !cur.contains(el) && depth < 8) {
            if (isToastNode(cur)) {
              const r = cur.getBoundingClientRect();
              return {
                obstructed: true,
                type: "toast",
                blockerDesc: describeEl(cur),
                blockerRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
              };
            }
            cur = cur.parentElement;
            depth++;
          }
        }

        // Bước 2: Leo lên từ phần tử đầu tiên (topHit) để tìm gốc của vật cản (không chứa el)
        let stickyMatch = null;
        let modalMatch = null;
        let dropdownMatch = null;
        let cur = topHit;
        let depth = 0;

        while (cur && cur !== doc.body && cur !== doc.documentElement && !cur.contains(el) && depth < 15) {
          if (!stickyMatch && isStickyBarNode(cur)) stickyMatch = cur;
          if (!modalMatch && isModalNode(cur)) modalMatch = cur;
          if (!dropdownMatch && isDropdownOrPopoverNode(cur)) dropdownMatch = cur;
          cur = cur.parentElement;
          depth++;
        }

        // Ưu tiên phân loại theo độ đặc trưng: StickyBar -> Modal -> Dropdown/Popover -> HardOverlap
        if (stickyMatch && !modalMatch) {
          const r = stickyMatch.getBoundingClientRect();
          return {
            obstructed: true,
            type: "sticky_bar",
            blockerDesc: describeEl(stickyMatch),
            blockerRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          };
        }

        // Nếu vừa khớp dropdown vừa khớp modal, kiểm tra kích thước & thuộc tính modal thực sự
        if (modalMatch) {
          const mRole = (modalMatch.getAttribute?.("role") || "").toLowerCase();
          const mCls = getClsStr(modalMatch);
          const isExplicitModal =
            modalMatch.tagName === "DIALOG" ||
            mRole === "dialog" ||
            mRole === "alertdialog" ||
            modalMatch.getAttribute?.("aria-modal") === "true" ||
            /(modal|dialog|backdrop|swal2|cookie|consent)/i.test(mCls);

          if (isExplicitModal || !dropdownMatch) {
            const r = modalMatch.getBoundingClientRect();
            return {
              obstructed: true,
              type: "modal",
              blockerDesc: describeEl(modalMatch),
              blockerRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
            };
          }
        }

        if (dropdownMatch) {
          const r = dropdownMatch.getBoundingClientRect();
          return {
            obstructed: true,
            type: "dropdown_popover",
            blockerDesc: describeEl(dropdownMatch),
            blockerRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          };
        }

        // Trường hợp còn lại: một phần tử tĩnh/nổi nào đó không có tên class rõ ràng vẫn đang đè lên
        const r = topHit.getBoundingClientRect();
        const stTop = win.getComputedStyle(topHit);
        const isFloating = stTop.position === "fixed" || stTop.position === "absolute";
        return {
          obstructed: true,
          type: isFloating ? "dropdown_popover" : "hard_overlap",
          blockerDesc: describeEl(topHit),
          blockerRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        };
      });
    } catch {
      return { obstructed: false, reason: "eval_error" };
    }
  }

  /**
   * Vô hiệu hóa cản trở chuột trên TẤT CẢ các lớp Toast / Thông báo nổi đang đè tại tọa độ mục tiêu
   * (Xử lý 1 phát ăn ngay dù có 20 thông báo chồng lên nhau, vẫn giữ nguyên chữ hiển thị cho Assert & Screenshot!)
   */
  async neutralizeBlockingToasts(locator) {
    try {
      return await locator.evaluate((el) => {
        const doc = el.ownerDocument;
        const win = doc.defaultView || window;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hits = Array.from(doc.elementsFromPoint(cx, cy));

        const toastPattern =
          /(?:^|[\s_-])(toast|toastify|snackbar|notistack|sonner|ant-message|ant-notification|el-message|el-notification|vue-notification|swal2-toast|flash-message|floating-alert|notif-toast|toast-item|toast-msg)(?:$|[\s_-])/i;

        let count = 0;
        const seen = new Set();

        for (const h of hits) {
          if (h === el || el.contains(h) || h.contains(el)) break;
          let cur = h;
          let depth = 0;
          while (cur && cur !== doc.body && cur !== doc.documentElement && !cur.contains(el) && depth < 8) {
            const role = (cur.getAttribute?.("role") || "").toLowerCase();
            const cls = `${typeof cur.className === "string" ? cur.className : ""} ${cur.id || ""}`.toLowerCase();
            const st = win.getComputedStyle(cur);
            const isFloatingToast =
              role === "status" ||
              toastPattern.test(cls) ||
              (role === "alert" && !/(dialog|modal)/i.test(cls) && (st.position === "fixed" || st.position === "absolute"));

            if (isFloatingToast && !seen.has(cur)) {
              seen.add(cur);
              cur.style.setProperty("pointer-events", "none", "important");
              cur.setAttribute("data-at-toast-passthrough", "1");
              count++;
              break;
            }
            cur = cur.parentElement;
            depth++;
          }
        }

        // Đồng thời dọn luôn các anh em toast đang nổi cùng container để tránh toast kế tiếp rơi xuống che lại
        if (count > 0) {
          const floatingToasts = doc.querySelectorAll(
            '[role="status"], .Toastify__toast-container, .Toastify__toast, .ant-message, .ant-notification, .el-message, .el-notification, .MuiSnackbar-root, .notistack-SnackbarContainer, [data-sonner-toaster], .toast-container, .toast.show'
          );
          floatingToasts.forEach((node) => {
            if (!node.contains(el) && !seen.has(node)) {
              node.style.setProperty("pointer-events", "none", "important");
              node.setAttribute("data-at-toast-passthrough", "1");
            }
          });
        }

        return count;
      });
    } catch {
      return 0;
    }
  }

  /**
   * Tìm một tọa độ trống AN TOÀN nằm ngoài mọi bảng nổi và KHÔNG trúng nút bấm / link điều hướng nào
   */
  async findSafeOutsidePoint(page, blockerRect = null) {
    try {
      return await page.evaluate((bRect) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
        const vh = window.innerHeight || document.documentElement.clientHeight || 800;

        const isInsideRect = (x, y, r, pad = 10) => {
          if (!r) return false;
          return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
        };

        const isInteractiveHit = (el) => {
          if (!el || el === document.body || el === document.documentElement) return false;
          if (
            el.closest?.(
              "a[href], button, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [role='option'], [role='checkbox'], [role='radio'], [role='tab'], [onclick]"
            )
          ) {
            return true;
          }
          const st = window.getComputedStyle(el);
          return st.cursor === "pointer";
        };

        // Tạo danh sách ứng viên tọa độ ưu tiên vùng rìa an toàn & xung quanh ngoài vật cản
        const candidates = [
          { x: 6, y: 6 },
          { x: vw - 6, y: 6 },
          { x: 6, y: vh - 6 },
          { x: vw - 6, y: vh - 6 },
          { x: Math.round(vw / 2), y: 6 },
          { x: 6, y: Math.round(vh / 2) },
          { x: vw - 6, y: Math.round(vh / 2) },
          { x: Math.round(vw / 2), y: vh - 6 },
        ];

        if (bRect) {
          const midX = Math.max(10, Math.min(vw - 10, Math.round((bRect.left + bRect.right) / 2)));
          const midY = Math.max(10, Math.min(vh - 10, Math.round((bRect.top + bRect.bottom) / 2)));
          if (bRect.left > 24) candidates.unshift({ x: Math.round(bRect.left - 16), y: midY });
          if (bRect.right < vw - 24) candidates.unshift({ x: Math.round(bRect.right + 16), y: midY });
          if (bRect.top > 24) candidates.unshift({ x: midX, y: Math.round(bRect.top - 16) });
          if (bRect.bottom < vh - 24) candidates.unshift({ x: midX, y: Math.round(bRect.bottom + 16) });
        }

        // Thử lưới quét thưa dọc 2 mép trái/phải
        for (let y = 30; y < vh - 20; y += 80) {
          candidates.push({ x: 8, y });
          candidates.push({ x: vw - 8, y });
        }

        // Lần 1: Ưu tiên điểm nằm ngoài blockerRect VÀ không chạm phần tử tương tác nào
        for (const pt of candidates) {
          if (pt.x < 2 || pt.y < 2 || pt.x > vw - 2 || pt.y > vh - 2) continue;
          if (isInsideRect(pt.x, pt.y, bRect)) continue;
          const top = document.elementFromPoint(pt.x, pt.y);
          if (!isInteractiveHit(top)) {
            return pt;
          }
        }

        // Lần 2: Nếu không có điểm hoàn toàn trống, chọn điểm đầu tiên ngoài blockerRect
        for (const pt of candidates) {
          if (pt.x < 2 || pt.y < 2 || pt.x > vw - 2 || pt.y > vh - 2) continue;
          if (!isInsideRect(pt.x, pt.y, bRect)) return pt;
        }

        return { x: 4, y: 4 };
      }, blockerRect);
    } catch {
      return { x: 4, y: 4 };
    }
  }

  /**
   * Thực hiện thao tác Click ra ngoài vùng trống an toàn (dùng cho cả tự chữa lành lẫn hành động `clickOutside`)
   */
  async clickSafeOutside(page, blockerRect = null) {
    const pt = await this.findSafeOutsidePoint(page, blockerRect);
    await page.mouse.click(pt.x, pt.y);
    return pt;
  }

  /**
   * Tự động tìm và bấm nút Đóng (SVG 'x', Close, Cancel, Đóng, Hủy, Bỏ qua) của hộp thoại/popup đang che khuất mục tiêu
   */
  async dismissBlockingModal(frame, locator) {
    try {
      const found = await locator.evaluate((el) => {
        const doc = el.ownerDocument;
        const win = doc.defaultView || window;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const hits = Array.from(doc.elementsFromPoint(cx, cy));

        // Tìm vùng chứa modal đang che el (KHÔNG chứa el)
        const candidateModals = [];
        for (const h of hits) {
          if (h === el || el.contains(h) || h.contains(el)) break;
          let cur = h;
          let d = 0;
          while (cur && cur !== doc.body && cur !== doc.documentElement && !cur.contains(el) && d < 12) {
            const role = (cur.getAttribute?.("role") || "").toLowerCase();
            const cls = `${typeof cur.className === "string" ? cur.className : ""} ${cur.id || ""}`.toLowerCase();
            if (
              cur.tagName === "DIALOG" ||
              role === "dialog" ||
              role === "alertdialog" ||
              cur.getAttribute?.("aria-modal") === "true" ||
              /(modal|dialog|popup|cookie|consent|swal2|banner)/i.test(cls)
            ) {
              if (!candidateModals.includes(cur)) candidateModals.push(cur);
            }
            cur = cur.parentElement;
            d++;
          }
        }

        // Nếu topHit là lớp nền mờ (backdrop), tìm hộp modal hiển thị đang nổi kèm theo không chứa el
        const extraModals = doc.querySelectorAll(
          'dialog[open], [role="dialog"], [role="alertdialog"], .modal.show, .modal.in, .ant-modal, .MuiDialog-paper, .swal2-popup, [class*="modal"], [class*="dialog"], [class*="popup"], [class*="cookie"], [class*="consent"]'
        );
        extraModals.forEach((m) => {
          if (!m.contains(el) && !candidateModals.includes(m)) {
            const st = win.getComputedStyle(m);
            const r = m.getBoundingClientRect();
            const z = parseInt(st.zIndex, 10);
            const isElevated = st.position === "fixed" || st.position === "absolute" || (Number.isFinite(z) && z >= 10) || m.tagName === "DIALOG";
            if (isElevated && st.display !== "none" && st.visibility !== "hidden" && parseFloat(st.opacity) > 0 && r.width > 80 && r.height > 40) {
              candidateModals.push(m);
            }
          }
        });

        // Ưu tiên hộp thoại có z-index cao hơn và kích thước gọn hơn (hộp modal thật thay vì lớp nền toàn màn hình)
        candidateModals.sort((a, b) => {
          const za = parseInt(win.getComputedStyle(a).zIndex, 10) || 0;
          const zb = parseInt(win.getComputedStyle(b).zIndex, 10) || 0;
          if (zb !== za) return zb - za;
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.width * ra.height - rb.width * rb.height;
        });

        const isVisibleNode = (n) => {
          if (!n || !n.isConnected) return false;
          const st = win.getComputedStyle(n);
          if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) return false;
          const r = n.getBoundingClientRect();
          return r.width > 4 && r.height > 4;
        };

        const closeTextRe =
          /^(×|✕|✖|╳|x|close|cancel|dismiss|skip|no thanks|not now|got it|accept|accept all|allow all|đóng|hủy|hủy bỏ|bỏ qua|không cảm ơn|đã hiểu|tắt|đồng ý)$/i;
        const closeAttrRe = /(close|dismiss|cancel|đóng|hủy|bỏ qua|tắt)/i;

        // Xóa đánh dấu tạm cũ nếu có
        doc.querySelectorAll("[data-at-dismiss='1']").forEach((n) => n.removeAttribute("data-at-dismiss"));

        for (const modal of candidateModals) {
          const mRect = modal.getBoundingClientRect();
          const clickables = Array.from(
            modal.querySelectorAll("button, [role='button'], a, span, div, svg, i")
          ).filter((n) => {
            if (!isVisibleNode(n) || n === modal) return false;
            const tag = n.tagName.toLowerCase();
            if (tag === "button" || tag === "a" || n.getAttribute("role") === "button" || n.hasAttribute("onclick")) {
              return true;
            }
            const st = win.getComputedStyle(n);
            return st.cursor === "pointer";
          });

          // Ưu tiên 1: Nút có aria-label / title / class đóng rõ ràng
          let chosen = clickables.find((n) => {
            const meta = `${n.getAttribute("aria-label") || ""} ${n.getAttribute("title") || ""} ${
              typeof n.className === "string" ? n.className : n.getAttribute("class") || ""
            } ${n.id || ""}`;
            return closeAttrRe.test(meta);
          });

          // Ưu tiên 2: Nút có chữ Đóng / Hủy / Cancel / × / Bỏ qua
          if (!chosen) {
            chosen = clickables.find((n) => {
              const txt = (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim();
              return txt.length > 0 && txt.length <= 24 && closeTextRe.test(txt);
            });
          }

          // Ưu tiên 3: Nút icon SVG nhỏ nằm ở góc trên bên phải của Modal (chuẩn UX nút 'X')
          if (!chosen) {
            chosen = clickables.find((n) => {
              const hasSvg = n.tagName.toLowerCase() === "svg" || Boolean(n.querySelector("svg"));
              if (!hasSvg) return false;
              const r = n.getBoundingClientRect();
              const isSmall = r.width <= 56 && r.height <= 56;
              const inTopRight = r.top <= mRect.top + 80 && r.right >= mRect.right - 90;
              const txt = (n.innerText || "").trim();
              return isSmall && inTopRight && txt.length <= 2;
            });
          }

          if (chosen) {
            chosen.setAttribute("data-at-dismiss", "1");
            const desc =
              chosen.getAttribute("aria-label") ||
              chosen.getAttribute("title") ||
              (chosen.innerText || "").trim() ||
              "nút đóng (X)";
            return { found: true, desc };
          }
        }

        return { found: false, desc: "" };
      });

      if (!found?.found) return { dismissed: false, desc: "" };

      const dismissLoc = frame.locator("[data-at-dismiss='1']").first();
      try {
        await dismissLoc.click({ timeout: 2000 });
      } catch {
        await dismissLoc.click({ force: true, timeout: 1500 }).catch(() => {});
      }
      await frame
        .evaluate(() => {
          document.querySelectorAll("[data-at-dismiss='1']").forEach((n) => n.removeAttribute("data-at-dismiss"));
        })
        .catch(() => {});

      return { dismissed: true, desc: found.desc };
    } catch {
      return { dismissed: false, desc: "" };
    }
  }

  /**
   * Chu trình tự chữa lành có giới hạn (tối đa 3 nhịp) để giải phóng vật cản đang đè lên phần tử mục tiêu
   */
  async ensureUnobstructed(page, frame, locator) {
    const actionsTaken = [];
    let lastInspection = await this.inspectObstruction(locator);
    if (!lastInspection.obstructed) {
      return { cleared: true, actionsTaken, lastInspection };
    }

    const activeFrame = frame || page.mainFrame();
    const triedEscape = { done: false };
    const triedOutsideClick = { done: false };
    const triedCenterScroll = { done: false };

    for (let round = 1; round <= 3; round++) {
      const obs = round === 1 ? lastInspection : await this.inspectObstruction(locator);
      lastInspection = obs;
      if (!obs.obstructed) {
        return { cleared: true, actionsTaken, lastInspection };
      }

      logger.info(
        `[Self-Healing] Nhịp ${round}/3: Phát hiện vật cản [${obs.type}] (${obs.blockerDesc}) đang che khuất phần tử mục tiêu -> Đang tự động giải phóng...`
      );

      if (obs.type === "offscreen" || obs.type === "sticky_bar") {
        await locator
          .evaluate((el) => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }))
          .catch(() => {});
        triedCenterScroll.done = true;
        actionsTaken.push(`Tự cuộn phần tử vào chính giữa màn hình để tránh ${obs.blockerDesc}`);
        await page.waitForTimeout(160);
        continue;
      }

      if (obs.type === "toast") {
        const neutralized = await this.neutralizeBlockingToasts(locator);
        if (neutralized > 0) {
          actionsTaken.push(`Tự cho phép thao tác xuyên qua ${neutralized} thông báo nổi (${obs.blockerDesc})`);
          await page.waitForTimeout(100);
          continue;
        }
      }

      if (obs.type === "modal") {
        const modalRes = await this.dismissBlockingModal(activeFrame, locator);
        if (modalRes.dismissed) {
          actionsTaken.push(`Tự đóng hộp thoại che khuất (${obs.blockerDesc}) qua "${modalRes.desc}"`);
          await page.waitForTimeout(260);
          continue;
        }
        if (!triedEscape.done) {
          triedEscape.done = true;
          await page.keyboard.press("Escape").catch(() => {});
          actionsTaken.push(`Nhấn Escape để đóng hộp thoại ${obs.blockerDesc}`);
          await page.waitForTimeout(220);
          continue;
        }
        if (!triedOutsideClick.done) {
          triedOutsideClick.done = true;
          await this.clickSafeOutside(page, obs.blockerRect);
          actionsTaken.push(`Bấm ra vùng trống ngoài ${obs.blockerDesc}`);
          await page.waitForTimeout(220);
          continue;
        }
      }

      if (obs.type === "dropdown_popover") {
        // Nhịp 1: Thử Escape trước (đóng mượt các dropdown chuẩn)
        if (!triedEscape.done) {
          triedEscape.done = true;
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(180);
          const afterEsc = await this.inspectObstruction(locator);
          if (!afterEsc.obstructed) {
            actionsTaken.push(`Tự đóng bảng nổi (${obs.blockerDesc}) bằng phím Escape`);
            return { cleared: true, actionsTaken, lastInspection: afterEsc };
          }
          // Nếu nhấn Escape không đóng (vd: DIV giả checkbox không bắt phím) -> bấm ngay ra ngoài vùng trống an toàn!
        }

        if (!triedOutsideClick.done) {
          triedOutsideClick.done = true;
          const pt = await this.clickSafeOutside(page, obs.blockerRect);
          actionsTaken.push(`Tự bấm ra ngoài vùng trống (${pt.x},${pt.y}) để đóng ${obs.blockerDesc}`);
          await page.waitForTimeout(240);
          continue;
        }

        if (!triedCenterScroll.done) {
          triedCenterScroll.done = true;
          await locator
            .evaluate((el) => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }))
            .catch(() => {});
          actionsTaken.push(`Cuộn mục tiêu vào giữa màn hình thoát khỏi ${obs.blockerDesc}`);
          await page.waitForTimeout(160);
          continue;
        }
      }

      if (obs.type === "hard_overlap") {
        if (!triedCenterScroll.done) {
          triedCenterScroll.done = true;
          await locator
            .evaluate((el) => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }))
            .catch(() => {});
          await page.waitForTimeout(150);
          continue;
        }
        // Không thể tự dọn vật cản tĩnh -> thoát sớm để tầng gọi dùng Fallback kèm Cảnh báo UX
        break;
      }

      break;
    }

    const finalCheck = await this.inspectObstruction(locator);
    return {
      cleared: !finalCheck.obstructed,
      actionsTaken,
      lastInspection: finalCheck,
    };
  }

  /**
   * Cứu cánh cuối cùng cho thao tác Điền văn bản (tương thích React 16-19 / Vue / Angular)
   * Chỉ sử dụng khi đã thử dẹp vật cản nhưng phần tử vẫn bị lỗi CSS cứng đè lên.
   */
  async forceFillWithFrameworkEvents(locator, value) {
    await locator.evaluate((el, val) => {
      el.focus();
      const strVal = String(val ?? "");
      if (el.getAttribute("contenteditable") === "true") {
        el.innerHTML = "";
        el.textContent = strVal;
      } else {
        const tag = el.tagName.toUpperCase();
        const proto =
          tag === "TEXTAREA"
            ? window.HTMLTextAreaElement?.prototype
            : window.HTMLInputElement?.prototype;
        const nativeSetter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
        const prevVal = el.value;
        if (nativeSetter) {
          nativeSetter.call(el, strVal);
        } else {
          el.value = strVal;
        }
        // Đồng bộ bộ theo dõi nội bộ của React 16/17/18/19 (_valueTracker)
        const tracker = el._valueTracker;
        if (tracker && typeof tracker.setValue === "function") {
          tracker.setValue(prevVal === strVal ? "__at_reset__" : prevVal);
        }
      }
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }, value);
  }
}

export const obstructionResolverService = new ObstructionResolverService();
