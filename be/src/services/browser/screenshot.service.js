import path from "node:path";
import { logger } from "../../utils/logger.js";

/**
 * Thực hiện chụp ảnh màn hình có chuẩn hóa đồ họa & đồng bộ font
 */
export async function takeScreenshot(page, runScreenshotsDir, runId, stepIndex, suffix, meta = {}, config = {}) {
  try {
    if (!page || page.isClosed?.()) return null;

    const screenshotFormat = config.screenshots?.format || "jpeg";
    const screenshotQuality = config.screenshots?.quality || 80;
    const isFullPage = Boolean(config.screenshots?.fullPage || false);
    const screenshotExt = screenshotFormat === "png" ? "png" : "jpg";

    const seqPart = meta && meta.shotIndex ? `-${meta.shotIndex}` : "";
    const filename = `step-${stepIndex}${seqPart}-${suffix}.${screenshotExt}`;
    const filePath = path.join(runScreenshotsDir, filename);

    const customTimeoutMs = Number(meta?.timeoutMs);
    const evalTimeoutMs = Number.isFinite(customTimeoutMs) && customTimeoutMs > 0
      ? Math.min(customTimeoutMs, 300)
      : 600;
    const shotTimeoutMs = Number.isFinite(customTimeoutMs) && customTimeoutMs > 0
      ? Math.max(customTimeoutMs, 200)
      : Math.min(Math.max(Number(config.screenshots?.timeoutMs) || 3500, 500), 10000);

    // Đồng bộ trực quan trước khi chụp: Web fonts sẵn sàng & xả 2 khung hình render (bọc timeout tránh treo nếu navigation đang pending)
    let evalTimer = null;
    await Promise.race([
      page.evaluate(async () => {
        try {
          if (document.fonts && document.fonts.ready) {
            await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 400))]);
          }
          await new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          });
        } catch {}
      }),
      new Promise((resolve) => {
        evalTimer = setTimeout(resolve, evalTimeoutMs);
      }),
    ])
      .catch(() => {})
      .finally(() => {
        if (evalTimer) clearTimeout(evalTimer);
      });

    const shotOpts = {
      path: filePath,
      type: screenshotFormat === "png" ? "png" : "jpeg",
      animations: "disabled",
      fullPage: isFullPage,
      timeout: shotTimeoutMs,
    };
    if (shotOpts.type === "jpeg") {
      shotOpts.quality = screenshotQuality;
    }

    await page.screenshot(shotOpts);
    const url = `/screenshots/${runId}/${filename}`;
    const shot = {
      type: suffix,
      label: meta.label || (suffix === "before" ? "Trước khi thực hiện" : "Sau khi thực hiện"),
      sublabel: meta.sublabel || (suffix === "before" ? "Tiêu điểm tương tác" : "Kết quả giao diện"),
      url,
    };

    logger.info(`Đã lưu ảnh chụp bước ${stepIndex} (${suffix}): ${url}`);
    return shot;
  } catch (shotErr) {
    logger.warn(`Bỏ qua lỗi chụp màn hình bước ${stepIndex} (${suffix}):`, shotErr.message);
    return null;
  }
}

