import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  History,
  Loader2,
  CheckCircle2,
  X,
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  MinusCircle,
  Camera,
  Maximize2,
  Zap,
  Bot,
  Gauge,
} from "lucide-react";
import { API_BASE_URL, resolveAssetUrl } from "../../api/client.js";
import {
  formatTime,
  formatDuration,
  formatBatchDateTime,
  formatSublineTime,
  getDateGroupLabel,
  normalizeBatch,
} from "../../utils/formatters.js";
import { ScreenshotLightbox, ConfirmModal } from "../common/Modals.jsx";
import { ProjectModal } from "../modals/ProjectModal.jsx";
import { ProjectSelectorDropdown } from "./LibraryTab.jsx";

// ═══════════════════════════════════════════════════════════════════
// HÀM TẠO BÁO CÁO HTML ĐỘC LẬP CLIENT-SIDE (FALLBACK)
// ═══════════════════════════════════════════════════════════════════
const escapeHtmlReport = (str) => {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const generateClientSideHtmlReport = (batch, fallbackProjectName = "Mặc định") => {
  if (!batch) return "";
  const reportTitle = batch.name || "Báo cáo kiểm thử tự động";
  const projectName = batch.projectName || fallbackProjectName || "Mặc định";
  const formattedDate = formatTime(batch.startedAt);

  const features = Array.isArray(batch.features) ? batch.features : [];
  const totalFeatures = features.length;
  const passedFeatures = features.filter((f) => f.status === "PASSED" || f.status === "passed").length;
  const failedFeatures = totalFeatures - passedFeatures;
  const isPassedOverall = failedFeatures === 0 && totalFeatures > 0;
  const passRate = totalFeatures > 0 ? Math.round((passedFeatures / totalFeatures) * 100) : 0;

  let totalSteps = 0;
  let passedSteps = 0;
  let totalImagesCount = 0;

  for (const feat of features) {
    const rawSteps = Array.isArray(feat.stepResults) && feat.stepResults.length > 0
      ? feat.stepResults
      : (Array.isArray(feat.steps) && typeof feat.steps[0] === "object" ? feat.steps : []);

    for (const st of rawSteps) {
      totalSteps++;
      if (st.status === "passed") passedSteps++;
      const shots = Array.isArray(st.screenshots) && st.screenshots.length > 0
        ? st.screenshots
        : (st.screenshotUrl ? [{ url: st.screenshotUrl }] : []);
      totalImagesCount += shots.length;
    }
  }

  let durationMs = batch.durationMs || batch.duration || 0;
  if (!durationMs && batch.startedAt && batch.finishedAt) {
    const diff = new Date(batch.finishedAt).getTime() - new Date(batch.startedAt).getTime();
    if (diff > 0) durationMs = diff;
  }
  if (!durationMs) {
    durationMs = features.reduce((acc, f) => acc + (f.durationMs || 0), 0);
  }
  const formattedDuration = formatDuration(durationMs);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Báo cáo kiểm thử - ${escapeHtmlReport(reportTitle)}</title>
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
    <div class="card">
      <div class="header-top">
        <div>
          <div class="brand">🧪 AUTOTEST STUDIO · BÁO CÁO THỰC THI KIỂM THỬ</div>
          <h1 class="title">${escapeHtmlReport(reportTitle)}</h1>
          <div class="subtitle">Dự án: ${escapeHtmlReport(projectName)} · Mã phiên: ${escapeHtmlReport(batch.id)}</div>
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
          <div class="kpi-value">${totalImagesCount} ảnh</div>
        </div>
      </div>

      ${batch.notes ? `
        <div class="notes-box">
          <div class="notes-label">Ghi chú đợt chạy:</div>
          <div>${escapeHtmlReport(batch.notes)}</div>
        </div>
      ` : ""}
    </div>

    <div class="section-title">
      <span>📋 Chi tiết kết quả kiểm thử (${features.length} tính năng)</span>
    </div>

    ${features.map((feat, featIdx) => {
      const featStatus = (feat.status || "PASSED").toUpperCase();
      const featPassed = featStatus === "PASSED";
      const rawSteps = Array.isArray(feat.stepResults) && feat.stepResults.length > 0
        ? feat.stepResults
        : (Array.isArray(feat.steps) && typeof feat.steps[0] === "object" ? feat.steps : []);

      return `
      <div class="feature-card">
        <div class="feature-header">
          <div class="feature-title">
            <span style="color: #818cf8;">#${featIdx + 1}</span>
            <span>${escapeHtmlReport(feat.name)}</span>
          </div>
          <div class="feature-meta">
            <span>${formatDuration(feat.durationMs || 0)}</span>
            <span class="badge-feature ${featPassed ? "badge-passed" : "badge-failed"}">
              ${featPassed ? "✓ ĐẠT" : "✕ LỖI"}
            </span>
          </div>
        </div>

        <div class="feature-content">
          ${feat.error ? `
            <div class="error-box">
              <strong>Lỗi tính năng:</strong> ${escapeHtmlReport(feat.error)}
            </div>
          ` : ""}

          ${rawSteps.length === 0 ? `
            <div style="font-size:12px; color:#64748b; font-style:italic;">
              Chưa có dữ liệu bước kiểm thử chi tiết.
            </div>
          ` : rawSteps.map((st, stepIdx) => {
            const stPassed = (st.status || "passed").toLowerCase() === "passed";
            const stType = (st.type || "act").toLowerCase();
            const isNav = stType === "navigate" || stType === "goto";
            const isAssert = stType === "assert" || stType === "observe";
            const isView = stType === "view";
            const typeClass = isNav ? "type-navigate" : isAssert ? "type-assert" : isView ? "type-view" : "type-act";
            const typeName = isNav ? "Điều hướng" : isAssert ? "Kiểm tra" : isView ? "Giao diện" : "Hành động";
            const shots = Array.isArray(st.screenshots) && st.screenshots.length > 0
              ? st.screenshots
              : (st.screenshotUrl ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }] : []);

            return `
            <div class="step-item">
              <div class="step-header">
                <div class="step-left">
                  <span class="step-num">${stepIdx + 1}</span>
                  <span class="step-type ${typeClass}">${typeName}</span>
                  ${st.executionMode === "cache" ? `<span class="step-type" style="background:rgba(16,185,129,0.16);color:#34d399;">⚡ Cache</span>` : ""}
                  ${st.isSoft ? `<span class="step-type" style="background:rgba(245,158,11,0.16);color:#fbbf24;">Soft</span>` : ""}
                  <span class="step-text">${escapeHtmlReport(st.text || st.step || "Thao tác")}</span>
                </div>
                <div class="step-right">
                  ${st.durationMs ? `<span class="step-time">${formatDuration(st.durationMs)}</span>` : ""}
                  <span class="step-status ${stPassed ? "status-passed" : "status-failed"}">
                    ${stPassed ? "Đạt" : (st.isSoft ? "Cảnh báo" : "Lỗi")}
                  </span>
                </div>
              </div>

              ${stPassed && (st.value || st.message) ? `
                <div style="margin-top:8px; padding:7px 11px; border-radius:8px; background:rgba(15,23,42,0.65); border:1px solid #1e293b; font-size:11.5px; color:#94a3b8;">
                  ${st.message ? `<span>${escapeHtmlReport(st.message)}</span>` : ""}
                  ${st.value ? `<span style="margin-left:8px; color:#38bdf8; font-family:monospace;">Biến trích xuất: "${escapeHtmlReport(st.value)}"</span>` : ""}
                </div>
              ` : ""}

              ${!stPassed && (st.error || st.message) ? `
                <div class="error-box">
                  <strong>Lỗi:</strong> ${escapeHtmlReport(st.error || st.message)}
                  ${st.detectedAlert ? `<div style="margin-top:6px; font-size:11px; color:#fca5a5;"><strong>Cảnh báo trên trang:</strong> ${escapeHtmlReport(st.detectedAlert)}</div>` : ""}
                </div>
              ` : ""}

              ${shots.length > 0 ? `
                <div class="shots-container">
                  ${shots.map((shot, shotIdx) => {
                    const isBefore = shot.type === "before";
                    const isError = shot.type === "error";
                    const isV = shot.type === "view";
                    const tagClass = isBefore ? "tag-before" : isError ? "tag-error" : isV ? "tag-view" : "tag-after";
                    const tagText = isBefore ? "Trước" : isError ? "Lỗi" : isV ? "Trang" : "Sau";
                    const subText = shot.sublabel || (isBefore ? "Tiêu điểm viền đỏ" : isV ? "Trang web" : "Kết quả tương tác");

                    const safeShotUrl = escapeHtmlReport(resolveAssetUrl(shot.url));
                    return `
                    ${shotIdx > 0 ? `<span class="arrow-divider">→</span>` : ""}
                    <div class="shot-card" onclick="openLightbox('${safeShotUrl}')" title="Nhấp để phóng to">
                      <div class="shot-header">
                        <span class="shot-tag ${tagClass}">${tagText}</span>
                        <span class="shot-sub">${escapeHtmlReport(subText)}</span>
                      </div>
                      <div class="shot-img-wrapper">
                        <img src="${safeShotUrl}" alt="${escapeHtmlReport(shot.label || "Ảnh chụp")}" loading="lazy" />
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
};

// Đồng hồ độc lập cho Header batch đang chạy — tránh re-render toàn bộ HistoryTab mỗi 500ms
function LiveBatchDuration({ batch }) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  const isRunning = batch?.status === "Đang chạy";

  useEffect(() => {
    if (!isRunning) return;
    setNowTick(Date.now());
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        setNowTick(Date.now());
      }
    }, 500);
    return () => clearInterval(timer);
  }, [isRunning, batch?.id]);

  if (!batch) return <span className="tabular-nums">0s</span>;
  if (isRunning && batch.startedAt) {
    const ms = Math.max(0, nowTick - new Date(batch.startedAt).getTime());
    return <span className="tabular-nums">{formatDuration(ms)}</span>;
  }
  if (batch.finishedAt && batch.startedAt) {
    const ms = Math.max(0, new Date(batch.finishedAt).getTime() - new Date(batch.startedAt).getTime());
    return <span className="tabular-nums">{formatDuration(ms)}</span>;
  }
  const sumMs = (batch.features || []).reduce((acc, f) => acc + (f.durationMs || 0), 0);
  return <span className="tabular-nums">{sumMs > 0 ? formatDuration(sumMs) : "0s"}</span>;
}

// ═══════════════════════════════════════════════════════════════════
// TAB 3  ─  LỊCH SỬ KIỂM THỬ (Quản lý theo Đợt chạy)
// ═══════════════════════════════════════════════════════════════════
export function HistoryTab({
  projects,
  activeProjectId,
  onSelectProject,
  onUpsertProject,
  onDeleteProject,
  onExportProject,
  onExportAll,
  history = [],
  historyTotal,
  historyHasMore = false,
  historyLoadingMore = false,
  onLoadMoreHistory,
  onHistorySearchChange,
  selectedBatchId,
  onSelectBatchId,
  onDeleteBatch,
  onAbortBatchRun,
  _runningBatchId,
  abortingBatchId = null,
  liveRun = null,
  clientRunToken,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFeatures, setExpandedFeatures] = useState({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [deleteConfirmBatch, setDeleteConfirmBatch] = useState(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectToEdit, setProjectToEdit] = useState(null);
  const [downloadingReportId, setDownloadingReportId] = useState(null);

  const buildReportFilename = (batchName, batchId) => {
    const ascii = String(batchName || "report")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
    const safeName = ascii
      .replace(/[^\w\s-]/gi, "")
      .trim()
      .replace(/\s+/g, "_")
      .toLowerCase();
    return `report_${safeName || "test_report"}_${batchId}.html`;
  };

  const triggerBlobDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadHtmlReport = async (batch) => {
    if (!batch || downloadingReportId) return;
    setDownloadingReportId(batch.id);
    const filename = buildReportFilename(batch.name, batch.id);

    try {
      // 1. Tải báo cáo từ Backend (có nhúng base64 ảnh trực tiếp từ ổ cứng)
      try {
        const res = await fetch(`${API_BASE_URL}/history/${encodeURIComponent(batch.id)}/report`, {
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const blob = await res.blob();
          triggerBlobDownload(blob, filename);
          return;
        }
      } catch (err) {
        console.warn("Không thể tải báo cáo từ backend, chuyển sang tạo báo cáo trực tiếp:", err.message);
      }

      // 2. Dự phòng: Tạo báo cáo HTML trực tiếp trên Client
      const html = generateClientSideHtmlReport(batch, currentProject?.name);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      triggerBlobDownload(blob, filename);
    } catch (err) {
      console.error("Lỗi khi tạo báo cáo HTML client-side:", err);
      alert("Không thể tải báo cáo HTML: " + err.message);
    } finally {
      setDownloadingReportId(null);
    }
  };

  const currentProject = useMemo(() =>
    projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  // Chuẩn hóa toàn bộ lịch sử thành cấu trúc Đợt chạy
  const normalizedBatches = useMemo(() => {
    return (history || []).map(normalizeBatch).filter(Boolean);
  }, [history]);

  // Lọc theo dự án hiện tại và ô tìm kiếm (lọc theo tên đợt chạy & tên tính năng bên trong)
  const filteredBatches = useMemo(() => {
    let list = normalizedBatches;
    if (activeProjectId) {
      list = list.filter((b) => b.projectId === activeProjectId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((b) => {
        const matchName = b.name && b.name.toLowerCase().includes(q);
        const matchFeatures = Array.isArray(b.features) && b.features.some((f) => f.name && f.name.toLowerCase().includes(q));
        return matchName || matchFeatures;
      });
    }
    return list;
  }, [normalizedBatches, activeProjectId, searchQuery]);

  // Sắp xếp: Đợt chạy đang chạy ở đầu danh sách, sau đó mới nhất ở trên
  const sortedBatches = useMemo(() => {
    return [...filteredBatches].sort((a, b) => {
      const aRunning = a.status === "Đang chạy";
      const bRunning = b.status === "Đang chạy";
      if (aRunning && !bRunning) return -1;
      if (!aRunning && bRunning) return 1;
      const timeA = new Date(a.startedAt || 0).getTime();
      const timeB = new Date(b.startedAt || 0).getTime();
      return timeB - timeA;
    });
  }, [filteredBatches]);

  // Nhóm theo ngày cho Sidebar
  const dateGroups = useMemo(() => {
    const groups = [];
    const map = new Map();
    for (const b of sortedBatches) {
      const label = getDateGroupLabel(b.startedAt);
      if (!map.has(label)) {
        map.set(label, []);
        groups.push({ label, items: map.get(label) });
      }
      map.get(label).push(b);
    }
    return groups;
  }, [sortedBatches]);

  // Đợt chạy đang được chọn
  const activeBatch = useMemo(() => {
    if (selectedBatchId) {
      const found = sortedBatches.find((b) => b.id === selectedBatchId);
      if (found) return found;
    }
    return sortedBatches[0] || null;
  }, [selectedBatchId, sortedBatches]);

  // Tự động chọn đợt chạy đầu tiên nếu chưa chọn
  useEffect(() => {
    if (!selectedBatchId && sortedBatches.length > 0) {
      onSelectBatchId(sortedBatches[0].id);
    }
  }, [selectedBatchId, sortedBatches, onSelectBatchId]);

  // Danh sách tính năng trong đợt chạy: giữ nguyên thứ tự khi đang chạy để tránh nhảy card; sau khi kết thúc đưa FAILED/ERROR lên đầu
  const sortedFeaturesInBatch = useMemo(() => {
    if (!activeBatch?.features) return [];
    if (activeBatch.status === "Đang chạy") {
      return activeBatch.features;
    }
    const priority = (s) => {
      if (s === "FAILED") return 0;
      if (s === "ERROR") return 1;
      if (s === "RUNNING") return 2;
      if (s === "PENDING") return 3;
      if (s === "SKIPPED") return 4;
      if (s === "PASSED") return 5;
      return 6;
    };
    return [...activeBatch.features].sort((a, b) => priority(a.status) - priority(b.status));
  }, [activeBatch?.features, activeBatch?.status]);

  // Thu thập toàn bộ ảnh chụp (bao gồm cả ảnh live đang chạy) cho Lightbox
  const allLightboxShots = useMemo(() => {
    if (!activeBatch?.features) return [];
    const list = [];
    for (const feat of activeBatch.features) {
      const matchesLive =
        activeBatch.status === "Đang chạy" &&
        feat.status === "RUNNING" &&
        Boolean(liveRun) &&
        (!liveRun.batchId || liveRun.batchId === activeBatch.id) &&
        (typeof liveRun.featureIndex === "number"
          ? activeBatch.features.indexOf(feat) === liveRun.featureIndex
          : (liveRun.featureId ? liveRun.featureId === feat.id : liveRun.featureName === feat.name));
      const effectiveSteps = matchesLive && Array.isArray(liveRun.steps) ? liveRun.steps : (feat.stepResults || []);

      for (const step of effectiveSteps) {
        if (Array.isArray(step.screenshots) && step.screenshots.length > 0) {
          for (const shot of step.screenshots) {
            list.push({
              ...shot,
              url: resolveAssetUrl(shot.url),
              featureName: feat.name,
              stepText: step.text,
            });
          }
        } else if (step.screenshotUrl) {
          list.push({
            url: resolveAssetUrl(step.screenshotUrl),
            label: "Ảnh chụp màn hình",
            type: "after",
            featureName: feat.name,
            stepText: step.text,
          });
        }
      }
    }
    return list;
  }, [activeBatch, liveRun]);

  const handleOpenLightbox = (shotUrl) => {
    const foundIdx = allLightboxShots.findIndex((s) => s.url === shotUrl);
    setLightboxIndex(foundIdx >= 0 ? foundIdx : 0);
    setLightboxOpen(true);
  };

  const toggleFeatureExpand = (featId) => {
    setExpandedFeatures((prev) => ({ ...prev, [featId]: !prev[featId] }));
  };

  // Tính các số liệu pass và fail của đợt chạy
  const metrics = useMemo(() => {
    const feats = activeBatch?.features || [];
    return {
      pass: feats.filter((f) => f.status === "PASSED").length,
      fail: feats.filter((f) => f.status === "FAILED" || f.status === "ERROR").length,
      total: feats.length,
    };
  }, [activeBatch]);

  const runningFeatId = useMemo(() => {
    if (activeBatch?.status !== "Đang chạy" || !activeBatch?.features) return null;
    return activeBatch.features.find((f) => f.status === "RUNNING")?.id || null;
  }, [activeBatch]);

  // Chỉ tự động mở rộng khi một tính năng mới chuyển sang trạng thái RUNNING
  useEffect(() => {
    if (!runningFeatId) return;
    setExpandedFeatures((prev) =>
      prev[runningFeatId] ? prev : { ...prev, [runningFeatId]: true }
    );
  }, [runningFeatId]);

  return (
    <div className="tab-content flex h-full">
      {/* ── LEFT: Danh sách Đợt chạy ── */}
      <aside className="w-80 shrink-0 min-w-0 border-r border-slate-700 bg-slate-950 flex flex-col">
        {/* Dropdown chọn dự án */}
        <div className="px-4 py-3 border-b border-slate-700">
          <ProjectSelectorDropdown
            projects={projects}
            activeProject={currentProject}
            onSelectProject={onSelectProject}
            onCreateProject={() => { setProjectToEdit(null); setProjectModalOpen(true); }}
            onEditProject={(p) => { setProjectToEdit(p); setProjectModalOpen(true); }}
            onDeleteProject={(p) => onDeleteProject(p.id)}
            _onExportCurrentProject={() => onExportProject(currentProject)}
            _onExportAllProjects={onExportAll}
          />
        </div>

        {/* Ô lọc đợt chạy và tính năng */}
        <div className="px-4 py-2.5 border-b border-slate-700">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (onHistorySearchChange) onHistorySearchChange(e.target.value);
              }}
              placeholder="Lọc đợt chạy hoặc tính năng…"
              className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>

        {/* Danh sách đợt chạy nhóm theo ngày */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          {sortedBatches.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 italic">
              {searchQuery ? "Không tìm thấy đợt chạy phù hợp" : "Chưa có đợt chạy nào"}
            </div>
          ) : (
            <>
              {dateGroups.map(({ label, items }) => (
                <div key={label} className="space-y-1">
                  <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
                    {label}
                  </div>
                  {items.map((b) => {
                    const isSelected = activeBatch?.id === b.id;
                    const statusText = b.status === "Đang chạy" ? "Đang chạy" : "Đã kết thúc";

                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onSelectBatchId(b.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex flex-col gap-1 cursor-pointer select-none ${isSelected
                          ? "bg-indigo-600/25 border border-indigo-500/50 text-white shadow-xs"
                          : "hover:bg-slate-900 border border-transparent text-slate-300"
                          }`}
                      >
                        <div className="text-xs font-semibold text-white truncate" title={b.name}>
                          {b.name}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                          {formatSublineTime(b.startedAt)} · {statusText}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
              {historyHasMore && onLoadMoreHistory && (
                <button
                  type="button"
                  onClick={onLoadMoreHistory}
                  disabled={historyLoadingMore}
                  className="w-full py-2 text-xs font-medium text-indigo-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {historyLoadingMore ? "Đang tải thêm..." : "Tải thêm đợt chạy cũ hơn"}
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer sidebar */}
        <div className="h-10 shrink-0 px-4 border-t border-slate-700 text-xs text-slate-400 flex items-center justify-between font-mono">
          <span>
            {historyHasMore && typeof historyTotal === "number"
              ? `Đang hiện ${filteredBatches.length} / ${historyTotal} đợt chạy`
              : `Tổng: ${typeof historyTotal === "number" && !searchQuery.trim() ? historyTotal : filteredBatches.length} đợt chạy`}
          </span>
        </div>
      </aside>

      {/* ── RIGHT: Vùng chính kết quả đợt chạy ── */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
        {!activeBatch ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
            <History size={36} className="text-slate-600 mb-3" />
            <h3 className="text-sm font-semibold text-white mb-1">Chưa chọn đợt chạy nào</h3>
            <p className="text-xs text-slate-400 max-w-sm">
              Chọn một đợt chạy từ danh sách bên trái hoặc chuyển sang tab "Trình chạy test" để tạo đợt chạy mới.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div className="max-w-[950px] mx-auto w-full space-y-6">
              {/* Header đợt chạy */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {(activeBatch.projectName || currentProject?.name) && (
                      <div className="text-[11px] font-mono text-indigo-400">
                        <span>{activeBatch.projectName || currentProject?.name}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <h2 className="text-lg font-bold text-white truncate" title={activeBatch.name}>
                        {activeBatch.name}
                      </h2>

                      {/* Trạng thái: Chỉ có "Đang chạy" hoặc "Kết thúc" */}
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${activeBatch.status === "Đang chạy"
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 animate-pulse"
                          : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}
                      >
                        {activeBatch.status === "Đang chạy" ? (
                          <>
                            <Loader2 size={13} className="animate-spin text-indigo-400" />
                            Đang chạy
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={13} className="text-slate-400" />
                            Đã kết thúc
                          </>
                        )}
                      </span>
                    </div>

                    {/* Thời điểm và thời lượng: hh:mm dd/mm/yy · 25.4s */}
                    <div className="text-xs text-slate-400 font-mono tabular-nums pt-0.5">
                      <span>{formatBatchDateTime(activeBatch.startedAt)} · <LiveBatchDuration batch={activeBatch} /></span>
                    </div>

                    {/* Số liệu đợt chạy: ✔ pass · ✖ fail */}
                    <div className="flex items-center gap-3 text-xs font-mono tabular-nums pt-1 flex-wrap">
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        ✔ {metrics.pass} pass
                      </span>
                      <span>•</span>
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        ✖ {metrics.fail} fail
                      </span>
                    </div>
                  </div>

                  {/* Nút hành động */}
                  <div className="flex items-center gap-2 shrink-0">
                    {activeBatch.status === "Đang chạy" && onAbortBatchRun && (
                      (activeBatch.ownerToken && clientRunToken && activeBatch.ownerToken !== clientRunToken) ? (
                        <div
                          className="px-3 py-1.5 rounded-lg bg-slate-850 border border-slate-700 text-slate-400 text-xs font-medium flex items-center gap-1.5 cursor-not-allowed select-none"
                          title="Đợt chạy này do máy khác trên mạng LAN khởi chạy. Bạn chỉ có thể theo dõi tiến độ, chỉ người chạy mới có quyền hủy."
                        >
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                          <span>Chạy bởi máy khác (Khóa hủy)</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onAbortBatchRun(activeBatch)}
                          disabled={abortingBatchId === activeBatch.id || abortingBatchId === "__aborting__"}
                          className="px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm disabled:opacity-60 disabled:cursor-wait"
                          title="Dừng đợt chạy này"
                        >
                          {(abortingBatchId === activeBatch.id || abortingBatchId === "__aborting__") ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <X size={13} />
                          )}
                          <span>
                            {(abortingBatchId === activeBatch.id || abortingBatchId === "__aborting__")
                              ? "Đang dừng..."
                              : "Hủy đợt chạy"}
                          </span>
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => handleDownloadHtmlReport(activeBatch)}
                      disabled={downloadingReportId === activeBatch.id}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                      title="Tải báo cáo HTML độc lập kèm toàn bộ ảnh và kết quả kiểm thử"
                    >
                      {downloadingReportId === activeBatch.id ? (
                        <Loader2 size={13} className="animate-spin text-white" />
                      ) : (
                        <Download size={13} />
                      )}
                      <span>Tải báo cáo HTML</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteConfirmBatch(activeBatch)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 border border-transparent hover:border-rose-900/50 transition-colors cursor-pointer"
                      title="Xóa đợt chạy này"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Ghi chú tùy chọn */}
                {activeBatch.notes && (
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 leading-relaxed font-sans">
                    <span className="text-slate-400 font-semibold block mb-0.5">Ghi chú:</span>
                    {activeBatch.notes}
                  </div>
                )}
              </div>

              {/* Danh sách tính năng trong đợt chạy (FAILED và ERROR lên đầu) */}
              <div className="space-y-3">
                <div className="text-xs text-white font-semibold flex items-center justify-between">
                  <span>Danh sách tính năng ({sortedFeaturesInBatch.length})</span>
                </div>

                <div className="space-y-2.5">
                  {sortedFeaturesInBatch.map((feat) => {
                    const isExpanded = !!expandedFeatures[feat.id];
                    const isPassed = feat.status === "PASSED";
                    const isFailed = feat.status === "FAILED";
                    const isError = feat.status === "ERROR";
                    const isSkipped = feat.status === "SKIPPED";
                    const isRunning = feat.status === "RUNNING";

                    const matchesLive =
                      activeBatch.status === "Đang chạy" &&
                      isRunning &&
                      Boolean(liveRun) &&
                      (!liveRun.batchId || liveRun.batchId === activeBatch.id) &&
                      (typeof liveRun.featureIndex === "number"
                        ? activeBatch.features.indexOf(feat) === liveRun.featureIndex
                        : (liveRun.featureId ? liveRun.featureId === feat.id : liveRun.featureName === feat.name));
                    const stepResults =
                      matchesLive && Array.isArray(liveRun.steps) && liveRun.steps.length > 0
                        ? liveRun.steps
                        : (feat.stepResults || []);
                    const stepCount = stepResults.length > 0 ? stepResults.length : (feat.steps || []).length;

                    return (
                      <div
                        key={feat.id}
                        className="border border-slate-800 rounded-xl bg-slate-900/60 overflow-hidden shadow-xs transition-colors hover:border-slate-700/80"
                      >
                        {/* Hàng tính năng - Click để mở rộng/thu gọn */}
                        <button
                          type="button"
                          onClick={() => toggleFeatureExpand(feat.id)}
                          className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/80 hover:bg-slate-800/80 transition-colors text-left cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-slate-400 shrink-0">
                              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </span>

                            {/* Badge kết quả 4 trạng thái chuẩn Big Tech: PASSED / PASSED_WITH_WARNINGS / FAILED / BROKEN / ERROR / SKIPPED */}
                            {isPassed && feat.verdict === "PASSED_WITH_WARNINGS" && (
                              <span
                                className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0"
                                title="Đạt toàn bộ kiểm chứng nghiệp vụ, có lưu ý phi chặn (Advisory)"
                              >
                                <AlertTriangle size={12} /> PASSED (LƯU Ý)
                              </span>
                            )}
                            {isPassed && feat.verdict !== "PASSED_WITH_WARNINGS" && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 shrink-0">
                                <CheckCircle2 size={12} /> PASSED
                              </span>
                            )}
                            {isPassed && feat.assertionSummary?.isSmokeOnly && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700 shrink-0"
                                title="Kịch bản chạy không có bước Kiểm tra (Assert)"
                              >
                                Smoke Only
                              </span>
                            )}
                            {isFailed && feat.verdict === "BROKEN" && (
                              <span
                                className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center gap-1 shrink-0"
                                title="Lỗi kịch bản / phần tử / timeout / hạ tầng AI (không phải lỗi sản phẩm)"
                              >
                                <AlertTriangle size={12} /> BROKEN
                              </span>
                            )}
                            {isFailed && feat.verdict !== "BROKEN" && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 shrink-0">
                                <AlertCircle size={12} /> FAILED
                              </span>
                            )}
                            {isError && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0">
                                <AlertTriangle size={12} /> ERROR
                              </span>
                            )}
                            {isSkipped && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1 shrink-0">
                                <MinusCircle size={12} /> SKIPPED
                              </span>
                            )}
                            {isRunning && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 flex items-center gap-1 shrink-0">
                                <Loader2 size={12} className="animate-spin" /> Đang chạy
                              </span>
                            )}
                            {!isPassed && !isFailed && !isError && !isSkipped && !isRunning && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-900 text-slate-500 border border-slate-800 shrink-0">
                                Chờ chạy
                              </span>
                            )}

                            <span className="font-semibold text-white truncate text-xs">
                              {feat.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums shrink-0 ml-3">
                            {matchesLive && liveRun.totalSteps > 0 ? (
                              <span className="text-indigo-300">
                                Bước {liveRun.currentStepIndex}/{liveRun.totalSteps}
                              </span>
                            ) : (
                              <>
                                <span>{formatDuration(feat.durationMs)}</span>
                                <span>•</span>
                                <span>{stepCount} bước</span>
                              </>
                            )}
                          </div>
                        </button>

                        {/* Chi tiết từng bước và kết quả khi mở rộng */}
                        {isExpanded && (
                          <div className="border-t border-slate-800/80 p-4 space-y-3 bg-slate-950/50">
                            {/* Bảng tiến độ trực tiếp (Live Telemetry) khi tính năng đang chạy */}
                            {matchesLive && (
                              <div className="p-3.5 rounded-lg bg-indigo-950/30 border border-indigo-500/40 space-y-2.5 text-xs">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 text-indigo-200 font-semibold">
                                    <Loader2 size={14} className="animate-spin text-indigo-400" />
                                    <span>
                                      Đang thực thi bước {liveRun.currentStepIndex}/{liveRun.totalSteps}
                                    </span>
                                  </div>
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono text-sky-300">
                                    {liveRun.currentLayer === "cache" ? (
                                      <>
                                        <Zap size={11} className="text-emerald-400" /> Phát lại Cache (0ms AI)
                                      </>
                                    ) : liveRun.currentLayer === "fastpath" ? (
                                      <>
                                        <Gauge size={11} className="text-sky-400" /> FastPath Tất định
                                      </>
                                    ) : liveRun.currentLayer === "ai" ? (
                                      <>
                                        <Bot size={11} className="text-indigo-400" /> AI Micro-ReAct · Nhịp {liveRun.currentTurn}/{liveRun.maxTurns}
                                      </>
                                    ) : (
                                      "Đang khởi tạo trình duyệt…"
                                    )}
                                  </span>
                                </div>

                                {liveRun.totalSteps > 0 && (
                                  <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                                    <div
                                      className="h-full bg-indigo-500 transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, Math.round((liveRun.currentStepIndex / liveRun.totalSteps) * 100))}%`,
                                      }}
                                    />
                                  </div>
                                )}

                                {liveRun.currentStepText && (
                                  <div className="text-slate-200 font-mono text-[11px] bg-slate-950/60 px-2.5 py-1.5 rounded border border-slate-800/80">
                                    ▶ {liveRun.currentStepText}
                                  </div>
                                )}

                                {liveRun.currentThought && (
                                  <div className="text-[11px] text-indigo-300 italic flex items-start gap-1.5">
                                    <Bot size={12} className="shrink-0 mt-0.5 text-indigo-400" />
                                    <span>{liveRun.currentThought}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Nội dung kịch bản gốc của tính năng */}
                            {((Array.isArray(feat.steps) && feat.steps.length > 0) || feat.description) && (
                              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs space-y-1.5">
                                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">
                                  Kịch bản kiểm thử:
                                </div>
                                <div className="space-y-1 font-mono text-slate-200 text-xs leading-relaxed">
                                  {(Array.isArray(feat.steps) && feat.steps.length > 0 ? feat.steps : [feat.description]).map((line, idx, arr) => (
                                    <div key={idx} className="flex items-start gap-2">
                                      {arr.length > 1 && (
                                        <span className="text-slate-500 select-none shrink-0 text-[11px]">
                                          {idx + 1}.
                                        </span>
                                      )}
                                      <span className="whitespace-pre-wrap break-words">{line}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Thông báo lỗi tính năng nếu có */}
                            {feat.error && (
                              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-rose-300 text-xs font-mono leading-relaxed">
                                <span className="font-bold block mb-1">Thông báo lỗi:</span>
                                {feat.error}
                              </div>
                            )}

                            {/* Danh sách các bước */}
                            {stepResults.length > 0 ? (
                              <div className="space-y-3">
                                {stepResults.map((st, stepIdx) => {
                                  const isStepRunning = st.status === "running";
                                  const stepPass = st.status === "passed";
                                  const isCacheMode = st.executionMode === "cache" || (typeof st.message === "string" && st.message.includes("⚡"));
                                  const isFastMode = st.executionMode === "fastpath";
                                  const rawShots = Array.isArray(st.screenshots) && st.screenshots.length > 0
                                    ? st.screenshots
                                    : (st.screenshotUrl ? [{ url: st.screenshotUrl, type: "after", label: "Ảnh chụp màn hình" }] : []);
                                  const screenshots = rawShots.map((s) => ({ ...s, url: resolveAssetUrl(s.url) }));

                                  return (
                                    <div
                                      key={stepIdx}
                                      className={`p-3 rounded-lg border text-xs space-y-2 ${
                                        isStepRunning
                                          ? "bg-indigo-950/25 border-indigo-500/40"
                                          : stepPass
                                            ? "bg-slate-900/60 border-slate-800"
                                            : "bg-rose-950/20 border-rose-900/40"
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2 min-w-0">
                                          <span className="text-slate-400 font-mono font-bold shrink-0">
                                            #{stepIdx + 1}
                                          </span>
                                          <span className="text-slate-200 font-mono break-words leading-relaxed">
                                            {st.text}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                          {st.isSoft && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                              SOFT
                                            </span>
                                          )}
                                          {isCacheMode && stepPass && (
                                            <span
                                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                              title="Phát lại tức thì từ Step Trace Cache (0 gọi AI)"
                                            >
                                              <Zap size={9} /> Cache
                                            </span>
                                          )}
                                          {isFastMode && stepPass && (
                                            <span
                                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30"
                                              title="Thực thi qua Đường tắt Tất định (0 gọi AI)"
                                            >
                                              FastPath
                                            </span>
                                          )}
                                          {st.executionMode === "ai" && stepPass && (
                                            <span
                                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                                              title="Thực thi bằng AI Micro-ReAct Loop"
                                            >
                                              AI
                                            </span>
                                          )}
                                          {typeof st.durationMs === "number" && st.durationMs > 0 && (
                                            <span className="text-[10px] font-mono tabular-nums text-slate-400">
                                              {formatDuration(st.durationMs)}
                                            </span>
                                          )}
                                          {st.failureType && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                              {st.failureType}
                                            </span>
                                          )}
                                          {isStepRunning ? (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 inline-flex items-center gap-1">
                                              <Loader2 size={10} className="animate-spin" /> ĐANG CHẠY
                                            </span>
                                          ) : (() => {
                                            const stBroken = !stepPass && st.verdict === "BROKEN";
                                            const stWarn = stepPass && (st.verdict === "PASSED_WITH_WARNINGS" || (Array.isArray(st.uxWarnings) && st.uxWarnings.length > 0));
                                            const badgeCls = stWarn
                                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                              : stepPass
                                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                                : st.isSoft
                                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                                  : stBroken
                                                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                                    : "bg-rose-500/20 text-rose-300 border border-rose-500/30";
                                            const badgeText = stWarn
                                              ? "PASS*"
                                              : stepPass
                                                ? "PASS"
                                                : st.isSoft
                                                  ? "WARN"
                                                  : stBroken
                                                    ? "BROKEN"
                                                    : "FAIL";
                                            return (
                                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 font-mono ${badgeCls}`}>
                                                {badgeText}
                                              </span>
                                            );
                                          })()}
                                        </div>
                                      </div>

                                      {/* Hợp đồng Bằng chứng Kiểm chứng (Expected vs Actual Evidence) */}
                                      {st.evidence && (st.evidence.expected || st.evidence.actual) && (
                                        <div
                                          className={`px-2.5 py-1.5 rounded border text-[11px] font-mono space-y-0.5 ${
                                            st.evidence.passed
                                              ? "bg-emerald-950/20 border-emerald-500/25 text-slate-200"
                                              : "bg-rose-950/25 border-rose-500/30 text-slate-200"
                                          }`}
                                        >
                                          <div className="text-[10px] text-slate-400">
                                            Nguồn:{" "}
                                            <span className="text-slate-300 font-semibold">
                                              {st.evidence.oracleSource === "deterministic_assert"
                                                ? "Tất định (Playwright)"
                                                : st.evidence.oracleSource === "ai_judge"
                                                  ? "Trọng tài AI (Judge)"
                                                  : st.evidence.oracleSource === "causal_guardrail"
                                                    ? "Hàng rào Nhân quả"
                                                    : "Hậu kiểm cơ học"}
                                            </span>
                                            {st.evidence.scope && (
                                              <span> · Phạm vi: {st.evidence.scope}</span>
                                            )}
                                          </div>
                                          {st.evidence.expected && (
                                            <div>
                                              <span className="text-sky-300 font-semibold">Expected:</span>{" "}
                                              <span className="break-words">{st.evidence.expected}</span>
                                            </div>
                                          )}
                                          {st.evidence.actual && (
                                            <div>
                                              <span
                                                className={`font-semibold ${
                                                  st.evidence.passed ? "text-emerald-300" : "text-rose-300"
                                                }`}
                                              >
                                                Actual:
                                              </span>{" "}
                                              <span className="break-words">{st.evidence.actual}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Cảnh báo phi chặn (Advisory Warnings) */}
                                      {stepPass && Array.isArray(st.uxWarnings) && st.uxWarnings.length > 0 && (
                                        <div className="px-2.5 py-1.5 rounded bg-amber-950/25 border border-amber-500/30 text-amber-200 text-[11px] font-mono break-words">
                                          <span className="font-bold text-amber-300">Lưu ý phi chặn: </span>
                                          {st.uxWarnings.join(" • ")}
                                        </div>
                                      )}

                                      {/* Chi tiết thao tác & Giá trị biến đã đọc (cho bước PASS) */}
                                      {stepPass && (st.message || st.value) && (() => {
                                        const subActions = Array.isArray(st.actionsLog) && st.actionsLog.length > 1
                                          ? st.actionsLog
                                          : (typeof st.message === "string" && st.message.includes(" → ") && st.message.split(" → ").length > 2
                                              ? st.message.replace(/\s*⚡$/, "").split(" → ").map((p) => p.trim()).filter(Boolean)
                                              : null);

                                        return (
                                          <div className="px-2.5 py-1.5 rounded bg-slate-950/60 border border-slate-800/80 text-slate-300 text-[11px] space-y-1.5">
                                            {subActions ? (
                                              <div className="space-y-1 font-mono text-slate-300">
                                                {subActions.map((actMsg, aIdx) => (
                                                  <div key={aIdx} className="flex items-start gap-2">
                                                    <span className="text-emerald-400/80 select-none shrink-0 text-[10px]">
                                                      {aIdx + 1}.
                                                    </span>
                                                    <span className="break-words">{actMsg}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              st.message && (
                                                <div className="font-mono text-slate-300 break-words">{st.message}</div>
                                              )
                                            )}
                                            {st.value && (
                                              <span className="inline-block px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono text-[10px]">
                                                Biến trích xuất: &quot;{st.value}&quot;
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })()}

                                      {/* Chi tiết lỗi của bước & cảnh báo */}
                                      {(st.error || (!stepPass && !isStepRunning && st.message)) && (
                                        <div className="p-2 rounded bg-rose-950/40 border border-rose-900/60 text-rose-300 font-mono text-[11px] leading-relaxed space-y-1">
                                          <div>{st.error || st.message}</div>
                                          {st.detectedAlert && (
                                            <div className="pt-1 border-t border-rose-900/50 text-[10px] text-amber-300 flex items-center gap-1">
                                              <span>⚠️ Cảnh báo trên trang:</span>
                                              <span className="font-semibold">{st.detectedAlert}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Bằng chứng ảnh chụp màn hình */}
                                      {screenshots.length > 0 && (
                                        <div className="pt-2 border-t border-slate-800/80">
                                          <div className="flex items-center gap-1.5 mb-2 text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                                            <Camera size={12} className="text-indigo-400" />
                                            <span>Bằng chứng thị giác ({screenshots.length})</span>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-3">
                                            {screenshots.map((shot, shotIdx) => {
                                              const isBefore = shot.type === "before";
                                              const isErrorShot = shot.type === "error";
                                              const isProgressShot = shot.type === "progress";

                                              return (
                                                <button
                                                  key={shotIdx}
                                                  type="button"
                                                  onClick={() => handleOpenLightbox(shot.url)}
                                                  className={`group relative flex flex-col overflow-hidden rounded-lg border transition-colors text-left focus:outline-none cursor-zoom-in ${isBefore
                                                    ? "border-indigo-500/40 hover:border-indigo-400 bg-indigo-950/20"
                                                    : isErrorShot
                                                      ? "border-rose-500/50 hover:border-rose-400 bg-rose-950/20"
                                                      : isProgressShot
                                                        ? "border-sky-500/40 hover:border-sky-400 bg-sky-950/20"
                                                        : "border-emerald-500/40 hover:border-emerald-400 bg-emerald-950/20"
                                                    }`}
                                                  title={`Bấm để phóng to: ${shot.label || "Ảnh chụp"}`}
                                                >
                                                  <div className="px-2 py-1 flex items-center justify-between gap-2 border-b border-inherit bg-slate-950/70 w-[180px]">
                                                    <span
                                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isBefore
                                                        ? "bg-indigo-500/20 text-indigo-300"
                                                        : isErrorShot
                                                          ? "bg-rose-500/20 text-rose-300"
                                                          : isProgressShot
                                                            ? "bg-sky-500/20 text-sky-300"
                                                            : "bg-emerald-500/20 text-emerald-300"
                                                        }`}
                                                    >
                                                      {isBefore ? "Trước" : isErrorShot ? "Lỗi" : isProgressShot ? "Trung gian" : "Sau"}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 truncate text-right">
                                                      {shot.label || "Ảnh"}
                                                    </span>
                                                  </div>

                                                  <div className="relative overflow-hidden w-[180px] aspect-video bg-slate-950">
                                                    <img
                                                      src={shot.url}
                                                      alt={shot.label || `Ảnh ${shotIdx + 1}`}
                                                      loading="lazy"
                                                      className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                                                    />
                                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                                      <span className="p-1 rounded-full bg-slate-900/85 text-white shadow-md">
                                                        <Maximize2 size={13} />
                                                      </span>
                                                    </div>
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              // Khi chưa có stepResults, hiển thị danh sách các bước từ snapshot
                              <div className="space-y-1.5">
                                {(feat.steps || []).map((stepText, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="flex items-start gap-2.5 px-3 py-1.5 rounded bg-slate-900/40 text-xs font-mono text-slate-300"
                                  >
                                    <span className="text-slate-500 w-5 shrink-0 text-right">
                                      {sIdx + 1}
                                    </span>
                                    <span className="break-words flex-1">{stepText}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <ScreenshotLightbox
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        items={allLightboxShots}
        initialIndex={lightboxIndex}
      />

      <ConfirmModal
        isOpen={Boolean(deleteConfirmBatch)}
        onClose={() => setDeleteConfirmBatch(null)}
        onConfirm={() => {
          if (deleteConfirmBatch && onDeleteBatch) {
            onDeleteBatch(deleteConfirmBatch.id);
          }
          setDeleteConfirmBatch(null);
        }}
        title="Xóa đợt chạy"
        message="Bạn có chắc chắn muốn xóa đợt chạy này khỏi lịch sử kiểm thử?"
        itemName={deleteConfirmBatch?.name}
      />

      <ProjectModal
        isOpen={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        onSave={onUpsertProject}
        project={projectToEdit}
      />
    </div>
  );
}

export default HistoryTab;

