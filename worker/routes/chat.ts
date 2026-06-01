import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const MSG_SELECT = `SELECT m.id, m.channel_id, m.user_id, m.body, m.created_at, m.attachment_id,
  u.name AS user_name, u.role AS user_role,
  a.file_name, a.content_type, a.size AS file_size
  FROM chat_messages m
  LEFT JOIN users u ON m.user_id = u.id
  LEFT JOIN attachments a ON m.attachment_id = a.id`;

// 채널 목록 (없으면 기본 '전체' 채널 자동 생성)
app.get("/channels", async (c) => {
  const list = async () => (await c.env.DB.prepare(
    `SELECT ch.*,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.channel_id = ch.id) AS message_count,
       (SELECT MAX(created_at) FROM chat_messages m WHERE m.channel_id = ch.id) AS last_at
     FROM chat_channels ch ORDER BY ch.id`
  ).all()).results;
  let results = await list();
  if (!results || results.length === 0) {
    await c.env.DB.prepare("INSERT INTO chat_channels (name, created_by) VALUES ('전체', ?)")
      .bind(c.get("user").uid).run();
    results = await list();
  }
  return c.json({ items: results });
});

app.post("/channels", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) return c.json({ error: "채널 이름을 입력하세요" }, 400);
  const res = await c.env.DB.prepare("INSERT INTO chat_channels (name, created_by) VALUES (?, ?)")
    .bind(name.trim(), c.get("user").uid).run();
  const row = await c.env.DB.prepare("SELECT * FROM chat_channels WHERE id = ?")
    .bind(res.meta.last_row_id).first();
  return c.json({ ok: true, item: row });
});

// 메시지 검색 (body LIKE, 특정 채널 또는 전체)
app.get("/search", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const channelId = c.req.query("channel_id");
  if (!q) return c.json({ items: [] });
  let sql = `${MSG_SELECT} WHERE m.body LIKE ? ESCAPE '\\'`;
  const safe = q.replace(/[\\%_]/g, (m) => "\\" + m);
  const binds: any[] = [`%${safe}%`];
  if (channelId) { sql += " AND m.channel_id = ?"; binds.push(channelId); }
  sql += " ORDER BY m.id DESC LIMIT 100";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

// 파일 업로드 → R2 저장 + attachments 기록 + 첨부 메시지 생성
app.post("/channels/:id/upload", async (c) => {
  const channelId = c.req.param("id");
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "파일이 없습니다" }, 400);
  const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const key = `chat/${channelId}/${crypto.randomUUID()}_${safeName}`;
  await c.env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  const att = await c.env.DB.prepare(
    `INSERT INTO attachments (entity_type, entity_id, category, file_name, file_key, content_type, size, uploaded_by)
     VALUES ('chat', ?, 'chat', ?, ?, ?, ?, ?)`
  ).bind(channelId, file.name, key, file.type || null, file.size, user.uid).run();
  const body = String(form.get("body") || "");
  const msg = await c.env.DB.prepare(
    "INSERT INTO chat_messages (channel_id, user_id, body, attachment_id) VALUES (?,?,?,?)"
  ).bind(channelId, user.uid, body, att.meta.last_row_id).run();
  const row = await c.env.DB.prepare(`${MSG_SELECT} WHERE m.id = ?`).bind(msg.meta.last_row_id).first();
  return c.json({ ok: true, item: row });
});

// 메시지 조회 (after = 마지막으로 받은 메시지 id → 폴링용 증분 조회)
app.get("/channels/:id/messages", async (c) => {
  const channelId = c.req.param("id");
  const after = c.req.query("after");
  let sql = `${MSG_SELECT} WHERE m.channel_id = ?`;
  const binds: any[] = [channelId];
  if (after) { sql += " AND m.id > ?"; binds.push(after); }
  sql += " ORDER BY m.id ASC LIMIT 300";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

app.post("/channels/:id/messages", async (c) => {
  const channelId = c.req.param("id");
  const { body } = await c.req.json<{ body: string }>();
  if (!body?.trim()) return c.json({ error: "내용을 입력하세요" }, 400);
  const user = c.get("user");
  const res = await c.env.DB.prepare("INSERT INTO chat_messages (channel_id, user_id, body) VALUES (?,?,?)")
    .bind(channelId, user.uid, body.trim()).run();
  const row = await c.env.DB.prepare(`${MSG_SELECT} WHERE m.id = ?`).bind(res.meta.last_row_id).first();
  return c.json({ ok: true, item: row });
});

export default app;
