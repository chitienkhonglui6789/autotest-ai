export const genId = (prefix = "item") => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * So sánh nhanh 2 giá trị JSON-serializable để tránh cập nhật state thừa gây re-render.
 */
export const haveSameSerializedState = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const saveShortcutText = isMac ? "⌘S để lưu" : "Ctrl+S để lưu";

export const SAMPLE_PROJECTS = [
  {
    id: "proj_sample_sut",
    name: "Hệ thống Mẫu Doanh nghiệp (Local SUT)",
    description: "Bộ kịch bản mẫu chuẩn Micro-ReAct & Step Cache chạy trực tiếp trên cổng http://127.0.0.1:5050",
    createdAt: new Date().toISOString(),
    features: [
      {
        id: "feat_sut_login_order",
        name: "Đăng nhập & Đặt hàng (Full Flow)",
        steps: [
          "Mở trang http://127.0.0.1:5050",
          "Nhập admin vào ô Tên đăng nhập",
          "Nhập 123456 vào ô Mật khẩu",
          "Bấm nút Đăng nhập ngay",
          "Kiểm tra thông báo 'Đăng nhập thành công'",
          "Bấm nút '2. Quản lý Đơn hàng'",
          "Bấm nút 'Thêm vào giỏ' của sản phẩm Smartphone X",
          "Bấm nút 'Mở giỏ hàng & Thanh toán'",
          "Nhập DISCOUNT10 vào ô Mã giảm giá và bấm nút Áp dụng",
          "Bấm nút Xác nhận thanh toán ngay",
          "Kiểm tra xuất hiện thông báo 'Thanh toán thành công, mã giảm giá đã áp dụng'",
        ],
      },
      {
        id: "feat_sut_extract_var",
        name: "Trích xuất mã động {{LAST_EXTRACTED}} & Kiểm tra [soft]",
        steps: [
          "Mở trang http://127.0.0.1:5050",
          "Nhập admin vào ô Tên đăng nhập",
          "Nhập 123456 vào ô Mật khẩu",
          "Bấm nút Đăng nhập ngay",
          "Bấm nút '3. Dữ liệu & Biểu mẫu'",
          "Đọc mã khách hàng VIP hiển thị trên trang và lưu vào biến {{ma_khach_hang}}",
          "Chọn thành phố Đà Nẵng trong danh sách thành phố",
          "Kiểm tra trên trang hiển thị đúng mã {{LAST_EXTRACTED}} [soft]",
        ],
      },
    ],
  },
  {
    id: "proj_ecommerce",
    name: "Website Thương mại điện tử",
    description: "Kịch bản mẫu kiểm thử luồng khách hàng mua sắm & thanh toán trực tuyến",
    createdAt: new Date().toISOString(),
    features: [
      {
        id: "feat_login",
        name: "Đăng nhập tài khoản",
        steps: [
          "Mở trang https://example-shop.local/login",
          "Nhập {{username}} vào ô Email",
          "Nhập {{password}} vào ô Mật khẩu",
          "Bấm nút 'Đăng nhập'",
          "Kiểm tra hiển thị tên người dùng trên thanh điều hướng",
        ],
      },
      {
        id: "feat_search_cart",
        name: "Tìm kiếm & Thêm giỏ hàng",
        steps: [
          "Nhập 'Tai nghe Bluetooth' vào ô tìm kiếm",
          "Nhấn phím Enter",
          "Bấm nút 'Thêm vào giỏ hàng' ở sản phẩm đầu tiên",
          "Kiểm tra số lượng giỏ hàng hiển thị 1",
        ],
      },
    ],
  },
];

export const getClientRunToken = () => {
  try {
    let token = localStorage.getItem("autotest_client_token");
    if (!token) {
      token = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem("autotest_client_token", token);
    }
    return token;
  } catch {
    return `client_${Date.now()}`;
  }
};

export const getActiveProjectId = () => {
  try {
    return localStorage.getItem("autotest_active_project_id") || "";
  } catch {
    return "";
  }
};

export const saveActiveProjectId = (projectId) => {
  try {
    if (projectId) {
      localStorage.setItem("autotest_active_project_id", String(projectId));
    } else {
      localStorage.removeItem("autotest_active_project_id");
    }
  } catch {}
};

export const clearLegacyStorageCaches = () => {
  try {
    localStorage.removeItem("autotest_history");
    localStorage.removeItem("autotest_projects");
    localStorage.removeItem("autotest_features");
  } catch {}
};

export const _getFeatureStatus = (featureId, history = []) => {
  const latestRun = history.find((r) => r.featureId === featureId);
  if (!latestRun) return "none";
  return latestRun.status;
};

export const _getStatusDotClass = (status) => {
  if (status === "passed") return "bg-emerald-400";
  if (status === "failed") return "bg-rose-400";
  return "bg-slate-500";
};

export const formatTime = (isoString) => {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString || "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return isoString || "";
  }
};

export const formatBatchDateTime = (isoString) => {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString || "";
    const pad = (n) => String(n).padStart(2, "0");
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    const dd = pad(d.getDate());
    const MM = pad(d.getMonth() + 1);
    const yy = String(d.getFullYear()).slice(-2);
    return `${hh}:${mm} ${dd}/${MM}/${yy}`;
  } catch {
    return isoString || "";
  }
};

export const formatDuration = (ms) => {
  if (typeof ms !== "number" || isNaN(ms)) return "0s";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export const formatSublineTime = (isoString) => {
  try {
    const d = new Date(isoString || Date.now());
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  } catch {
    return "";
  }
};

export const getDateGroupLabel = (isoString) => {
  try {
    const d = new Date(isoString || Date.now());
    if (isNaN(d.getTime())) return "Khác";
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const pad = (n) => String(n).padStart(2, "0");
    const dateFormatted = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    if (isToday) return `Hôm nay · ${dateFormatted}`;
    if (isYesterday) return `Hôm qua · ${dateFormatted}`;
    return dateFormatted;
  } catch {
    return "Khác";
  }
};

export const generateBatchRunName = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  return `Đợt chạy ${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

export const normalizeBatch = (item) => {
  if (!item || !Array.isArray(item.features)) return null;
  return {
    ...item,
    id: item.id || genId("batch"),
    name: item.name || "Đợt chạy kiểm thử",
    notes: item.notes || "",
    startedAt: item.startedAt || item.timestamp || new Date().toISOString(),
    finishedAt: item.finishedAt || null,
    status: item.status === "Đang chạy" ? "Đang chạy" : "Kết thúc",
    features: item.features.map((f) => ({
      id: f.id || genId("feat"),
      name: f.name || f.featureName || "Tính năng",
      steps: Array.isArray(f.steps)
        ? f.steps.map((s) => (typeof s === "string" ? s : s.text || ""))
        : [],
      stepResults: Array.isArray(f.stepResults)
        ? f.stepResults
        : (Array.isArray(f.steps) && typeof f.steps[0] === "object" ? f.steps : []),
      status: f.status || "PASSED",
      verdict: f.verdict || f.status || "PASSED",
      assertionSummary: f.assertionSummary || null,
      durationMs: typeof f.durationMs === "number" ? f.durationMs : (f.duration || 0),
      error: f.error || null,
    })),
  };
};

export const exportJSON = (data, filename = `autotest_${Date.now()}.json`) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Tách đoạn văn bản tiếng Việt 1 dòng hoặc nhiều dòng thành từng câu/bước độc lập
 * mà vẫn bảo vệ nguyên vẹn URL, số thập phân và cụm chữ trong ngoặc kép.
 */
export const splitParagraphSentencesLocally = (rawText) => {
  const input = String(rawText || "").trim();
  if (!input) return [];

  const protectedTokens = [];
  const stash = (match) => {
    const idx = protectedTokens.length;
    protectedTokens.push(match);
    return `__AT_TOKEN_${idx}__`;
  };

  const stashUrl = (match) => {
    const trimmed = match.match(/^(.*?)([.!?)\]]+)$/);
    if (trimmed && trimmed[1]) {
      return `${stash(trimmed[1])}${trimmed[2]}`;
    }
    return stash(match);
  };

  const sanitized = input
    .replace(/https?:\/\/[^\s,;]+/gi, stashUrl)
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'|“[^”\r\n]*”/g, stash)
    .replace(/\b\d+\.\d+\b/g, stash);

  const rawLines = sanitized.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const clauses = [];

  for (const line of rawLines) {
    const cleanLine = line.replace(/^(?:bước\s*\d+\s*[:.-]?|\d+[.)]\s+|[-*•]\s+)/i, "").trim();
    const parts = cleanLine
      .split(/\s*;\s*|\.\s+(?=[A-ZÀ-Ỹa-zà-ỹ__])|\.\s*$/)
      .map((p) => p.replace(/^(?:bước\s*\d+\s*[:.-]?|\d+[.)]\s+|[-*•]\s+)/i, "").trim())
      .filter(Boolean);

    for (const part of parts) {
      const restored = part.replace(/__AT_TOKEN_(\d+)__/g, (_, i) => protectedTokens[Number(i)] ?? "");
      if (restored.trim()) clauses.push(restored.trim());
    }
  }

  return clauses.length > 0 ? clauses : [input];
};
