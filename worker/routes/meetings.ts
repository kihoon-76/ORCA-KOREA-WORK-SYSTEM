import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const SELECT = `SELECT mt.*, u.name AS creator_name FROM meetings mt
  LEFT JOIN users u ON mt.created_by = u.id`;

// 진행중인 회의 목록
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE mt.active = 1 ORDER BY mt.created_at DESC`).all();
  return c.json({ items: results });
});

// 회의 생성 → 고유 Jitsi 방 식별자 발급
app.post("/", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "회의 이름을 입력하세요" }, 400);
  const room = `orca-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const res = await c.env.DB.prepare("INSERT INTO meetings (name, room, created_by) VALUES (?,?,?)")
    .bind(name.trim(), room, c.get("user").uid).run();
  const row = await c.env.DB.prepare(`${SELECT} WHERE mt.id = ?`).bind(res.meta.last_row_id).first();
  return c.json({ ok: true, item: row });
});

// 회의 종료 (개설자 또는 관리자)
app.delete("/:id", async (c) => {
  const user = c.get("user");
  const mt = await c.env.DB.prepare("SELECT * FROM meetings WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!mt) return c.json({ error: "회의를 찾을 수 없습니다" }, 404);
  if (mt.created_by !== user.uid && user.role !== "admin") return c.json({ error: "권한이 없습니다" }, 403);
  await c.env.DB.prepare("UPDATE meetings SET active = 0 WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default app;
