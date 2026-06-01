import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 파일 업로드: multipart/form-data (file, entity_type, entity_id, category)
app.post("/upload", authMiddleware, async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  const entityType = String(form.get("entity_type") || "");
  const entityId = parseInt(String(form.get("entity_id") || "0"), 10);
  const category = String(form.get("category") || "general");

  if (!(file instanceof File)) return c.json({ error: "파일이 없습니다" }, 400);
  if (!entityType || !entityId) return c.json({ error: "entity 정보가 필요합니다" }, 400);

  const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const key = `${entityType}/${entityId}/${category}/${crypto.randomUUID()}_${safeName}`;
  await c.env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const res = await c.env.DB.prepare(
    `INSERT INTO attachments (entity_type, entity_id, category, file_name, file_key, content_type, size, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(entityType, entityId, category, file.name, key, file.type || null, file.size, user.uid).run();

  return c.json({ ok: true, id: res.meta.last_row_id, file_name: file.name, file_key: key });
});

// 엔티티별 첨부 목록
app.get("/list", authMiddleware, async (c) => {
  const entityType = c.req.query("entity_type");
  const entityId = c.req.query("entity_id");
  const category = c.req.query("category");
  let sql = "SELECT id, entity_type, entity_id, category, file_name, content_type, size, created_at FROM attachments WHERE entity_type = ? AND entity_id = ?";
  const binds: any[] = [entityType, entityId];
  if (category) { sql += " AND category = ?"; binds.push(category); }
  sql += " ORDER BY created_at DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

// 다운로드 (토큰을 쿼리로 받음 — 브라우저 직접 링크용)
app.get("/download/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<any>();
  if (!row) return c.json({ error: "파일을 찾을 수 없습니다" }, 404);
  const obj = await c.env.FILES.get(row.file_key);
  if (!obj) return c.json({ error: "저장소에 파일이 없습니다" }, 404);
  const headers = new Headers();
  headers.set("Content-Type", row.content_type || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  return new Response(obj.body, { headers });
});

app.delete("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM attachments WHERE id = ?").bind(id).first<any>();
  if (!row) return c.json({ error: "파일을 찾을 수 없습니다" }, 404);
  await c.env.FILES.delete(row.file_key);
  await c.env.DB.prepare("DELETE FROM attachments WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default app;
