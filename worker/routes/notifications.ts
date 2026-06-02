import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 내 알림 목록 + 미확인 개수
app.get("/", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(user.uid).all();
  const unread = (results || []).filter((n: any) => !n.read_at).length;
  return c.json({ items: results, unread });
});

// 단건 확인 처리
app.post("/:id/read", async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL"
  ).bind(c.req.param("id"), user.uid).run();
  return c.json({ ok: true });
});

// 전체 확인 처리
app.post("/read-all", async (c) => {
  const user = c.get("user");
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL"
  ).bind(user.uid).run();
  return c.json({ ok: true });
});

export default app;

// 알림 생성 헬퍼 (다른 라우트에서 재사용)
export async function notify(
  db: D1Database,
  userId: number,
  type: string,
  title: string,
  body?: string,
  relatedType?: string,
  relatedId?: number
) {
  await db.prepare(
    `INSERT INTO notifications (user_id, type, title, body, related_type, related_id)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, type, title, body ?? null, relatedType ?? null, relatedId ?? null).run();
}
