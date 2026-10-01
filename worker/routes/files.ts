import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// 엔티티 종류 -> 파일함(드라이브) 자동 백업 폴더명
const ENTITY_LABELS: Record<string, string> = {
  import: "원료 수입현황", export: "원료 수출현황", inventory: "재고관리", material: "원료 분석결과",
  trip: "출장계획서", trip_report: "출장결과보고", approval: "전자결재", task: "업무",
  weekly_report: "주간결산보고", meeting: "화상회의",
};

async function ensureFolder(c: any, name: string, parentId: number | null): Promise<number> {
  const row: { id: number } | null = parentId === null
    ? await c.env.DB.prepare("SELECT id FROM drive_folders WHERE name = ? AND parent_id IS NULL").bind(name).first()
    : await c.env.DB.prepare("SELECT id FROM drive_folders WHERE name = ? AND parent_id = ?").bind(name, parentId).first();
  if (row) return row.id;
  const ins = await c.env.DB.prepare("INSERT INTO drive_folders (name, parent_id, created_by) VALUES (?,?,?)")
    .bind(name, parentId, c.get("user").uid).run();
  return ins.meta.last_row_id as number;
}

// 파일 업로드: multipart/form-data (file, entity_type, entity_id, category, description?)
app.post("/upload", authMiddleware, async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const file = form.get("file");
  const entityType = String(form.get("entity_type") || "");
  const entityId = parseInt(String(form.get("entity_id") || "0"), 10);
  const category = String(form.get("category") || "general");
  const description = String(form.get("description") || "").trim() || null;

  if (!(file instanceof File)) return c.json({ error: "파일이 없습니다" }, 400);
  if (!entityType || !entityId) return c.json({ error: "entity 정보가 필요합니다" }, 400);

  const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
  const buf = await file.arrayBuffer();
  const key = `${entityType}/${entityId}/${category}/${crypto.randomUUID()}_${safeName}`;
  await c.env.FILES.put(key, buf, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const res = await c.env.DB.prepare(
    `INSERT INTO attachments (entity_type, entity_id, category, file_name, file_key, content_type, size, uploaded_by, description)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(entityType, entityId, category, file.name, key, file.type || null, file.size, user.uid, description).run();

  // 업로드와 동시에 "파일함" 공용 드라이브에도 자동 백업 (원본과 별개 R2 객체로 저장 — 원본 삭제와 무관하게 보존)
  if (entityType !== "drive_folder") {
    try {
      const rootId = await ensureFolder(c, "자동 백업", null);
      const subId = await ensureFolder(c, ENTITY_LABELS[entityType] || entityType, rootId);
      const backupKey = `drive_folder/${subId}/${crypto.randomUUID()}_${safeName}`;
      await c.env.FILES.put(backupKey, buf, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      const backupDesc = description ? `${description} (${category})` : `[${category}] ${file.name}`;
      await c.env.DB.prepare(
        `INSERT INTO attachments (entity_type, entity_id, category, file_name, file_key, content_type, size, uploaded_by, description)
         VALUES ('drive_folder',?,?,?,?,?,?,?,?)`
      ).bind(subId, category, file.name, backupKey, file.type || null, file.size, user.uid, backupDesc).run();
    } catch {
      // 백업 실패는 원본 업로드 성공을 막지 않음
    }
  }

  return c.json({ ok: true, id: res.meta.last_row_id, file_name: file.name, file_key: key });
});

// 엔티티별 첨부 목록
app.get("/list", authMiddleware, async (c) => {
  const entityType = c.req.query("entity_type");
  const entityId = c.req.query("entity_id");
  const category = c.req.query("category");
  let sql = "SELECT id, entity_type, entity_id, category, file_name, content_type, size, description, created_at FROM attachments WHERE entity_type = ? AND entity_id = ?";
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

// 파일 설명 수정
app.put("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (body.description === undefined) return c.json({ error: "변경할 내용이 없습니다" }, 400);
  await c.env.DB.prepare("UPDATE attachments SET description = ? WHERE id = ?").bind(String(body.description), id).run();
  return c.json({ ok: true });
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
