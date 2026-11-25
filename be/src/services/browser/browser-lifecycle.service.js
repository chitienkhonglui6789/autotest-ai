import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { logger } from "../../utils/logger.js";

const SYSTEM_BROWSER_PATHS = [
  process.env.CHROME_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export class BrowserLifecycleService {
  constructor() {
    this._activeBrowsers = new Set();
  }

  get activeBrowsers() {
    return this._activeBrowsers;
  }

  /**
   * Tự động phát hiện trình duyệt Chrome / Edge sẵn có trên máy nếu Playwright Chromium chưa tải
   */
  resolveSystemBrowserExecutable() {
    for (const candidate of SYSTEM_BROWSER_PATHS) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Khởi chạy instance trình duyệt Chromium nguyên bản (100% Native Playwright, không qua Stagehand)
   */
  async launch(config, { storageStatePath = null, persistSession = false } = {}) {
    logger.info(
      `Khởi chạy trình duyệt Playwright gốc (headless: ${config.browser.headless}, sessionMode: ${persistSession ? "persist" : "fresh"})...`
    );
    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--ignore-certificate-errors",
      "--ignore-certificate-errors-spki-list",
      "--allow-insecure-localhost",
      "--allow-running-insecure-content",
    ];

    const baseLaunchOptions = {
      headless: config.browser.headless,
      chromiumSandbox: false,
      args: browserArgs,
    };

    let browser = null;
    const systemExe = this.resolveSystemBrowserExecutable();

    try {
      if (systemExe) {
        browser = await chromium.launch({
          ...baseLaunchOptions,
          executablePath: systemExe,
        });
      } else {
        browser = await chromium.launch(baseLaunchOptions);
      }
    } catch (firstErr) {
      logger.warn(`Thử khởi chạy trình duyệt mặc định thất bại (${firstErr.message}), chuyển sang channel Chrome/Edge...`);
      try {
        browser = await chromium.launch({ ...baseLaunchOptions, channel: "chrome" });
      } catch {
        browser = await chromium.launch({ ...baseLaunchOptions, channel: "msedge" });
      }
    }

    if (browser) {
      this._activeBrowsers.add(browser);
    }

    const contextOptions = {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: true,
      acceptDownloads: true,
      permissions: [],
    };

    if (persistSession && storageStatePath && fs.existsSync(storageStatePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(storageStatePath, "utf-8"));
        if (parsed && typeof parsed === "object") {
          contextOptions.storageState = parsed;
          logger.info(`[Session Persistence] Đã nạp storageState từ "${path.basename(storageStatePath)}"`);
        }
      } catch (stateErr) {
        logger.warn(`[Session Persistence] Bỏ qua file storageState lỗi (${stateErr.message})`);
      }
    }

    const context = await browser.newContext(contextOptions);

    // Tầng 1 (Phòng bệnh): Chặn các khung Toast / Thông báo nổi phổ biến cản trở sự kiện chuột
    // Lưu ý: chỉ đặt pointer-events: none để chuột xuyên qua, vẫn giữ nguyên hiển thị cho Assert & Ảnh chụp màn hình
    await context.addInitScript(() => {
      const injectToastPassThroughStyle = () => {
        try {
          if (document.getElementById("__at_toast_passthrough_style__")) return;
          const style = document.createElement("style");
          style.id = "__at_toast_passthrough_style__";
          style.textContent = `
            .Toastify__toast-container,
            .Toastify__toast,
            .ant-message,
            .ant-message-notice,
            .ant-notification,
            .ant-notification-notice,
            .el-message,
            .el-notification,
            .MuiSnackbar-root,
            .notistack-SnackbarContainer,
            [data-sonner-toaster],
            .vue-notification-group,
            .toast-container {
              pointer-events: none !important;
            }
          `;
          (document.head || document.documentElement).appendChild(style);
        } catch {}
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectToastPassThroughStyle, { once: true });
      } else {
        injectToastPassThroughStyle();
      }
    });

    const page = await context.newPage();

    return { browser, context, page };
  }

  /**
   * Thiết lập Viewport chuẩn và làm sạch dữ liệu phiên (hoặc giữ nguyên nếu persistSession)
   */
  async setupCleanSession(context, targetPage, { persistSession = false } = {}) {
    if (!targetPage || targetPage.isClosed?.()) return;

    try {
      await targetPage.setViewportSize({ width: 1280, height: 800 });
    } catch (vpErr) {
      logger.debug("Bỏ qua lỗi setViewportSize:", vpErr.message);
    }

    if (persistSession) {
      logger.info("[Session Persistence] Giữ nguyên cookies & web storage của phiên đăng nhập");
      return;
    }

    try {
      await context?.clearCookies();
      await targetPage.evaluate(() => {
        try { localStorage.clear(); } catch {}
        try { sessionStorage.clear(); } catch {}
      });
      logger.info("Đã làm sạch cookies & web storage cho phiên kiểm thử độc lập");
    } catch (cleanErr) {
      logger.debug("Bỏ qua lỗi làm sạch session:", cleanErr.message);
    }
  }

  /**
   * Lưu lại trạng thái đăng nhập (cookies + localStorage/origins) xuống tệp storageState
   */
  async saveStorageState(context, storageStatePath) {
    if (!context || !storageStatePath) return false;
    try {
      fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
      await context.storageState({ path: storageStatePath });
      logger.info(`[Session Persistence] Đã lưu storageState cập nhật vào "${path.basename(storageStatePath)}"`);
      return true;
    } catch (err) {
      logger.warn(`[Session Persistence] Không thể lưu storageState: ${err.message}`);
      return false;
    }
  }

  /**
   * Đóng an toàn Context và Browser instance (có timeout 3s)
   */
  async closeInstances(context, browser) {
    if (browser) {
      this._activeBrowsers.delete(browser);
    }

    const closeWork = async () => {
      try {
        await context?.close();
      } catch (err) {
        logger.debug("Lỗi khi đóng context:", err.message);
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
}

export const browserLifecycleService = new BrowserLifecycleService();
