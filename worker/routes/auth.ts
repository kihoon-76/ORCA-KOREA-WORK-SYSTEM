import { Hono } from "hono";
import type { Env, Variables, JwtPayload } from "../types";
import { hashPassword, verifyPassword, signJwt } from "../auth";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 최초 1회: users 테이블이 비어있으면 기본 계정 생성
app.post("/bootstrap", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").all<{ n: number }>();
  if ((results?.[0]?.n ?? 0) > 0) {
    return c.json({ error: "이미 초기화되었습니다" }, 400);
  }
  const seed = [
    { email: "admin@orca.co.kr", name: "관리자", role: "admin", department: "경영지원", position: "시스템관리자", pw: "admin1234" },
    { email: "ceo@orca.co.kr", name: "대표이사", role: "ceo", department: "경영", position: "대표이사", pw: "ceo1234" },
    { email: "finance@orca.co.kr", name: "재무차장", role: "finance", department: "재무팀", position: "차장", pw: "finance1234" },
    { email: "staff@orca.co.kr", name: "홍길동", role: "staff", department: "영업팀", position: "사원", pw: "staff1234" },
  ];
  for (const u of seed) {
    const hash = await hashPassword(u.pw);
    await c.env.DB.prepare(
      "INSERT INTO users (email, name, password_hash, role, department, position) VALUES (?,?,?,?,?,?)"
    ).bind(u.email, u.name, hash, u.role, u.department, u.position).run();
  }
  return c.json({ ok: true, accounts: seed.map((s) => ({ email: s.email, pw: s.pw, role: s.role })) });
});

app.post("/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  if (!email || !password) return c.json({ error: "이메일과 비밀번호를 입력하세요" }, 400);
  const user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE email = ? AND active = 1"
  ).bind(email).first<any>();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" }, 401);
  }
  const payload: JwtPayload = {
    uid: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7일
  };
  const token = await signJwt(payload, c.env.JWT_SECRET);
  return c.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, department: user.department, position: user.position } });
});

app.get("/me", authMiddleware, async (c) => {
  const u = c.get("user");
  const user = await c.env.DB.prepare(
    "SELECT id, email, name, role, department, position FROM users WHERE id = ?"
  ).bind(u.uid).first();
  return c.json({ user });
});

export default app;
