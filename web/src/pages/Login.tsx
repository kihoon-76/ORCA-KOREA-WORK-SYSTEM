import { useState } from "react";
import { useAuth } from "../auth";
import { api } from "../api";
import { Icon } from "../components/ui";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bootMsg, setBootMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await login(email, password); }
    catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function bootstrap() {
    setError(""); setBootMsg("");
    try {
      await api.post("/auth/bootstrap");
      setBootMsg("기본 계정이 생성되었습니다. 아래 계정으로 로그인하세요.");
      setEmail("admin@orca-korea.com"); setPassword("admin1234");
    } catch (err: any) { setError(err.message); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl md:grid-cols-2">
        {/* Left brand panel */}
        <div className="hidden flex-col justify-between bg-gradient-to-br from-primary to-secondary p-10 text-on-primary md:flex">
          <div className="inline-flex w-fit items-center rounded-xl bg-white p-3 shadow-sm">
            <img src="/orca-logo.png" alt="ORCA KOREA" className="w-44" />
          </div>
          <div>
            <h2 className="headline text-3xl font-bold leading-tight">원료 수출입부터<br/>재고·결재까지<br/>한 곳에서</h2>
            <p className="mt-3 text-sm opacity-80">ORCA KOREA 통합 업무관리시스템</p>
          </div>
          <p className="mono-label opacity-50">© 2026 ORCA KOREA</p>
        </div>

        {/* Right form */}
        <div className="bg-surface-container-lowest p-8 sm:p-10">
          <img src="/orca-logo.png" alt="ORCA KOREA" className="mb-6 w-40 md:hidden" />
          <div className="mb-8">
            <h1 className="headline text-2xl font-bold text-primary">로그인</h1>
            <p className="text-sm text-on-surface-variant">계정 정보를 입력하세요</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">이메일</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@orca-korea.com" required />
            </div>
            <div>
              <label className="label">비밀번호</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="flex items-center gap-1 text-sm text-error"><Icon name="error" size={18} />{error}</p>}
            {bootMsg && <p className="flex items-center gap-1 text-sm text-success"><Icon name="check_circle" size={18} />{bootMsg}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? "로그인 중..." : "로그인"}</button>
          </form>
          <div className="mt-8 border-t border-outline-variant pt-5 text-center">
            <p className="text-[11px] leading-relaxed text-on-surface-variant opacity-70">
              계정 정보는 관리자에게 문의하세요.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
