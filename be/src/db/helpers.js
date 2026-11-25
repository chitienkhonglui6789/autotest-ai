export const DEFAULT_PROJECTS = [
  {
    id: "proj_default",
    name: "Dự án Thương mại Điện tử (SauceDemo)",
    description: "Bộ kiểm thử luồng mua hàng và đăng nhập trên trang mẫu tiêu chuẩn",
    version: 1,
    features: [
      {
        id: "feat_1",
        name: "Đăng nhập tài khoản hợp lệ",
        steps: [
          "Vào trang https://www.saucedemo.com",
          "Nhập standard_user vào ô Username",
          "Nhập secret_sauce vào ô Password",
          "Bấm nút Login",
          "Kiểm tra xuất hiện chữ Products",
        ],
      },
      {
        id: "feat_2",
        name: "Đăng nhập sai mật khẩu (Negative Test)",
        steps: [
          "Vào trang https://www.saucedemo.com",
          "Nhập standard_user vào ô Username",
          "Nhập sai_mat_khau_123 vào ô Password",
          "Bấm nút Login",
          "Kiểm tra hiển thị thông báo lỗi Username and password do not match",
        ],
      },
      {
        id: "feat_3",
        name: "Thêm sản phẩm vào giỏ hàng & Kiểm tra",
        steps: [
          "Vào trang https://www.saucedemo.com",
          "Nhập standard_user vào ô Username",
          "Nhập secret_sauce vào ô Password",
          "Bấm nút Login",
          "Bấm nút Add to cart của sản phẩm Sauce Labs Backpack",
          "Kiểm tra số lượng giỏ hàng hiển thị 1",
        ],
      },
    ],
  },
];

/**
 * Chuẩn hóa chuỗi văn bản bước kiểm thử để dùng cho step_cache
 */
export function normalizeStepText(stepText) {
  return String(stepText || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Phân tích an toàn JSON string, trả về fallback nếu lỗi
 */
export function safeJsonParse(raw, fallback) {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Chuyển đổi chuỗi thời gian ISO / timestamp thành milliseconds để SQL sort chính xác
 */
export function parseTimestampMs(value, fallbackMs = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return fallbackMs;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : fallbackMs;
}

/**
 * Trích xuất tên thư mục con nằm dưới `screenshots/` từ URL hoặc đường dẫn tương đối.
 * Bỏ qua thư mục hệ thống (`temp_uploads`, `downloads`).
 */
export function extractScreenshotDirName(rawUrl) {
  const normalized = String(rawUrl || "").trim().replace(/\\/g, "/");
  if (!normalized) return null;
  const match = normalized.match(/(?:^|\/)screenshots\/([^/?#]+)/i);
  if (!match || !match[1]) return null;
  const dir = match[1].trim();
  if (!dir || dir === "." || dir === ".." || dir === "temp_uploads" || dir === "downloads") {
    return null;
  }
  return dir;
}

/**
 * Trích xuất toàn bộ ảnh chụp từ danh sách bước hoặc stepResults
 */
export function extractScreenshotsFromSteps(steps) {
  if (!Array.isArray(steps)) return [];
  const list = [];
  const seenUrls = new Set();

  for (const st of steps) {
    if (!st || typeof st !== "object") continue;

    if (Array.isArray(st.screenshots)) {
      for (const s of st.screenshots) {
        if (!s || !s.url) continue;
        const url = String(s.url).trim();
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        const dirName = extractScreenshotDirName(url);
        if (!dirName) continue;
        list.push({
          url,
          dirName,
          type: s.type || "after",
          label: s.label || null,
          sublabel: s.sublabel || null,
        });
      }
    }

    if (st.screenshotUrl) {
      const url = String(st.screenshotUrl).trim();
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        const dirName = extractScreenshotDirName(url);
        if (dirName) {
          list.push({
            url,
            dirName,
            type: "after",
            label: "Ảnh chụp",
            sublabel: "Kết quả",
          });
        }
      }
    }
  }

  return list;
}

/**
 * Chuyển đổi đối tượng null-prototype từ node:sqlite sang plain JS object
 */
export function toPlainRow(row) {
  return row ? { ...row } : null;
}

/**
 * Phân tích metadata từ key của step_cache.json cũ
 */
export function parseLegacyStepCacheKey(key, entry) {
  let projectId = entry?.projectId || "default";
  let featureId = entry?.featureId || "default";
  const parts = String(key || "").split("::");

  if (parts.length >= 3) {
    projectId = parts[0];
    featureId = parts[1];
  } else if (parts.length === 2 && parts[1].startsWith("*:")) {
    projectId = parts[0];
    featureId = "*";
  }

  const rawTail = parts.length >= 2 ? parts[parts.length - 1].replace(/^\*:/, "") : "";
  const normalizedText = normalizeStepText(entry?.stepText || rawTail);

  return {
    cacheKey: String(key),
    projectId: String(projectId || "default"),
    featureId: String(featureId || "default"),
    routePath: String(entry?.routePath || ""),
    normalizedText,
    stepText: String(entry?.stepText || normalizedText),
  };
}
