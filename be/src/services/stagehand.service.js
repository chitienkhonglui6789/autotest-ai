import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/env.js";
import { toUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { executeStagehandLlmCall } from "./stagehand-adapter.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Danh mục phân loại lỗi kiểm thử tiêu chuẩn Enterprise (Failure Taxonomy)
 */
export const FAILURE_TYPES = Object.freeze({
  ASSERTION_FAILED: "ASSERTION_FAILED",     // Lỗi sai lệch kết quả thực tế vs kỳ vọng
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",   // Không tìm thấy phần tử DOM tương tác
  TIMEOUT: "TIMEOUT",                       // Hết thời gian tải trang hoặc thao tác
  EXECUTION_ERROR: "EXECUTION_ERROR",       // Lỗi môi trường thực thi hoặc trình duyệt
});

/**
 * Làm nổi bật phần tử bằng viền đỏ dày, bao trọn vẹn 4 cạnh và không bị cắt bởi overflow
 */
async function highlightElement(page, selector) {
  try {
    return await page.evaluate((sel) => {
      let el;
      if (sel.startsWith("xpath=")) {
        const xpath = sel.replace(/^xpath=/, "");
        el = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
      } else {
        el = document.querySelector(sel);
      }
      if (!el) return false;

      // 1. Cuộn phần tử vào giữa màn hình
      el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();

      // 2. Tạo một overlay cố định gắn trực tiếp vào body (z-index cao nhất để không bao giờ bị overflow cắt)
      let overlay = document.getElementById("__autotest_highlight_overlay__");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "__autotest_highlight_overlay__";
        document.body.appendChild(overlay);
      }

      overlay.style.position = "fixed";
      overlay.style.top = `${rect.top - 4}px`;
      overlay.style.left = `${rect.left - 4}px`;
      overlay.style.width = `${rect.width + 8}px`;
      overlay.style.height = `${rect.height + 8}px`;
      overlay.style.border = "4px solid #dc2626"; // Viền đỏ dày nổi bật
      overlay.style.borderRadius = "6px";
      overlay.style.boxShadow = "0 0 0 2px #ffffff, 0 0 22px rgba(220, 38, 38, 0.9)";
      overlay.style.zIndex = "2147483647";
      overlay.style.pointerEvents = "none";
      overlay.style.boxSizing = "border-box";
      overlay.style.display = "block";

      // 3. Phủ thêm viền trong (inset outline) trực tiếp lên phần tử để đảm bảo cả 4 cạnh đều đỏ rực
      el.setAttribute("data-autotest-highlight", "true");
      el.dataset.prevOutline = el.style.outline || "";
      el.dataset.prevOffset = el.style.outlineOffset || "";
      el.style.setProperty("outline", "3px solid #dc2626", "important");
      el.style.setProperty("outline-offset", "-3px", "important");

      return true;
    }, selector);
  } catch {
    return false;
  }
}

/**
 * Xóa hiệu ứng làm nổi bật phần tử
 */
async function clearHighlight(page, selector) {
  try {
    await page.evaluate((sel) => {
      // 1. Xóa overlay trên body
      const overlay = document.getElementById("__autotest_highlight_overlay__");
      if (overlay) {
        overlay.remove();
      }

      // 2. Phục hồi style của phần tử
      let el;
      if (sel && sel.startsWith("xpath=")) {
        const xpath = sel.replace(/^xpath=/, "");
        el = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
      } else if (sel) {
        el = document.querySelector(sel);
      }
      if (el && el.getAttribute("data-autotest-highlight") === "true") {
        el.style.outline = el.dataset.prevOutline || "";
        el.style.outlineOffset = el.dataset.prevOffset || "";
        el.removeAttribute("data-autotest-highlight");
      }
    }, selector);
  } catch {}
}

export class StagehandService {
  constructor(customConfig = config) {
    this.config = customConfig;
    this._activeBrowsers = new Set();
  }

  /**
   * Đóng an toàn cả Stagehand và browser instance (có giới hạn timeout 3s chống treo CDP)
   */
  async closeInstances(stagehand, browser) {
    if (browser) {
      this._activeBrowsers.delete(browser);
    }

    const closeWork = async () => {
      try {
        await stagehand?.close();
      } catch (err) {
        logger.debug("Lỗi khi đóng stagehand:", err.message);
      }
      try {
        await browser?.close();
      } catch (err) {
        logger.debug("Lỗi khi đóng browser:", err.message);
      }
    };

    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    await Promise.race([closeWork(), timeout]);
  }

  /**
   * Cưỡng chế dọn dẹp sạch toàn bộ các browser instance còn tồn tại (Zombie cleanup)
   */
  async destroyAll() {
    if (this._activeBrowsers.size === 0) return;
    logger.info(`Đang thu hồi ${this._activeBrowsers.size} tiến trình trình duyệt còn sót...`);
    const promises = Array.from(this._activeBrowsers).map(async (b) => {
      try {
        await b.close();
      } catch (e) {
        logger.debug("Lỗi khi ép đóng browser instance:", e.message);
      }
    });
    this._activeBrowsers.clear();
    const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
    await Promise.race([Promise.all(promises), timeout]);
  }

  /**
   * Gọi LLM nội bộ dùng chung cho Stagehand (ClientLLM handler)
   * Ủy quyền cho module StagehandLLMAdapter để chuẩn hóa, tự phục hồi schema và tối ưu hiệu năng
   */
  async callUnifiedLLM(params) {
    return executeStagehandLlmCall(this.config, params);
  }

  /**
   * Chạy danh sách bước test tự động trên trình duyệt
   *
   * @param {Array<{ type: string, text: string }>} steps
   * @param {Record<string, string>} [variables]
   * @param {object} result - Đối tượng gom kết quả chạy
   * @param {AbortSignal} [signal] - Tín hiệu hủy khi client ngắt kết nối
   * @returns {Promise<void>}
   */
  async runSteps(steps, variables, result, signal = null) {
    let browser = null;
    let stagehand = null;
    let timeoutTimer = null;
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      logger.warn("Stagehand nhận tín hiệu Abort (client ngắt kết nối/hủy). Đang đóng browser ngay lập tức...");
      this.closeInstances(stagehand, browser).catch(() => {});
    };

    if (signal) {
      if (signal.aborted) {
        result.status = "failed";
        result.error = "Phiên kiểm thử đã bị hủy";
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const runWorker = async () => {
      logger.info(`Khởi chạy trình duyệt (headless: ${this.config.browser.headless})...`);
      const browserArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ];
      browser = await localBrowser.launch({
        headless: this.config.browser.headless,
        chromiumSandbox: false,
        args: browserArgs,
      });
      if (browser) {
        this._activeBrowsers.add(browser);
      }

      // Cấu hình Model cho Stagehand:
      // - Nếu người dùng chỉ định STAGEHAND_MODEL có tiền tố nhà cung cấp đám mây (vd: groq/..., openai/...) -> Dùng model đám mây riêng
      // - Ngược lại (mặc định cho on-premise/offline) -> Dùng chung endpoint local (LLM_BASE_URL, LLM_MODEL) qua ClientLLM
      const stagehandModelConfig =
        this.config.stagehand.modelName && /^(openai|anthropic|google|groq|cerebras)\//.test(this.config.stagehand.modelName)
          ? {
              modelName: this.config.stagehand.modelName,
              apiKey: this.config.stagehand.apiKey,
            }
          : {
              generate: (params) => this.callUnifiedLLM(params),
            };

      stagehand = await Stagehand.create({
        browser,
        model: stagehandModelConfig,
      });

      if (aborted || signal?.aborted) {
        await this.closeInstances(stagehand, browser);
        return;
      }

      const pages = await browser.context.pages();
      const page = pages.length > 0 ? pages[0] : await browser.context.newPage();
      if (!page) {
        throw new Error("Không thể khởi tạo trang web");
      }

      // Cấu hình viewport cố định 1280x800 và deviceScaleFactor: 2 cho ảnh rõ nét
      try {
        await page.setViewportSize(1280, 800, { deviceScaleFactor: 2 });
        logger.info("Đã cấu hình viewport 1280x800 và deviceScaleFactor: 2");
      } catch (vpErr) {
        logger.warn("Không thể thiết lập viewport 1280x800 @ 2x:", vpErr.message);
      }

      // Đảm bảo môi trường kiểm thử cách ly (Clean Session / Incognito Isolation)
      try {
        await browser.context.clearCookies();
        await page.evaluate(() => {
          try { localStorage.clear(); } catch(e){}
          try { sessionStorage.clear(); } catch(e){}
        });
        logger.info("Đã làm sạch cookies & web storage cho phiên kiểm thử độc lập");
      } catch (cleanErr) {
        logger.debug("Bỏ qua lỗi làm sạch session:", cleanErr.message);
      }

      const runId = result.id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      result.id = runId;
      const runScreenshotsDir = path.resolve(__dirname, "../../screenshots", runId);
      try {
        await fs.promises.mkdir(runScreenshotsDir, { recursive: true });
      } catch (dirErr) {
        logger.warn("Không thể tạo thư mục lưu ảnh chụp màn hình:", dirErr.message);
      }

      for (const [i, s] of steps.entries()) {
        if (aborted) return;

        const step = {
          index: i + 1,
          type: s.type,
          text: s.text,
          status: "running",
          message: "",
          durationMs: 0,
          screenshots: [],
        };
        result.steps.push(step);

        const takeShot = async (suffix, meta = {}) => {
          try {
            const filename = `step-${i + 1}-${suffix}.png`;
            const filePath = path.join(runScreenshotsDir, filename);
            await page.screenshot({ path: filePath, type: "png" });
            const url = `/screenshots/${runId}/${filename}`;
            const shot = {
              type: suffix,
              label: meta.label || (suffix === "before" ? "Trước khi thực hiện" : "Sau khi thực hiện"),
              sublabel: meta.sublabel || (suffix === "before" ? "Tiêu điểm tương tác" : "Kết quả giao diện"),
              url,
            };
            step.screenshots.push(shot);
            step.screenshotUrl = url;
            logger.info(`Đã lưu ảnh chụp bước ${i + 1} (${suffix}): ${url}`);
            return shot;
          } catch (shotErr) {
            logger.warn(`Bỏ qua lỗi chụp màn hình bước ${i + 1} (${suffix}):`, shotErr.message);
            return null;
          }
        };

        const t0 = Date.now();
        try {
          if (s.type === "goto") {
            const url = toUrl(s.text);
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: this.config.timeouts.gotoMs,
            });
            await page.waitForTimeout(500);
            step.status = "passed";
            step.message = `đã mở ${url}`;
            await takeShot("view", {
              label: "Giao diện trang",
              sublabel: `Tải thành công ${url}`,
            });

          } else if (s.type === "act") {
            // Khoảnh khắc 1: TRƯỚC KHI HÀNH ĐỘNG
            // Tìm và highlight phần tử mục tiêu
            let targetSelector = null;
            try {
              const obs = await stagehand.observe(s.text);
              const target = obs?.data?.[0];
              if (target?.selector) {
                targetSelector = target.selector;
                await highlightElement(page, targetSelector);
                await page.waitForTimeout(100);
              }
            } catch (obsErr) {
              logger.debug("Bỏ qua lỗi observe định vị trước:", obsErr.message);
            }

            // Chụp ảnh TRƯỚC (có highlight nếu tìm thấy phần tử)
            await takeShot("before", {
              label: "Trước khi thực hiện",
              sublabel: targetSelector ? "Tiêu điểm tương tác (đã highlight)" : "Trạng thái trước thao tác",
            });

            // Xóa highlight trước khi thực hiện hành động
            if (targetSelector) {
              await clearHighlight(page, targetSelector);
            }

            // Thực hiện hành động
            const opts = { timeout: this.config.timeouts.stepMs };
            if (variables) opts.variables = variables;
            const r = await stagehand.act(s.text, opts);
            const d = r?.data || r;
            step.status = d?.success ? "passed" : "failed";
            if (step.status === "failed") {
              const msg = d?.message || "";
              step.failureType = (msg.includes("No action found") || msg.toLowerCase().includes("not found"))
                ? FAILURE_TYPES.ELEMENT_NOT_FOUND
                : FAILURE_TYPES.EXECUTION_ERROR;
              step.message = msg ? `Không thể thực hiện: ${msg}` : "Không tìm thấy phần tử phù hợp trên trang web để tương tác";
            } else {
              step.message = d?.message || "thao tác thành công";
            }

            // Kiểm tra cảnh báo / lỗi toàn cục sau khi hành động (Global Alert Detection)
            try {
              const detectedAlert = await page.evaluate(() => {
                const alertEl = document.querySelector('[role="alert"], [data-test="error"], .alert-danger, .error-message-container:not(:empty)');
                if (alertEl && alertEl.offsetParent !== null) {
                  return alertEl.innerText?.trim() || null;
                }
                return null;
              });
              if (detectedAlert) {
                step.detectedAlert = detectedAlert;
                logger.info(`Ghi nhận cảnh báo giao diện sau thao tác bước ${i + 1}: "${detectedAlert}"`);
              }
            } catch {}

            // Khoảnh khắc 2: SAU KHI HÀNH ĐỘNG (đợi UI cập nhật)
            await page.waitForTimeout(600);
            await takeShot(step.status === "passed" ? "after" : "error", {
              label: step.status === "passed" ? "Sau khi thực hiện" : "Khi gặp lỗi",
              sublabel: step.status === "passed" ? "Giao diện đã cập nhật" : (step.detectedAlert || "Trạng thái thất bại"),
            });

          } else if (s.type === "observe") {
            const r = await stagehand.observe(s.text);
            const d = r?.data ?? r;
            const count = Array.isArray(d) ? d.length : 0;

            // Kiểm tra mâu thuẫn ngữ nghĩa: kỳ vọng thành công nhưng phần tử phát hiện lại là thông báo lỗi/thất bại
            const isAssertingSuccess = /(success|succeed|logged[- ]?in|đăng nhập thành công|thành công|hoàn tất)/i.test(s.text);
            const isErrorElement = count > 0 && d[0]?.description && /(error|fail|failure|invalid|do not match|mismatch|denied|wrong|alert indicating)/i.test(d[0].description);

            if (count > 0 && isAssertingSuccess && isErrorElement) {
              step.status = "failed";
              step.failureType = FAILURE_TYPES.ASSERTION_FAILED;
              step.message = `Phát hiện lỗi trên giao diện: "${d[0].description}". Điều kiện kiểm tra không thỏa mãn!`;
            } else if (count === 0) {
              step.status = "failed";
              step.failureType = isAssertingSuccess ? FAILURE_TYPES.ASSERTION_FAILED : FAILURE_TYPES.ELEMENT_NOT_FOUND;
              step.message = "Không tìm thấy phần tử nào khớp với mô tả trên trang web";
            } else {
              step.status = "passed";
              step.message = `tìm thấy ${count} phần tử, đầu tiên: ${d[0]?.description ?? "?"}`;
            }

            if (count > 0 && d[0]?.selector) {
              await highlightElement(page, d[0].selector);
              await page.waitForTimeout(100);
              await takeShot(step.status === "passed" ? "view" : "error", {
                label: step.status === "passed" ? "Phần tử tìm thấy" : "Lỗi phát hiện trên màn hình",
                sublabel: d[0].description || (step.status === "passed" ? "Đã highlight phần tử" : "Phát hiện lỗi"),
              });
              await clearHighlight(page, d[0].selector);
            } else {
              await takeShot(step.status === "passed" ? "view" : "error", {
                label: step.status === "passed" ? "Kết quả kiểm tra" : "Không tìm thấy",
              });
            }

          } else {
            // type: extract
            const schema = z.object({
              value: z.string().describe("the value read from the page, exactly as displayed"),
            });
            const r = await stagehand.extract(s.text, schema);
            const d = r?.data ?? r;
            if (d?.value !== undefined && d?.value !== null && d?.value !== "") {
              step.value = d.value;
              
              // Trích xuất giá trị kỳ vọng trong câu lệnh (nếu có nháy đơn/kép hoặc từ khóa so sánh)
              const quoteMatch = s.text.match(/['"“]([^'"”]+)['"”]/);
              const expectedValue = quoteMatch ? quoteMatch[1].trim() : null;

              if (expectedValue && !d.value.toLowerCase().includes(expectedValue.toLowerCase())) {
                step.status = "failed";
                step.failureType = FAILURE_TYPES.ASSERTION_FAILED;
                step.message = `Giá trị thực tế "${d.value}" KHÔNG khớp với giá trị kỳ vọng "${expectedValue}"`;
              } else {
                step.status = "passed";
                step.message = expectedValue
                  ? `Xác thực thành công: giá trị "${d.value}" khớp với kỳ vọng "${expectedValue}"`
                  : `đọc được nội dung: "${d.value}"`;
              }
            } else {
              step.status = "failed";
              step.failureType = FAILURE_TYPES.ELEMENT_NOT_FOUND;
              step.message = "Không đọc được dữ liệu phù hợp từ trang web";
            }
            await takeShot(step.status === "passed" ? "view" : "error", {
              label: step.status === "passed" ? "Dữ liệu trích xuất" : "Lỗi đọc dữ liệu",
              sublabel: step.value ? `"${step.value}"` : undefined,
            });
          }
        } catch (e) {
          step.status = "failed";
          const rawMsg = e.message || String(e);
          if (rawMsg.includes("Timeout") && rawMsg.includes("page.goto")) {
            step.failureType = FAILURE_TYPES.TIMEOUT;
            step.message = `Hết thời gian tải trang: ${rawMsg}`;
          } else if (rawMsg.includes("CDP")) {
            step.failureType = FAILURE_TYPES.EXECUTION_ERROR;
            step.message = `Lỗi kết nối Chrome/CDP: ${rawMsg}`;
          } else if (
            rawMsg.toLowerCase().includes("not found") ||
            rawMsg.toLowerCase().includes("element") ||
            rawMsg.toLowerCase().includes("selector")
          ) {
            step.failureType = FAILURE_TYPES.ELEMENT_NOT_FOUND;
            step.message = `Không tìm thấy phần tử trên trang web: ${rawMsg}`;
          } else {
            step.failureType = FAILURE_TYPES.EXECUTION_ERROR;
            step.message = `${e.name || "Lỗi"}: ${rawMsg}`;
          }

          if (step.screenshots.length === 0 || step.screenshots[step.screenshots.length - 1].type !== "error") {
            await takeShot("error", {
              label: "Khi gặp lỗi",
              sublabel: step.message,
            });
          }
        }

        step.durationMs = Date.now() - t0;

        // Dừng tại bước đầu tiên không passed
        if (step.status !== "passed") {
          if (!aborted) {
            result.status = "failed";
            result.failureType = step.failureType;
            result.error = step.message;
          }
          return;
        }
      }

      if (!aborted) {
        result.status = "passed";
      }
    };

    const workPromise = runWorker();
    // Bắt rejection ngầm nếu worker chạy dở sau khi timeout
    workPromise.catch(() => {});

    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        aborted = true;
        reject(new Error(`Quá thời gian tối đa ${this.config.timeouts.runMs / 1000}s`));
      }, this.config.timeouts.runMs);
    });

    try {
      await Promise.race([workPromise, timeoutPromise]);
    } catch (e) {
      result.status = "failed";
      result.error = `${e.name}: ${e.message}`;
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      await this.closeInstances(stagehand, browser);
      result.finishedAt = new Date().toISOString();
    }
  }
}

export const stagehandService = new StagehandService();

