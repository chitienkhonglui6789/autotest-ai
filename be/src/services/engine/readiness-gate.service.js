import { logger } from "../../utils/logger.js";
import { pageTelemetryService } from "../browser/page-telemetry.service.js";

const DEFAULT_LOADING_SELECTOR = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  ".loading-mask",
  ".loading-overlay",
  ".ant-spin-spinning",
  ".el-loading-mask",
  ".MuiCircularProgress-root",
  '[data-loading="true"]',
].join(", ");

/**
 * Cổng Sẵn sàng 5 tầng nhẹ (ReadinessGateService)
 * - 100% tất định (deterministic), thuần ESM + Playwright, không gọi LLM.
 * - Cuộn an toàn tránh sticky header/footer (scrollIntoSafeViewport).
 * - Kiểm tra va chạm đa điểm (probeHitTest) & phân loại chính xác kẻ che khuất (occluder).
 * - Kiểm tra ổn định khung hình bằng requestAnimationFrame (waitForElementStability).
 * - Đồng bộ nhẹ sau thao tác dựa trên PageTelemetry + MutationObserver (waitForPageQuiescence).
 */
export class ReadinessGateService {
  constructor(telemetry = pageTelemetryService) {
    this.telemetry = telemetry;
  }

  /**
   * Thực thi các bước kiểm tra DOM / cuộn / hit-test / rAF stability ngay bên trong frame của phần tử
   * nhằm loại bỏ lặp mã và giảm tối đa chi phí IPC round-trip.
   */
  async _runGateInBrowser(locator, mode, options = {}) {
    return await locator.evaluate(
      (el, { mode, targetFrames, budgetMs }) => {
        if (!el || !el.isConnected) {
          if (mode === "scroll") {
            return { scrolled: false, inSafeBand: false, topInset: 0, bottomInset: 0, reason: "not_attached" };
          }
          if (mode === "stability") {
            return { stable: false, moved: false, elapsedMs: 0, reason: "not_attached" };
          }
          if (mode === "probe") {
            return { obstructed: false, actionable: false, reason: "not_attached", safePoint: null, occluder: null };
          }
          return { phase: "blocked", hit: { obstructed: false, actionable: false, reason: "not_attached", safePoint: null, occluder: null } };
        }

        const getParentOrHost = (node) => {
          if (!node) return null;
          if (node.parentElement) return node.parentElement;
          const root = node.getRootNode?.();
          return root && root.host ? root.host : null;
        };

        const scrollIntoSafeViewportInDom = () => {
          const MARGIN = 16;

          const measureInsets = () => {
            const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
            const vh = window.innerHeight || document.documentElement.clientHeight || 800;
            let topInset = 0;
            let bottomInset = 0;

            const root = document.body || document.documentElement;
            if (!root) return { vw, vh, topInset: 0, bottomInset: 0 };

            const nodes = root.querySelectorAll("*");
            const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "META", "LINK", "BR", "HR", "OPTION", "PATH", "SVG"]);

            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              if (SKIP_TAGS.has(node.tagName)) continue;
              if (node === el || node.contains(el) || el.contains(node)) continue;
              if (node.getClientRects().length === 0) continue;

              const st = window.getComputedStyle(node);
              const pos = st.position;
              if (pos !== "fixed" && pos !== "sticky") continue;
              if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") continue;
              if (parseFloat(st.opacity) === 0) continue;

              const r = node.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) continue;
              if (r.height >= vh * 0.45) continue;
              if (r.width < Math.min(200, vw * 0.25)) continue;

              if (r.top <= 48 && r.bottom > 0 && r.bottom <= vh * 0.45) {
                if (pos === "fixed") {
                  topInset = Math.max(topInset, r.bottom);
                } else {
                  const stickyTop = st.top !== "auto" ? parseFloat(st.top) : NaN;
                  topInset = Number.isFinite(stickyTop)
                    ? Math.max(topInset, Math.max(r.bottom, stickyTop + r.height))
                    : Math.max(topInset, r.bottom);
                }
              }

              if (r.bottom >= vh - 48 && r.top < vh && r.top >= vh * 0.55) {
                if (pos === "fixed") {
                  bottomInset = Math.max(bottomInset, vh - r.top);
                } else {
                  const stickyBottom = st.bottom !== "auto" ? parseFloat(st.bottom) : NaN;
                  bottomInset = Number.isFinite(stickyBottom)
                    ? Math.max(bottomInset, Math.max(vh - r.top, stickyBottom + r.height))
                    : Math.max(bottomInset, vh - r.top);
                }
              }
            }

            return {
              vw,
              vh,
              topInset: Math.min(topInset, vh * 0.45),
              bottomInset: Math.min(bottomInset, vh * 0.45),
            };
          };

          let scrolled = false;

          // 1. Cuộn các container cuộn lồng nhau từ trong ra ngoài
          const scrollableAncestors = [];
          let cur = getParentOrHost(el);
          while (cur && cur !== document.documentElement) {
            if (cur.nodeType === 1) {
              const st = window.getComputedStyle(cur);
              const isBody = cur === document.body;
              const canScrollY =
                (!isBody || st.overflowY !== "visible") &&
                /(auto|scroll|overlay)/.test(st.overflowY) &&
                cur.scrollHeight > cur.clientHeight + 1;
              const canScrollX =
                (!isBody || st.overflowX !== "visible") &&
                /(auto|scroll|overlay)/.test(st.overflowX) &&
                cur.scrollWidth > cur.clientWidth + 1;

              if (canScrollY || canScrollX) {
                scrollableAncestors.push({ node: cur, canScrollY, canScrollX });
              }
            }
            cur = getParentOrHost(cur);
          }

          for (const anc of scrollableAncestors) {
            const ancRect = anc.node.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            let dx = 0;
            let dy = 0;

            if (anc.canScrollY && (elRect.top < ancRect.top + 8 || elRect.bottom > ancRect.bottom - 8)) {
              dy = elRect.top + elRect.height / 2 - (ancRect.top + ancRect.height / 2);
            }
            if (anc.canScrollX && (elRect.left < ancRect.left + 8 || elRect.right > ancRect.right - 8)) {
              dx = elRect.left + elRect.width / 2 - (ancRect.left + ancRect.width / 2);
            }

            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
              const prevTop = anc.node.scrollTop;
              const prevLeft = anc.node.scrollLeft;
              if (typeof anc.node.scrollBy === "function") {
                anc.node.scrollBy({ left: dx, top: dy, behavior: "instant" });
              } else {
                anc.node.scrollTop += dy;
                anc.node.scrollLeft += dx;
              }
              if (anc.node.scrollTop !== prevTop || anc.node.scrollLeft !== prevLeft) {
                scrolled = true;
              }
            }
          }

          // 2. Cuộn window vào Safe Viewport Band
          const computeBand = (insets) => {
            let safeTop = insets.topInset + MARGIN;
            let safeBottom = insets.vh - insets.bottomInset - MARGIN;
            if (safeBottom - safeTop < 24) {
              safeTop = insets.topInset;
              safeBottom = insets.vh - insets.bottomInset;
            }
            return { safeTop, safeBottom, safeCenterY: (safeTop + safeBottom) / 2 };
          };

          let insets = measureInsets();
          let band = computeBand(insets);
          let elRect = el.getBoundingClientRect();

          const isOutVert =
            elRect.top < band.safeTop ||
            (elRect.height <= band.safeBottom - band.safeTop
              ? elRect.bottom > band.safeBottom
              : elRect.top > band.safeCenterY);
          const isOutHoriz = elRect.left < 0 || elRect.right > insets.vw;

          if (isOutVert || isOutHoriz) {
            const dy = isOutVert
              ? elRect.height > band.safeBottom - band.safeTop
                ? elRect.top - band.safeTop
                : elRect.top + elRect.height / 2 - band.safeCenterY
              : 0;
            const dx = isOutHoriz ? elRect.left + elRect.width / 2 - insets.vw / 2 : 0;

            const prevWinY = window.scrollY;
            const prevWinX = window.scrollX;
            window.scrollBy({ left: dx, top: dy, behavior: "instant" });
            if (window.scrollY !== prevWinY || window.scrollX !== prevWinX) {
              scrolled = true;
            }

            insets = measureInsets();
            band = computeBand(insets);
            elRect = el.getBoundingClientRect();
            if (elRect.top < band.safeTop && window.scrollY > 0) {
              const adjustY = elRect.top - band.safeTop;
              const beforeY = window.scrollY;
              window.scrollBy({ left: 0, top: adjustY, behavior: "instant" });
              if (window.scrollY !== beforeY) scrolled = true;
              elRect = el.getBoundingClientRect();
            }
          }

          const inSafeBand =
            elRect.top >= band.safeTop - 1 &&
            elRect.bottom <= band.safeBottom + 1 &&
            elRect.left >= -1 &&
            elRect.right <= insets.vw + 1;

          return {
            scrolled,
            inSafeBand,
            topInset: Math.round(insets.topInset),
            bottomInset: Math.round(insets.bottomInset),
            rect: {
              x: Math.round(elRect.x),
              y: Math.round(elRect.y),
              width: Math.round(elRect.width),
              height: Math.round(elRect.height),
              top: Math.round(elRect.top),
              bottom: Math.round(elRect.bottom),
            },
          };
        };

        const probeHitTestInDom = () => {
          const isNodeHidden = (node) => {
            let cur = node;
            let depth = 0;
            while (cur && depth < 30) {
              if (cur.nodeType === 1) {
                if (cur.hidden === true) return true;
                if (cur !== el && cur.getAttribute?.("aria-hidden") === "true") return true;
                const st = window.getComputedStyle(cur);
                if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") return true;
                if (
                  parseFloat(st.opacity) === 0 &&
                  !(cur === el && cur.tagName === "INPUT" && (cur.type === "checkbox" || cur.type === "radio"))
                ) {
                  return true;
                }
              }
              cur = getParentOrHost(cur);
              depth++;
            }
            return false;
          };

          if (isNodeHidden(el)) {
            return { obstructed: false, actionable: false, reason: "not_visible", safePoint: null, occluder: null };
          }

          const rect = el.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) {
            return { obstructed: false, actionable: false, reason: "too_small", safePoint: null, occluder: null };
          }

          const isDisabled =
            el.disabled === true ||
            (typeof el.matches === "function" && el.matches(":disabled")) ||
            el.getAttribute("aria-disabled") === "true";
          if (isDisabled) {
            return { obstructed: false, actionable: false, reason: "disabled", safePoint: null, occluder: null };
          }

          if (el.closest?.("[inert]")) {
            return { obstructed: false, actionable: false, reason: "inert", safePoint: null, occluder: null };
          }

          const isBusy = Boolean(el.getAttribute("aria-busy") === "true" || el.closest?.('[aria-busy="true"]'));

          const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
          const vh = window.innerHeight || document.documentElement.clientHeight || 800;
          const visLeft = Math.max(0, rect.left);
          const visRight = Math.min(vw, rect.right);
          const visTop = Math.max(0, rect.top);
          const visBottom = Math.min(vh, rect.bottom);

          if (visRight - visLeft <= 1 || visBottom - visTop <= 1) {
            return { obstructed: false, actionable: false, reason: "outside_viewport", safePoint: null, occluder: null };
          }

          const clampPoint = (x, y) => ({
            x: Math.min(vw - 0.5, Math.max(0.5, x)),
            y: Math.min(vh - 0.5, Math.max(0.5, y)),
          });

          const cx = (visLeft + visRight) / 2;
          const cy = (visTop + visBottom) / 2;
          const dx = (visRight - visLeft) * 0.25;
          const dy = (visBottom - visTop) * 0.25;

          const rawPoints = [
            clampPoint(cx, cy),
            clampPoint(cx - dx, cy - dy),
            clampPoint(cx + dx, cy - dy),
            clampPoint(cx - dx, cy + dy),
            clampPoint(cx + dx, cy + dy),
          ];

          const points = [];
          const seen = new Set();
          for (const pt of rawPoints) {
            const key = `${Math.round(pt.x)}:${Math.round(pt.y)}`;
            if (!seen.has(key)) {
              seen.add(key);
              points.push(pt);
            }
          }

          const getHitStack = (x, y) => {
            let stack = document.elementsFromPoint(x, y) || [];
            if (stack.length > 0 && stack[0]?.shadowRoot?.elementsFromPoint) {
              const inner = stack[0].shadowRoot.elementsFromPoint(x, y);
              if (inner && inner.length > 0) {
                stack = [...inner, ...stack];
              }
            }
            return stack;
          };

          const isCleanHit = (hitEl) => {
            if (!hitEl) return false;
            if (hitEl === el || el.contains(hitEl)) return true;
            const label = hitEl.closest?.("label");
            if (label && label.control === el) return true;
            return false;
          };

          let primaryBlocker = null;

          for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            const stack = getHitStack(pt.x, pt.y);
            let topHit = null;
            for (const candidate of stack) {
              if (!candidate || candidate.nodeType !== 1) continue;
              if (window.getComputedStyle(candidate).pointerEvents === "none") continue;
              topHit = candidate;
              break;
            }

            if (isCleanHit(topHit)) {
              return {
                obstructed: false,
                actionable: true,
                isBusy,
                safePoint: { x: Math.round(pt.x), y: Math.round(pt.y) },
                occluder: null,
              };
            }

            if (i === 0 && topHit) {
              primaryBlocker = topHit;
            } else if (!primaryBlocker && topHit) {
              primaryBlocker = topHit;
            }
          }

          const hasOpenModalInDoc = Boolean(
            document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')
          );

          const classifyNode = (node) => {
            if (!node || node.nodeType !== 1) return null;
            const st = window.getComputedStyle(node);
            const r = node.getBoundingClientRect();
            const tag = node.tagName.toLowerCase();
            const role = (node.getAttribute("role") || "").toLowerCase();
            const id = node.id || "";
            const className = typeof node.className === "string" ? node.className : node.getAttribute("class") || "";
            const ariaLabel = node.getAttribute("aria-label") || "";
            const testId = node.getAttribute("data-testid") || "";
            const meta = `${tag} ${role} ${id} ${className} ${ariaLabel} ${testId}`.toLowerCase();
            const rawText = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
            const textLower = rawText.toLowerCase();
            const pos = st.position;
            const isPositioned = pos === "fixed" || pos === "sticky" || pos === "absolute";

            const isLoadingMask =
              node.getAttribute("aria-busy") === "true" ||
              role === "progressbar" ||
              node.getAttribute("data-loading") === "true" ||
              /\b(loading|loading-mask|loading-overlay|spinner|loader|skeleton|progress-overlay|ant-spin|el-loading|backdrop-loading)\b/i.test(
                meta
              ) ||
              (isPositioned && /^(đang tải|loading|xin chờ|vui lòng chờ|processing)(\.{0,3})$/i.test(rawText));

            const isCookieBanner =
              /\b(cookie|consent|gdpr|cc-banner|onetrust)\b/i.test(meta) ||
              ((pos === "fixed" || pos === "sticky") &&
                r.height < vh * 0.65 &&
                /(cookie|chấp nhận tất cả|từ chối.*cookie|cookie consent|chính sách bảo mật)/i.test(textLower));

            const isModal =
              tag === "dialog" ||
              role === "dialog" ||
              role === "alertdialog" ||
              node.getAttribute("aria-modal") === "true" ||
              (/\b(modal|dialog|drawer|modal-backdrop|modal-overlay|swal2|ant-modal|el-dialog|mui-modal|chakra-modal)\b/i.test(
                meta
              ) &&
                (isPositioned || r.width > 120)) ||
              (hasOpenModalInDoc && pos === "fixed" && r.width >= vw * 0.7 && r.height >= vh * 0.7);

            const isToast =
              (!isModal &&
                !isCookieBanner &&
                !isLoadingMask &&
                (role === "alert" || role === "status") &&
                (isPositioned || /\b(toast|snackbar|alert|banner|notification|message)\b/i.test(meta))) ||
              /\b(toast|snackbar|toastify|notistack|ant-message|ant-notification|el-message|el-notification|sonner)\b/i.test(
                meta
              );

            const isFloatingPopup =
              ["listbox", "menu", "menubar", "tree", "grid", "tooltip"].includes(role) ||
              /\b(dropdown|dropdown-menu|popover|popper|tooltip|listbox|select-menu|select-dropdown|multi-select|multiselect|autocomplete|typeahead|datepicker|calendar-popup|menu-list|ant-select-dropdown|el-select-dropdown|mui-popover|tippy)\b/i.test(
                meta
              ) ||
              (isPositioned &&
                !isModal &&
                !isCookieBanner &&
                Boolean(node.querySelector?.('[role="option"], [role="menuitem"], input[type="checkbox"]')));

            const isStickyBar =
              (pos === "fixed" || pos === "sticky") &&
              !isModal &&
              !isCookieBanner &&
              !isLoadingMask &&
              !isToast &&
              !isFloatingPopup &&
              (tag === "header" ||
                tag === "nav" ||
                tag === "footer" ||
                ["banner", "navigation", "contentinfo"].includes(role) ||
                /\b(sticky|fixed-top|fixed-bottom|navbar|header|topbar|footer|bottom-bar|toolbar)\b/i.test(meta) ||
                (r.width >= vw * 0.4 && r.height <= vh * 0.35 && (r.top <= 24 || r.bottom >= vh - 24)));

            let category = "generic_overlay";
            if (isLoadingMask) category = "loading_mask";
            else if (isCookieBanner) category = "cookie_banner";
            else if (isModal) category = "modal";
            else if (isToast) category = "toast";
            else if (isFloatingPopup) category = "floating_popup";
            else if (isStickyBar) category = "sticky_bar";

            const parsedZ = Number(st.zIndex);
            return {
              node,
              category,
              info: {
                tag,
                role,
                id,
                className,
                text: rawText.slice(0, 160),
                zIndex: Number.isFinite(parsedZ) ? parsedZ : st.zIndex || "auto",
                position: pos,
                isModal,
                isFloatingPopup,
                isToast,
                isLoadingMask,
                isStickyBar,
                isCookieBanner,
                category,
                rect: {
                  x: Math.round(r.x),
                  y: Math.round(r.y),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                  top: Math.round(r.top),
                  right: Math.round(r.right),
                  bottom: Math.round(r.bottom),
                  left: Math.round(r.left),
                },
              },
            };
          };

          let chosen = classifyNode(primaryBlocker);
          let walk = primaryBlocker;
          let depth = 0;
          while (walk && walk !== document.body && walk !== document.documentElement && depth < 10) {
            if (walk.contains(el)) break;
            const candidate = classifyNode(walk);
            if (candidate && candidate.category !== "generic_overlay") {
              chosen = candidate;
              if (candidate.category === "modal" || candidate.category === "cookie_banner" || candidate.category === "loading_mask") {
                break;
              }
            } else if (
              chosen?.category === "generic_overlay" &&
              candidate &&
              (candidate.info.position === "fixed" || candidate.info.position === "sticky" || candidate.info.position === "absolute")
            ) {
              chosen = candidate;
            }
            walk = getParentOrHost(walk);
            depth++;
          }

          const occluder = chosen?.info || {
            tag: primaryBlocker ? primaryBlocker.tagName.toLowerCase() : "unknown",
            role: "",
            id: "",
            className: "",
            text: "",
            zIndex: "auto",
            position: "static",
            isModal: false,
            isFloatingPopup: false,
            isToast: false,
            isLoadingMask: false,
            isStickyBar: false,
            isCookieBanner: false,
            category: "generic_overlay",
            rect: { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 },
          };

          return {
            obstructed: true,
            actionable: false,
            isBusy,
            reason: `occluded_by_${occluder.category}`,
            category: occluder.category,
            safePoint: null,
            occluder,
          };
        };

        const waitStabilityInDom = () => {
          const startedAt = performance.now();
          const readRect = () => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          const isSameRect = (a, b) =>
            Math.abs(a.x - b.x) <= 1 &&
            Math.abs(a.y - b.y) <= 1 &&
            Math.abs(a.width - b.width) <= 1 &&
            Math.abs(a.height - b.height) <= 1;

          return new Promise((resolve) => {
            let prev = readRect();
            let stableCount = 0;
            let moved = false;
            let finished = false;
            let rafId = null;

            const finish = (stable, reason) => {
              if (finished) return;
              finished = true;
              if (rafId !== null) cancelAnimationFrame(rafId);
              clearTimeout(hardTimer);
              const cur = el.isConnected ? readRect() : prev;
              resolve({
                stable,
                moved,
                elapsedMs: Math.round(performance.now() - startedAt),
                rect: {
                  x: Math.round(cur.x),
                  y: Math.round(cur.y),
                  width: Math.round(cur.width),
                  height: Math.round(cur.height),
                },
                ...(reason ? { reason } : {}),
              });
            };

            const hardTimer = setTimeout(() => finish(false, "stability_timeout"), budgetMs);

            const tick = () => {
              if (finished) return;
              if (!el.isConnected) {
                finish(false, "detached");
                return;
              }
              const cur = readRect();
              if (cur.width > 0 && cur.height > 0 && isSameRect(cur, prev)) {
                stableCount++;
                if (stableCount >= targetFrames) {
                  finish(true);
                  return;
                }
              } else {
                moved = true;
                stableCount = 0;
              }
              prev = cur;
              rafId = requestAnimationFrame(tick);
            };

            rafId = requestAnimationFrame(tick);
          });
        };

        if (mode === "scroll") {
          return scrollIntoSafeViewportInDom();
        }
        if (mode === "probe") {
          const res = probeHitTestInDom();
          delete res.isBusy;
          return res;
        }
        if (mode === "stability") {
          return waitStabilityInDom();
        }

        // mode === "actionable_pass": gộp scroll -> probe -> rAF stability -> re-probe nếu dịch chuyển
        scrollIntoSafeViewportInDom();
        const hit = probeHitTestInDom();
        if (hit.obstructed || !hit.actionable || hit.isBusy) {
          const isLoading = Boolean((hit.obstructed && hit.occluder?.isLoadingMask) || hit.isBusy);
          delete hit.isBusy;
          return { phase: isLoading ? "loading" : "blocked", hit };
        }
        delete hit.isBusy;

        return waitStabilityInDom().then((stability) => {
          if (!stability.stable) {
            return { phase: "unstable", stability };
          }
          if (stability.moved) {
            scrollIntoSafeViewportInDom();
            const hit2 = probeHitTestInDom();
            const isLoading2 = Boolean((hit2.obstructed && hit2.occluder?.isLoadingMask) || hit2.isBusy);
            delete hit2.isBusy;
            if (hit2.obstructed || !hit2.actionable || isLoading2) {
              return { phase: isLoading2 ? "loading" : "blocked", hit: hit2, stability };
            }
            return { phase: "ready", hit: hit2, stability };
          }
          return { phase: "ready", hit, stability };
        });
      },
      {
        mode,
        targetFrames: Math.max(1, Number(options.frames) || 2),
        budgetMs: Math.max(50, Number(options.maxWaitMs) || 1000),
      }
    );
  }

  /**
   * Tính chiều cao vùng bị chiếm bởi các thanh position: fixed / sticky ở mép trên & dưới,
   * sau đó cuộn mọi container cuộn lồng nhau và window để phần tử nằm gọn trong Safe Viewport Band.
   */
  async scrollIntoSafeViewport(locator) {
    if (!locator) {
      return { scrolled: false, inSafeBand: false, topInset: 0, bottomInset: 0, reason: "missing_locator" };
    }
    try {
      return await this._runGateInBrowser(locator, "scroll");
    } catch (err) {
      logger.debug(`[ReadinessGate] scrollIntoSafeViewport bỏ qua lỗi: ${err.message}`);
      return { scrolled: false, inSafeBand: false, topInset: 0, bottomInset: 0, reason: "evaluate_error" };
    }
  }

  /**
   * Kiểm tra va chạm đa điểm (tối đa 5 điểm trong bounding box) bằng document.elementsFromPoint.
   * Phân loại chính xác occluder nếu tất cả các điểm đều bị che khuất.
   */
  async probeHitTest(locator) {
    if (!locator) {
      return { obstructed: false, actionable: false, reason: "missing_locator", safePoint: null, occluder: null };
    }
    try {
      return await this._runGateInBrowser(locator, "probe");
    } catch (err) {
      logger.debug(`[ReadinessGate] probeHitTest lỗi: ${err.message}`);
      return { obstructed: false, actionable: false, reason: "evaluate_error", safePoint: null, occluder: null };
    }
  }

  /**
   * Chờ bounding box của phần tử ổn định qua `frames` requestAnimationFrame liên tiếp (sai số <= 1px).
   * Kết thúc trong ~32ms (2 frame) nếu phần tử đã đứng yên.
   */
  async waitForElementStability(locator, { frames = 2, maxWaitMs = 1000 } = {}) {
    if (!locator) {
      return { stable: false, moved: false, elapsedMs: 0, reason: "missing_locator" };
    }
    try {
      return await this._runGateInBrowser(locator, "stability", { frames, maxWaitMs });
    } catch (err) {
      logger.debug(`[ReadinessGate] waitForElementStability lỗi: ${err.message}`);
      return { stable: false, moved: false, elapsedMs: 0, reason: "evaluate_error" };
    }
  }

  /**
   * Chờ đồng bộ nhẹ sau thao tác:
   * - Đợi critical in-flight requests về 0 (có soft deadline).
   * - Đợi không còn loading mask / spinner / aria-busy="true".
   * - Quan sát DOM yên tĩnh qua quietWindowMs bằng MutationObserver.
   * - Tối ưu tốc độ: nếu criticalInFlightCount === 0 và không có loading indicator -> kết thúc trong <= 180ms.
   */
  async waitForPageQuiescence(
    page,
    session,
    { quietWindowMs = 150, softNetworkWaitMs = 1800, maxWaitMs = 2500, targetLocator = null } = {}
  ) {
    const startTime = Date.now();
    if (!page || page.isClosed?.()) {
      return { quiet: true, elapsedMs: 0, timedOut: false, criticalInFlightCount: 0 };
    }

    const hardDeadline = startTime + Math.max(50, maxWaitMs);
    const softNetDeadline = startTime + Math.min(maxWaitMs, softNetworkWaitMs);

    const getInFlight = () => {
      if (!session || !this.telemetry?.getCriticalInFlightCount) return 0;
      try {
        return Number(this.telemetry.getCriticalInFlightCount(session)) || 0;
      } catch {
        return 0;
      }
    };

    let inFlight = getInFlight();

    while (inFlight > 0 && Date.now() < softNetDeadline) {
      await new Promise((r) => setTimeout(r, Math.min(35, Math.max(5, softNetDeadline - Date.now()))));
      if (page.isClosed?.()) {
        return { quiet: true, elapsedMs: Date.now() - startTime, timedOut: false, criticalInFlightCount: 0 };
      }
      inFlight = getInFlight();
    }

    if (targetLocator) {
      while (Date.now() < hardDeadline) {
        const targetBusy = await targetLocator
          .evaluate((el) => {
            if (!el || !el.isConnected) return false;
            return Boolean(el.getAttribute("aria-busy") === "true" || el.closest?.('[aria-busy="true"]'));
          })
          .catch(() => false);
        if (!targetBusy) break;
        await new Promise((r) => setTimeout(r, Math.min(35, Math.max(5, hardDeadline - Date.now()))));
      }
    }

    const remainingMs = Math.max(10, hardDeadline - Date.now());
    const effectiveQuietMs = Math.min(quietWindowMs, remainingMs);

    const domResult = await page
      .evaluate(
        ({ loadingSel, quietMs, budgetMs }) => {
          const evalStart = performance.now();
          const hasVisibleLoading = () => {
            const nodes = document.querySelectorAll(loadingSel);
            for (const n of nodes) {
              const st = window.getComputedStyle(n);
              if (st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse") continue;
              if (parseFloat(st.opacity) === 0) continue;
              const r = n.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) return true;
            }
            return false;
          };

          return new Promise((resolve) => {
            let settled = false;
            let quietTimer = null;
            let pollTimer = null;
            let observer = null;

            const finish = (quiet, timedOut) => {
              if (settled) return;
              settled = true;
              if (quietTimer) clearTimeout(quietTimer);
              if (pollTimer) clearInterval(pollTimer);
              if (hardTimer) clearTimeout(hardTimer);
              if (observer) observer.disconnect();
              resolve({
                quiet,
                timedOut,
                domElapsedMs: Math.round(performance.now() - evalStart),
              });
            };

            const hardTimer = setTimeout(() => finish(false, true), budgetMs);

            const startQuietWindow = (initial = false) => {
              if (settled) return;
              const scheduleQuiet = (delayMs = quietMs) => {
                if (quietTimer) clearTimeout(quietTimer);
                quietTimer = setTimeout(() => {
                  if (hasVisibleLoading()) {
                    waitForLoadingThenQuiet();
                  } else {
                    finish(true, false);
                  }
                }, delayMs);
              };

              if (typeof MutationObserver === "function" && document.body) {
                observer = new MutationObserver((mutations) => {
                  if (mutations.length > 0) {
                    scheduleQuiet(quietMs);
                  }
                });
                observer.observe(document.body, {
                  childList: true,
                  subtree: true,
                  attributes: true,
                  attributeFilter: ["class", "style", "aria-busy", "hidden", "disabled", "open"],
                });
              }
              // Khi trang đã tĩnh sẵn lúc bắt đầu, trừ hao chi phí IPC (~65ms trên Windows/parallel Chromium) để tổng thời gian <= 180ms
              const initialDelay = initial && quietMs >= 100 ? Math.max(40, quietMs - 65) : quietMs;
              scheduleQuiet(initialDelay);
            };

            const waitForLoadingThenQuiet = () => {
              if (settled) return;
              if (observer) {
                observer.disconnect();
                observer = null;
              }
              if (quietTimer) {
                clearTimeout(quietTimer);
                quietTimer = null;
              }
              if (pollTimer) clearInterval(pollTimer);

              pollTimer = setInterval(() => {
                if (!hasVisibleLoading()) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                  startQuietWindow(false);
                }
              }, 35);
            };

            if (!hasVisibleLoading()) {
              startQuietWindow(true);
            } else {
              waitForLoadingThenQuiet();
            }
          });
        },
        { loadingSel: DEFAULT_LOADING_SELECTOR, quietMs: effectiveQuietMs, budgetMs: remainingMs }
      )
      .catch(() => ({ quiet: true, timedOut: false, domElapsedMs: 0 }));

    return {
      quiet: Boolean(domResult.quiet),
      timedOut: Boolean(domResult.timedOut),
      elapsedMs: Date.now() - startTime,
      criticalInFlightCount: getInFlight(),
    };
  }

  /**
   * Cổng kiểm tra sẵn sàng 5 tầng trước khi thao tác:
   * 1. Kiểm tra ngữ cảnh sống (page mở, locator gắn DOM).
   * 2. Cuộn an toàn tránh sticky header/footer (scrollIntoSafeViewport).
   * 3. Kiểm tra & chờ loading mask / aria-busy; fail-early ngay nếu gặp occluder tĩnh.
   * 4. Chờ phần tử ổn định khung hình (waitForElementStability).
   * 5. Xác nhận điểm click sạch (probeHitTest).
   */
  async ensureActionable(page, locator, session = {}, { profile = "click", timeoutMs = 4000 } = {}) {
    const startTime = Date.now();
    const deadline = startTime + Math.max(100, Number(timeoutMs) || 4000);

    if (!page || page.isClosed?.()) {
      return { ready: false, reason: "page_closed", occluder: null, elapsedMs: Date.now() - startTime };
    }
    if (!locator) {
      return { ready: false, reason: "missing_locator", occluder: null, elapsedMs: Date.now() - startTime };
    }

    const attachedCount = await locator.count().catch(() => 0);
    if (attachedCount === 0) {
      const waitAttachBudget = Math.min(1000, Math.max(100, deadline - Date.now()));
      try {
        await locator.waitFor({ state: "attached", timeout: waitAttachBudget });
      } catch {
        return { ready: false, reason: "not_attached", occluder: null, elapsedMs: Date.now() - startTime };
      }
    }

    let pass;
    try {
      pass = await this._runGateInBrowser(locator, "actionable_pass", {
        frames: 2,
        maxWaitMs: Math.min(1000, Math.max(100, deadline - Date.now())),
      });
    } catch {
      return { ready: false, reason: "evaluate_error", occluder: null, profile, elapsedMs: Date.now() - startTime };
    }

    while (pass.phase === "loading" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.min(40, Math.max(5, deadline - Date.now()))));
      if (page.isClosed?.()) {
        return { ready: false, reason: "page_closed", occluder: null, profile, elapsedMs: Date.now() - startTime };
      }
      try {
        pass = await this._runGateInBrowser(locator, "actionable_pass", {
          frames: 2,
          maxWaitMs: Math.min(1000, Math.max(100, deadline - Date.now())),
        });
      } catch {
        return { ready: false, reason: "evaluate_error", occluder: null, profile, elapsedMs: Date.now() - startTime };
      }
    }

    if (pass.phase === "ready") {
      return {
        ready: true,
        safePoint: pass.hit.safePoint,
        profile,
        elapsedMs: Date.now() - startTime,
      };
    }

    if (pass.phase === "unstable") {
      return {
        ready: false,
        reason: pass.stability?.reason || "unstable_element",
        occluder: null,
        profile,
        elapsedMs: Date.now() - startTime,
      };
    }

    const hit = pass.hit || {};
    return {
      ready: false,
      reason:
        pass.phase === "loading"
          ? "loading_timeout"
          : hit.reason || (hit.occluder ? `occluded_by_${hit.occluder.category || "overlay"}` : "not_actionable"),
      occluder: hit.occluder || null,
      profile,
      elapsedMs: Date.now() - startTime,
    };
  }
}

export const readinessGateService = new ReadinessGateService();
