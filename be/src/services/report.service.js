import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms) {
  if (typeof ms !== "number" || isNaN(ms)) return "0s";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString || "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return isoString || "";
  }
}

/**
 * Đọc file ảnh từ đĩa và chuyển thành base64 data URL
 */
async function getBase64DataUrl(relativeUrl) {
  if (!relativeUrl) return "";
  if (relativeUrl.startsWith("data:")) return relativeUrl;

  try {
    let cleanPath = relativeUrl;
    if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
      try {
        const u = new URL(relativeUrl);
        cleanPath = u.pathname;
      } catch {}
    }
    cleanPath = cleanPath.replace(/^\/+/, "");

    const candidatePaths = [
      path.resolve(process.cwd(), cleanPath),
      path.resolve(process.cwd(), "be", cleanPath),
      path.resolve(process.cwd(), "..", cleanPath),
      path.resolve(process.cwd(), "screenshots", path.basename(cleanPath)),
    ];

    let buffer = null;
    for (const p of candidatePaths) {
      try {
        buffer = await fs.readFile(p);
        break;
      } catch {}
    }

    if (buffer) {
      return `data:image/png;base64,${buffer.toString("base64")}`;
    }
    return relativeUrl;
  } catch (err) {
    logger.warn(`Không thể đọc ảnh ${relativeUrl} để nhúng base64:`, err.message);
    return relativeUrl;
  }
}

export class ReportService {
  /**
   * Tạo tệp HTML báo cáo độc lập (Standalone HTML Report)
   * Nhúng sẵn toàn bộ CSS, JS và ảnh Base64
   * Hỗ trợ cả Đợt chạy kiểm thử (Batch Run) lẫn Phiên chạy đơn lẻ (Single Run)
   */
  async generateHtmlReport(run) {
    if (!run) throw new Error("run data không hợp lệ");

    const isBatch = Array.isArray(run.features) && run.features.length > 0;
    const reportTitle = run.name || run.featureName || "Báo cáo kiểm thử tự động";
    const projectName = run.projectName || "Mặc định";
    const formattedDate = formatTime(run.startedAt || run.timestamp);

    let totalFeatures = 0;
    let passedFeatures = 0;
    let failedFeatures = 0;
    let totalSteps = 0;
    let passedSteps = 0;
    let failedSteps = 0;
    let totalImagesCount = 0;
    let isPassedOverall = false;
    let durationMs = run.durationMs || run.duration || 0;

    // Chuẩn bị dữ liệu danh sách tính năng và bước kiểm thử
    const processedFeatures = [];

    if (isBatch) {
      totalFeatures = run.features.length;

      for (const feat of run.features) {
        const featStatus = (feat.status || "PASSED").toUpperCase();
        const featPassed = featStatus === "PASSED";
        if (featPassed) passedFeatures++;
        else failedFeatures++;

        const rawSteps = Array.isArray(feat.stepResults) && feat.stepResults.length > 0
          ? feat.stepResults
          : (Array.isArray(feat.steps) && typeof feat.steps[0] === "object" ? feat.steps : []);

        const processedSteps = [];

        for (const st of rawSteps) {
          totalSteps++;
          const stStatus = (st.status || "passed").toLowerCase();
          const stPassed = stStatus === "passed";
          if (stPassed) passedSteps++;
          else failedSteps++;

          const shots = [];
          const rawShots = Array.isArray(st.screenshots) && st.screenshots.length > 0
            ? st.screenshots
            : (st.screenshotUrl ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }] : []);

          for (const shot of rawShots) {
            const base64Url = await getBase64DataUrl(shot.url);
            shots.push({
              ...shot,
              base64Url,
            });
            totalImagesCount++;
          }

          processedSteps.push({
            ...st,
            status: stStatus,
            screenshots: shots,
          });
        }

        processedFeatures.push({
          id: feat.id,
          name: feat.name || "Tính năng",
          status: featStatus,
          durationMs: feat.durationMs || 0,
          error: feat.error || null,
          steps: processedSteps,
          rawStepStrings: Array.isArray(feat.steps) && typeof feat.steps[0] === "string" ? feat.steps : [],
        });
      }

      isPassedOverall = failedFeatures === 0 && totalFeatures > 0;
      if (!durationMs && run.startedAt && run.finishedAt) {
        const diff = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
        if (diff > 0) durationMs = diff;
      }
      if (!durationMs) {
        durationMs = processedFeatures.reduce((acc, f) => acc + (f.durationMs || 0), 0);
      }
    } else {
      // Phiên chạy đơn lẻ (Single Run)
      const rawSteps = Array.isArray(run.steps) ? run.steps : [];
      totalSteps = rawSteps.length;
      totalFeatures = 1;

      const processedSteps = [];
      for (const st of rawSteps) {
        const stStatus = (st.status || "passed").toLowerCase();
        const stPassed = stStatus === "passed";
        if (stPassed) passedSteps++;
        else failedSteps++;

        const shots = [];
        const rawShots = Array.isArray(st.screenshots) && st.screenshots.length > 0
          ? st.screenshots
          : (st.screenshotUrl ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }] : []);

        for (const shot of rawShots) {
          const base64Url = await getBase64DataUrl(shot.url);
          shots.push({
            ...shot,
            base64Url,
          });
          totalImagesCount++;
        }

        processedSteps.push({
          ...st,
          status: stStatus,
          screenshots: shots,
        });
      }

      isPassedOverall = run.status === "passed" || (failedSteps === 0 && totalSteps > 0);
      if (isPassedOverall) passedFeatures = 1;
      else failedFeatures = 1;

      processedFeatures.push({
        id: run.id,
        name: reportTitle,
        status: isPassedOverall ? "PASSED" : "FAILED",
        durationMs: durationMs,
        error: run.error || null,
        steps: processedSteps,
        rawStepStrings: [],
      });
    }

    const formattedDuration = formatDuration(durationMs);
    const passRate = totalFeatures > 0 ? Math.round((passedFeatures / totalFeatures) * 100) : 0;

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Báo cáo kiểm thử - ${escapeHtml(reportTitle)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #030712;
      color: #f3f4f6;
      line-height: 1.5;
      padding: 32px 16px;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    .card {
      background-color: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      font-size: 13px;
      font-weight: 600;
      color: #818cf8;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: #94a3b8;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .badge-passed {
      background-color: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }
    .badge-failed {
      background-color: rgba(244, 63, 94, 0.15);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.4);
    }
    .badge-feature {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid #1e293b;
    }
    .kpi-box {
      background-color: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .kpi-label {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .kpi-value {
      font-size: 15px;
      font-weight: 700;
      color: #f8fafc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .notes-box {
      background-color: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 16px;
      font-size: 12px;
      color: #cbd5e1;
    }
    .notes-label {
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .feature-card {
      background-color: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .feature-header {
      padding: 16px 20px;
      background-color: rgba(15, 23, 42, 0.9);
      border-bottom: 1px solid #1e293b;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .feature-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .feature-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .feature-content {
      padding: 20px;
    }
    .step-item {
      background-color: #090d16;
      border: 1px solid #1e293b;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .step-item:last-child {
      margin-bottom: 0;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .step-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      flex: 1;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background-color: #1e293b;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: #cbd5e1;
      shrink: 0;
    }
    .step-type {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .type-navigate { background: rgba(14, 165, 233, 0.15); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.3); }
    .type-act { background: rgba(129, 140, 248, 0.15); color: #818cf8; border: 1px solid rgba(129, 140, 248, 0.3); }
    .type-assert { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .type-view { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .step-text {
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      word-break: break-word;
    }
    .step-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .step-time {
      font-size: 11px;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .step-status {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .status-passed { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .status-failed { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
    .error-box {
      background-color: rgba(136, 19, 55, 0.25);
      border: 1px solid rgba(225, 29, 72, 0.4);
      border-radius: 6px;
      padding: 10px 14px;
      color: #fda4af;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      margin-top: 10px;
      margin-bottom: 12px;
    }
    .shots-container {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      padding-top: 12px;
      border-top: 1px solid #1e293b;
      margin-top: 12px;
    }
    .shot-card {
      background-color: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      overflow: hidden;
      width: 240px;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .shot-card:hover {
      transform: scale(1.02);
      border-color: #818cf8;
    }
    .shot-header {
      padding: 6px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      background-color: #1e293b;
      border-bottom: 1px solid #334155;
    }
    .shot-tag {
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .tag-before { background: rgba(129, 140, 248, 0.2); color: #a5b4fc; }
    .tag-after { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }
    .tag-error { background: rgba(244, 63, 94, 0.2); color: #fda4af; }
    .tag-view { background: rgba(14, 165, 233, 0.2); color: #7dd3fc; }
    .shot-sub {
      color: #94a3b8;
      font-size: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 140px;
    }
    .shot-img-wrapper {
      width: 240px;
      height: 150px;
      overflow: hidden;
      background-color: #000000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .shot-img-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .arrow-divider {
      font-size: 18px;
      color: #818cf8;
      font-weight: bold;
    }
    .lightbox-modal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .lightbox-modal.active {
      display: flex;
    }
    .lightbox-content {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #334155;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .lightbox-content img {
      max-width: 100%;
      max-height: 85vh;
      display: block;
    }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 24px;
      background: #1e293b;
      color: #fff;
      border: 1px solid #475569;
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
    }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #64748b;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #1e293b;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header Thông tin phiên chạy -->
    <div class="card">
      <div class="header-top">
        <div>
          <div class="brand">🧪 AUTOTEST STUDIO · BÁO CÁO THỰC THI KIỂM THỬ</div>
          <h1 class="title">${escapeHtml(reportTitle)}</h1>
          <div class="subtitle">Dự án: ${escapeHtml(projectName)} · Mã phiên: ${escapeHtml(run.id)}</div>
        </div>
        <div>
          <span class="badge ${isPassedOverall ? "badge-passed" : "badge-failed"}">
            ${isPassedOverall ? "✓ PASSED (THÀNH CÔNG)" : "✕ FAILED (CÓ THẤT BẠI)"}
          </span>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-label">Thời gian bắt đầu</div>
          <div class="kpi-value">${formattedDate}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Tổng thời lượng</div>
          <div class="kpi-value">${formattedDuration}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Tỷ lệ Đạt (Tính năng)</div>
          <div class="kpi-value">${passedFeatures}/${totalFeatures} (${passRate}%)</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Tiến độ các bước</div>
          <div class="kpi-value">${passedSteps}/${totalSteps} Đạt</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Bằng chứng thị giác</div>
          <div class="kpi-value">${totalImagesCount} ảnh (Base64)</div>
        </div>
      </div>

      ${run.notes ? `
        <div class="notes-box">
          <div class="notes-label">Ghi chú đợt chạy:</div>
          <div>${escapeHtml(run.notes)}</div>
        </div>
      ` : ""}
    </div>

    <!-- Danh sách các tính năng và bước thực thi -->
    <div class="section-title">
      <span>📋 Chi tiết kết quả kiểm thử (${processedFeatures.length} tính năng)</span>
    </div>

    ${processedFeatures.map((feat, featIdx) => {
      const featPassed = feat.status === "PASSED";
      return `
      <div class="feature-card">
        <div class="feature-header">
          <div class="feature-title">
            <span style="color: #818cf8;">#${featIdx + 1}</span>
            <span>${escapeHtml(feat.name)}</span>
          </div>
          <div class="feature-meta">
            <span>${formatDuration(feat.durationMs)}</span>
            <span class="badge-feature ${featPassed ? "badge-passed" : "badge-failed"}">
              ${featPassed ? "✓ ĐẠT" : "✕ LỖI"}
            </span>
          </div>
        </div>

        <div class="feature-content">
          ${feat.error ? `
            <div class="error-box">
              <strong>Lỗi tính năng:</strong> ${escapeHtml(feat.error)}
            </div>
          ` : ""}

          ${feat.steps.length === 0 ? `
            <div style="font-size:12px; color:#64748b; font-style:italic;">
              Chưa có dữ liệu bước kiểm thử chi tiết.
            </div>
          ` : feat.steps.map((st, stepIdx) => {
            const stPassed = st.status === "passed";
            const stType = (st.type || "act").toLowerCase();
            const isNav = stType === "navigate" || stType === "goto";
            const isAssert = stType === "assert" || stType === "observe";
            const isView = stType === "view";
            const typeClass = isNav ? "type-navigate" : isAssert ? "type-assert" : isView ? "type-view" : "type-act";
            const typeName = isNav ? "Điều hướng" : isAssert ? "Kiểm tra" : isView ? "Giao diện" : "Hành động";

            return `
            <div class="step-item">
              <div class="step-header">
                <div class="step-left">
                  <span class="step-num">${stepIdx + 1}</span>
                  <span class="step-type ${typeClass}">${typeName}</span>
                  <span class="step-text">${escapeHtml(st.text || st.step || "Thao tác")}</span>
                </div>
                <div class="step-right">
                  ${st.durationMs ? `<span class="step-time">${formatDuration(st.durationMs)}</span>` : ""}
                  <span class="step-status ${stPassed ? "status-passed" : "status-failed"}">
                    ${stPassed ? "Đạt" : "Lỗi"}
                  </span>
                </div>
              </div>

              ${!stPassed && (st.error || st.message) ? `
                <div class="error-box">
                  <strong>Lỗi:</strong> ${escapeHtml(st.error || st.message)}
                  ${st.detectedAlert ? `<div style="margin-top:6px; font-size:11px; color:#fca5a5;"><strong>Cảnh báo trên trang:</strong> ${escapeHtml(st.detectedAlert)}</div>` : ""}
                </div>
              ` : ""}

              ${st.screenshots && st.screenshots.length > 0 ? `
                <div class="shots-container">
                  ${st.screenshots.map((shot, shotIdx) => {
                    const isBefore = shot.type === "before";
                    const isError = shot.type === "error";
                    const isV = shot.type === "view";
                    const tagClass = isBefore ? "tag-before" : isError ? "tag-error" : isV ? "tag-view" : "tag-after";
                    const tagText = isBefore ? "Trước" : isError ? "Lỗi" : isV ? "Trang" : "Sau";
                    const subText = shot.sublabel || (isBefore ? "Tiêu điểm viền đỏ" : isV ? "Trang web" : "Kết quả tương tác");

                    return `
                    ${shotIdx > 0 ? `<span class="arrow-divider">→</span>` : ""}
                    <div class="shot-card" onclick="openLightbox('${shot.base64Url}')" title="Nhấp để phóng to">
                      <div class="shot-header">
                        <span class="shot-tag ${tagClass}">${tagText}</span>
                        <span class="shot-sub">${escapeHtml(subText)}</span>
                      </div>
                      <div class="shot-img-wrapper">
                        <img src="${shot.base64Url}" alt="${escapeHtml(shot.label || "Ảnh chụp")}" loading="lazy" />
                      </div>
                    </div>
                    `;
                  }).join("")}
                </div>
              ` : ""}
            </div>
            `;
          }).join("")}
        </div>
      </div>
      `;
    }).join("")}

    <div class="footer">
      Báo cáo được khởi tạo tự động bởi <strong>AutoTest Studio</strong> · Ngày xuất: ${formatTime(new Date().toISOString())}
    </div>
  </div>

  <!-- Lightbox Modal -->
  <div id="lightbox" class="lightbox-modal" onclick="closeLightbox()">
    <div class="lightbox-close" onclick="closeLightbox()">✕</div>
    <div class="lightbox-content" onclick="event.stopPropagation()">
      <img id="lightbox-img" src="" alt="Ảnh phóng to" />
    </div>
  </div>

  <script>
    function openLightbox(url) {
      if (!url) return;
      document.getElementById('lightbox-img').src = url;
      document.getElementById('lightbox').classList.add('active');
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('active');
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeLightbox();
    });
  </script>
</body>
</html>`;

    return html;
  }
}

export const reportService = new ReportService();
