import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getToken, setToken, clearToken, ApiError } from "./api";

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  department?: string;
  position?: string;
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "관리자",
  ceo: "대표이사",
  director: "이사",
  finance: "재무차장",
  staff: "직원",
};

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch((e) => { if (e instanceof ApiError && e.status === 401) clearToken(); }) // 만료/무효 토큰만 제거 (네트워크 오류엔 유지)
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string, remember = true) {
    const r = await api.post<{ token: string; user: User }>("/auth/login", { email, password, remember });
    setToken(r.token, remember);
    setUser(r.user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}
