const TOKEN_KEY = "orca_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
  upload: async (file: File, entityType: string, entityId: number, category: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entity_type", entityType);
    fd.append("entity_id", String(entityId));
    fd.append("category", category);
    return request("POST", "/files/upload", fd);
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
};
