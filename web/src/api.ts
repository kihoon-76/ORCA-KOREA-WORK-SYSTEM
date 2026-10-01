const TOKEN_KEY = "orca_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}
// persist=true: 브라우저를 닫아도 유지(localStorage) / false: 세션 동안만(sessionStorage)
export function setToken(t: string, persist = true) {
  if (persist) {
    localStorage.setItem(TOKEN_KEY, t);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, t);
    localStorage.removeItem(TOKEN_KEY);
  }
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(method: string, path: string, body?: any): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(data.error || "요청 실패", res.status);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: any) => request<T>("POST", p, b),
  put: <T = any>(p: string, b?: any) => request<T>("PUT", p, b),
  del: <T = any>(p: string) => request<T>("DELETE", p),
  upload: async (file: File, entityType: string, entityId: number, category: string, description?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entity_type", entityType);
    fd.append("entity_id", String(entityId));
    fd.append("category", category);
    if (description) fd.append("description", description);
    return request("POST", "/files/upload", fd);
  },
  uploadChat: async (channelId: number, file: File, body = "") => {
    const fd = new FormData();
    fd.append("file", file);
    if (body) fd.append("body", body);
    return request(`POST`, `/chat/channels/${channelId}/upload`, fd);
  },
  download: async (id: number, fileName: string) => {
    const token = getToken();
    const res = await fetch(`/api/files/download/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError("다운로드 실패", res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  // 파일을 바로 다운로드하지 않고 새 탭에서 미리보기로 열어준다 (이미지/PDF는 브라우저가 바로 보여주고,
  // 그 외 형식은 브라우저가 지원하는 대로 처리됨 — 다운로드가 필요하면 별도 다운로드 버튼 사용)
  preview: async (id: number) => {
    const token = getToken();
    const res = await fetch(`/api/files/download/${id}?inline=1`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError("미리보기 실패", res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // 새 탭이 로드할 시간을 준 뒤 해제 (너무 빨리 해제하면 미리보기가 깨질 수 있음)
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
