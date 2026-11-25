import { BadRequestError } from "../errors/AppError.js";

/**
 * Kiểm tra hostname có phải loopback / IP mạng nội bộ RFC1918 / tên miền local hay không.
 */
function isLocalOrPrivateHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;

  if (
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".test")
  ) {
    return true;
  }

  // Loopback IPv4: 127.0.0.0/8
  if (/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)) return true;
  // Private RFC1918: 10.0.0.0/8
  if (/^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)) return true;
  // Private RFC1918: 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // Private RFC1918: 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  const m172 = host.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const secondOctet = Number(m172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return false;
}

/**
 * Tách host + port dự kiến từ chuỗi URL chưa có scheme để quyết định http:// hay https://.
 */
function inferDefaultScheme(rawInput, allowInternalHostnames) {
  const authority = rawInput.split(/[/?#]/)[0] || "";
  const hostPort = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;

  let host = hostPort;
  let port = "";

  if (hostPort.startsWith("[")) {
    const closeBracket = hostPort.indexOf("]");
    if (closeBracket > 0) {
      host = hostPort.slice(0, closeBracket + 1);
      const rest = hostPort.slice(closeBracket + 1);
      if (rest.startsWith(":")) port = rest.slice(1);
    }
  } else {
    const lastColon = hostPort.lastIndexOf(":");
    if (lastColon > 0) {
      const maybePort = hostPort.slice(lastColon + 1);
      if (/^\d+$/.test(maybePort)) {
        host = hostPort.slice(0, lastColon);
        port = maybePort;
      }
    }
  }

  // Nếu có port tường minh khác 443 (vd: 3000, 5173, 8080, 80) -> mặc định http://
  if (port && port !== "443") {
    return "http://";
  }

  // Nếu là localhost, loopback, IP mạng LAN (192.168.x.x, 10.x.x.x, 172.16-31.x.x), đuôi .local/.internal
  if (isLocalOrPrivateHost(host)) {
    return port === "443" ? "https://" : "http://";
  }

  // Hostname nội bộ không có dấu chấm (nếu cấu hình bật hoặc đi kèm path/port nội bộ)
  if (!host.includes(".") && (allowInternalHostnames || rawInput.includes("/") || Boolean(port))) {
    return port === "443" ? "https://" : "http://";
  }

  return "https://";
}

/**
 * Chuẩn hóa và xác thực URL
 * - "abc.com" → "https://abc.com/"
 * - "localhost:5173", "127.0.0.1:3000", "192.168.1.10", "10.0.0.5:8080", "app.com:8080" → "http://..."
 * - "http://intranet/login", "erp-portal:3000" (hoặc bare hostname khi ALLOW_INTERNAL_HOSTNAMES=true) → hợp lệ với "http://..."
 *
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.allowInternalHostnames]
 * @returns {string}
 */
export const toUrl = (text, options = {}) => {
  if (typeof text !== "string" || !text.trim()) {
    throw new BadRequestError("Địa chỉ URL không được để trống");
  }

  const raw = text.trim();
  const hasExplicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const allowInternalHostnames =
    options.allowInternalHostnames ??
    String(process.env.ALLOW_INTERNAL_HOSTNAMES || "").trim().toLowerCase() === "true";

  const candidateUrl = hasExplicitScheme
    ? raw
    : `${inferDefaultScheme(raw, allowInternalHostnames)}${raw}`;

  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch {
    throw new BadRequestError(`"${text}" không phải địa chỉ hợp lệ`);
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new BadRequestError(`Chỉ cho phép http/https, nhận được "${parsed.protocol}"`);
  }

  const host = parsed.hostname.toLowerCase();
  const hasExplicitPort = Boolean(parsed.port);
  const hasExplicitPath = parsed.pathname && parsed.pathname !== "/";
  const isBareSingleLabelHost =
    !host.includes(".") &&
    !isLocalOrPrivateHost(host) &&
    !hasExplicitScheme &&
    !hasExplicitPort &&
    !hasExplicitPath &&
    !allowInternalHostnames;

  if (isBareSingleLabelHost) {
    throw new BadRequestError(`"${text}" chưa phải địa chỉ đầy đủ (thiếu đuôi như .com hoặc bật ALLOW_INTERNAL_HOSTNAMES=true)`);
  }

  return parsed.href;
};

/**
 * Chuẩn hóa URL hiện tại thành route_path dùng cho Route-Scoped Cache:
 * - Giữ pathname đã bỏ slash dư / trailing slash (trừ root '/')
 * - Giữ SPA hash route bắt đầu bằng '#/' hoặc '#!/' (đã loại bỏ query string trong hash)
 * - Loại bỏ hoàn toàn query string (?...) và anchor hash thông thường (#section)
 */
export function extractRoutePath(rawUrl) {
  const input = String(rawUrl || "").trim();
  if (!input || /^(?:about:|data:|javascript:|blob:)/i.test(input)) {
    return "";
  }

  let parsed;
  try {
    if (input.startsWith("/")) {
      parsed = new URL(input, "http://route.local");
    } else if (/^#!?\//.test(input)) {
      parsed = new URL(`/${input}`, "http://route.local");
    } else {
      parsed = new URL(input);
    }
  } catch {
    return "";
  }

  if (!/^(?:https?|file):$/i.test(parsed.protocol)) {
    return "";
  }

  let cleanPath = String(parsed.pathname || "/").replace(/\/{2,}/g, "/");
  if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.slice(0, -1);
  }

  let cleanHash = "";
  const rawHash = String(parsed.hash || "");
  if (/^#!?\//.test(rawHash)) {
    const qIdx = rawHash.indexOf("?");
    const baseHash = qIdx >= 0 ? rawHash.slice(0, qIdx) : rawHash;
    const prefix = baseHash.startsWith("#!/") ? "#!/" : "#/";
    let rest = baseHash.slice(prefix.length).replace(/\/{2,}/g, "/");
    if (rest.endsWith("/")) {
      rest = rest.slice(0, -1);
    }
    cleanHash = `${prefix}${rest}`;
  }

  return `${cleanPath}${cleanHash}`;
}

function canonicalizeRouteIds(route) {
  return String(route || "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, "/:oid");
}

function normalizeRouteInput(value) {
  const raw = String(value || "").trim();
  if (!raw || /^(?:about:|data:|javascript:|blob:)/i.test(raw)) {
    return "";
  }
  const extracted = extractRoutePath(raw);
  if (extracted) return extracted;
  // Hỗ trợ trường hợpCaller truyền route tương đối không có dấu '/' đầu (vd: "orders/edit")
  if (!raw.includes("://")) {
    return extractRoutePath(`/${raw.replace(/^\/+/, "")}`);
  }
  return "";
}

/**
 * Kiểm tra route đã ghi trong Cache có tương thích với route hiện tại của trình duyệt hay không.
 */
export function isRouteCompatible(savedRoute, currentRoute) {
  const saved = normalizeRouteInput(savedRoute);
  const current = normalizeRouteInput(currentRoute);

  if (saved === current) return true;
  if (!saved || !current) return false;

  return canonicalizeRouteIds(saved) === canonicalizeRouteIds(current);
}

