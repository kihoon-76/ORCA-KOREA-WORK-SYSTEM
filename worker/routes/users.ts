import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware, requireRole } from "../middleware";
import { hashPassword } from "../auth";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 직원 목록 (담당자 선택 등에 사용) — 로그인 사용자 누구나
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, role, department, position, active FROM users ORDER BY name"
  ).all();
  return c.json({ items: results });
});

// 직원 등록 (admin)
app.post("/", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  if (!b.email || !b.name || !b.password) return c.json({ error: "필수 항목 누락" }, 400);
  const hash = await hashPassword(b.password);
  try {
    const res = await c.env.DB.prepare(
      "INSERT INTO users (email, name, password_hash, role, department, position) VALUES (?,?,?,?,?,?)"
    ).bind(b.email, b.name, hash, b.role || "staff", b.department || null, b.position || null).run();
    return c.json({ ok: true, id: res.meta.last_row_id });
  } catch (e: any) {
    return c.json({ error: "이미 존재하는 이메일입니다" }, 400);
  }
});

app.put("/:id", requireRole("admin"), async (c) => {
  const b = await c.req.json<any>();
  const fields: string[] = [];
  const binds: any[] = [];
  for (const k of ["name", "role", "department", "position", "active"]) {
    if (b[k] !== undefined) { fields.push(`${k} = ?`); binds.push(b[k]); }
  }
  if (b.password) { fields.push("password_hash = ?"); binds.push(await hashPassword(b.password)); }
  if (!fields.length) return c.json({ error: "변경할 내용이 없습니다" }, 400);
  binds.push(c.req.param("id"));
  await c.env.DB.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).bind(...binds).run();
  return c.json({ ok: true });
});

export default app;
