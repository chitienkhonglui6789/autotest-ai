const resolveApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) return String(configured).replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.hostname) {
    const { protocol, hostname, port, host } = window.location;
    // Khi chạy bản build production trực tiếp trên Express (hoặc reverse proxy không phải Vite dev server)
    if (port && port !== "5173" && port !== "4173") {
      return `${protocol}//${host}`;
    }
    const normalizedHost = hostname === "localhost" || hostname === "127.0.0.1" ? "127.0.0.1" : hostname;
    return `${protocol}//${normalizedHost}:3000`;
  }

  return "http://127.0.0.1:3000";
};

export const API_BASE_URL = resolveApiBaseUrl();

export const resolveAssetUrl = (url) => {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  // Chuẩn hóa URL localhost/127.0.0.1:3000 cũ khi mở giao diện từ máy khác trên mạng LAN
  const localMatch = url.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):3000(\/screenshots\/.*)$/i);
  if (localMatch) return `${API_BASE_URL}${localMatch[1]}`;
  return url;
};

async function parseJsonSafe(res, fallbackMsg = "Yêu cầu thất bại") {
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const errMsg = data?.error || data?.message || `${fallbackMsg} (${res.status})`;
    const err = new Error(errMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data ?? { success: true };
}

/**
 * Client API tập trung cho toàn bộ AutoTest Studio (Native Playwright + Micro-ReAct Engine)
 */
export const apiClient = {
  // 1. Health & Live Telemetry
  async getHealth(signal) {
    const res = await fetch(`${API_BASE_URL}/health`, {
      signal: signal || AbortSignal.timeout(3500),
    });
    if (!res.ok) throw new Error(`Lỗi máy chủ (${res.status})`);
    return await res.json();
  },

  async getLiveRunStatus(signal) {
    const res = await fetch(`${API_BASE_URL}/run/live`, {
      signal: signal || AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`Lỗi đọc trạng thái live (${res.status})`);
    return await res.json();
  },

  // 2. Runner Execution, Abort & Smart Step Split
  async runTest(payload, clientRunToken, signal) {
    const res = await fetch(`${API_BASE_URL}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-run-token": clientRunToken || "",
      },
      body: JSON.stringify(payload),
      signal,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  },

  async abortTest(ownerToken, force = false) {
    const res = await fetch(`${API_BASE_URL}/run/abort`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-run-token": ownerToken || "",
      },
      body: JSON.stringify({ ownerToken, force }),
    });
    return parseJsonSafe(res, "Không thể hủy phiên chạy");
  },

  async abortRun(ownerToken, force = false) {
    return this.abortTest(ownerToken, force);
  },

  async startBatch(payload, clientRunToken) {
    const res = await fetch(`${API_BASE_URL}/batches/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-run-token": clientRunToken || "",
      },
      body: JSON.stringify({
        ...payload,
        ownerToken: payload?.ownerToken ?? clientRunToken ?? "",
      }),
    });
    return parseJsonSafe(res, "Không thể khởi chạy đợt kiểm thử");
  },

  async abortBatch(batchId, ownerToken, force = false) {
    const res = await fetch(`${API_BASE_URL}/batches/${encodeURIComponent(batchId)}/abort`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-run-token": ownerToken || "",
      },
      body: JSON.stringify({ ownerToken, force }),
    });
    return parseJsonSafe(res, "Không thể hủy đợt kiểm thử");
  },

  async getBatchLiveStatus(batchId) {
    if (!batchId) return this.getLiveRunStatus();
    const res = await fetch(`${API_BASE_URL}/batches/${encodeURIComponent(batchId)}/live`);
    if (res.status === 404) {
      return { success: false, status: 404, notFound: true };
    }
    return parseJsonSafe(res, "Không thể lấy trạng thái đợt chạy trực tiếp");
  },

  async splitSteps(text, mode = "smart", signal) {
    const res = await fetch(`${API_BASE_URL}/steps/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
      signal: signal || AbortSignal.timeout(30000),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Lỗi tách bước (${res.status})`);
    }
    return data;
  },

  // 3. Step Trace Cache (Biên dịch 1 lần - Phát lại vạn lần)
  async getStepCache(projectId, featureId, signal, routePath) {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (featureId) params.set("featureId", featureId);
    if (routePath) params.set("routePath", routePath);
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`${API_BASE_URL}/cache${qs}`, {
      signal: signal || AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error("Không thể tải danh sách Step Cache");
    return await res.json();
  },

  async clearStepCache(options = {}) {
    const res = await fetch(`${API_BASE_URL}/cache`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Không thể xóa Step Cache");
    return data;
  },

  // 4. Configurations (.env & Test LLM)
  async getEnvConfig(signal) {
    const res = await fetch(`${API_BASE_URL}/config/env`, { signal });
    if (!res.ok) throw new Error("Không thể tải cấu hình env");
    return await res.json();
  },

  async saveEnvConfig(data) {
    const res = await fetch(`${API_BASE_URL}/config/env`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return parseJsonSafe(res, "Không thể lưu cấu hình .env");
  },

  async getModelConfig(signal) {
    const res = await fetch(`${API_BASE_URL}/config/model`, { signal });
    if (!res.ok) throw new Error("Không thể tải cấu hình model");
    return await res.json();
  },

  async saveModelConfig(data) {
    const res = await fetch(`${API_BASE_URL}/config/model`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return parseJsonSafe(res, "Không thể cập nhật model");
  },

  async testLlmConnection(payload = {}) {
    const res = await fetch(`${API_BASE_URL}/config/test-llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseJsonSafe(res, "Không thể kiểm tra kết nối LLM");
  },

  // 5. Projects (Granular CRUD + Bulk compatibility)
  async getProjects(signal) {
    const res = await fetch(`${API_BASE_URL}/projects`, { signal });
    if (!res.ok) throw new Error("Không thể tải danh sách dự án");
    return await res.json();
  },

  async saveProject(project, { isNew = false, force = false } = {}) {
    const url = isNew || !project?.id
      ? `${API_BASE_URL}/projects`
      : `${API_BASE_URL}/projects/${encodeURIComponent(project.id)}`;
    const method = isNew || !project?.id ? "POST" : "PUT";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...project, force }),
    });
    return parseJsonSafe(res, "Không thể lưu thông tin dự án");
  },

  async saveProjectsBulk(projects, force = false) {
    const payload = Array.isArray(projects) ? { projects, force } : projects;
    const res = await fetch(`${API_BASE_URL}/projects/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return parseJsonSafe(res, "Không thể đồng bộ danh sách dự án");
  },

  async deleteProject(projectId) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    return parseJsonSafe(res, "Không thể xóa dự án");
  },

  async getProjectVariables(projectId, signal) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/variables`, {
      signal: signal || AbortSignal.timeout(5000),
    });
    return parseJsonSafe(res, "Không thể tải danh sách biến môi trường");
  },

  async saveProjectVariables(projectId, variables) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/variables`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variables }),
    });
    return parseJsonSafe(res, "Không thể lưu danh sách biến môi trường");
  },

  async getProjectSessionStatus(projectId, signal) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/session`, {
      signal: signal || AbortSignal.timeout(4000),
    });
    return parseJsonSafe(res, "Không thể kiểm tra trạng thái phiên đăng nhập");
  },

  async clearProjectSession(projectId) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/session`, {
      method: "DELETE",
    });
    return parseJsonSafe(res, "Không thể xóa phiên đăng nhập đã lưu");
  },

  async saveFeature(projectId, feature, { isNew = false, force = false } = {}) {
    const usePut = !isNew && Boolean(feature?.id);
    const url = usePut
      ? `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(feature.id)}`
      : `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/features`;
    const res = await fetch(url, {
      method: usePut ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...feature, force }),
    });
    return parseJsonSafe(res, "Không thể lưu tính năng");
  },

  async reorderFeatures(projectId, orderedIds) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/features/reorder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    return parseJsonSafe(res, "Không thể sắp xếp thứ tự tính năng");
  },

  async importFeatures(projectId, features) {
    const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/features/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features }),
    });
    return parseJsonSafe(res, "Không thể nhập danh sách tính năng");
  },

  async deleteFeature(projectId, featureId) {
    const res = await fetch(
      `${API_BASE_URL}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}`,
      { method: "DELETE" }
    );
    return parseJsonSafe(res, "Không thể xóa tính năng");
  },

  // 6. History & Reports
  async getHistory(paramsOrSignal) {
    let signal;
    const query = new URLSearchParams();
    if (paramsOrSignal && typeof AbortSignal !== "undefined" && paramsOrSignal instanceof AbortSignal) {
      signal = paramsOrSignal;
    } else if (paramsOrSignal && typeof paramsOrSignal === "object") {
      signal = paramsOrSignal.signal;
      if (paramsOrSignal.projectId) query.set("projectId", paramsOrSignal.projectId);
      if (paramsOrSignal.featureId) query.set("featureId", paramsOrSignal.featureId);
      if (paramsOrSignal.status) query.set("status", paramsOrSignal.status);
      if (paramsOrSignal.search) query.set("search", paramsOrSignal.search);
      if (paramsOrSignal.type) query.set("type", paramsOrSignal.type);
      if (paramsOrSignal.limit !== undefined) query.set("limit", String(paramsOrSignal.limit));
      if (paramsOrSignal.offset !== undefined) query.set("offset", String(paramsOrSignal.offset));
    }
    const qs = query.toString();
    const res = await fetch(`${API_BASE_URL}/history${qs ? `?${qs}` : ""}`, { signal });
    if (!res.ok) throw new Error("Không thể tải lịch sử kiểm thử");
    return await res.json();
  },

  async saveHistory(historyList) {
    const res = await fetch(`${API_BASE_URL}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(historyList),
    });
    return parseJsonSafe(res, "Không thể lưu lịch sử");
  },

  async saveBatchRun(batch) {
    const res = await fetch(`${API_BASE_URL}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    return parseJsonSafe(res, "Không thể lưu đợt chạy");
  },

  async deleteHistoryBatch(batchId) {
    const res = await fetch(`${API_BASE_URL}/history/${encodeURIComponent(batchId)}`, {
      method: "DELETE",
    });
    return parseJsonSafe(res, "Không thể xóa đợt chạy");
  },

  async deleteBatch(batchId) {
    return this.deleteHistoryBatch(batchId);
  },

  async getBatchReport(batchId) {
    const res = await fetch(`${API_BASE_URL}/history/${encodeURIComponent(batchId)}/report`);
    if (!res.ok) throw new Error("Không thể tải báo cáo");
    return await res.text();
  },
};
