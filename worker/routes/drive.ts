import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { insertRow, deleteRow } from "../crud";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 폴더 목록 (parent_id 없으면 최상위/루트)
app.get("/folders", async (c) => {
  const parentId = c.req.query("parent_id");
  const sql = `SELECT f.*, u.name AS created_by_name FROM drive_folders f
               LEFT JOIN users u ON u.id = f.created_by
               WHERE f.parent_id ${parentId ? "= ?" : "IS NULL"} ORDER BY f.name`;
  const stmt = parentId ? c.env.DB.prepare(sql).bind(parentId) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return c.json({ items: results });
});

// 폴더 경로 (breadcrumb)
app.get("/folders/:id/path", async (c) => {
  const path: { id: number; name: string }[] = [];
  let curId: number | null = parseInt(c.req.param("id"), 10);
  while (curId) {
    const row: { id: number; name: string; parent_id: number | null } | null = await c.env.DB.prepare(
      "SELECT id, name, parent_id FROM drive_folders WHERE id = ?"
    ).bind(curId).first();
    if (!row) break;
    path.unshift({ id: row.id, name: row.name });
    curId = row.parent_id;
  }
  return c.json({ path });
});

app.post("/folders", async (c) => {
  const body = await c.req.json();
  const name = String(body.name || "").trim();
  if (!name) return c.json({ error: "폴더명을 입력하세요" }, 400);
  const parentId = body.parent_id ? Number(body.parent_id) : null;
  return insertRow(c, "drive_folders", { name, parent_id: parentId, created_by: c.get("user").uid });
});

app.delete("/folders/:id", async (c) => {
  const id = c.req.param("id");
  const sub = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM drive_folders WHERE parent_id = ?").bind(id).first<{ n: number }>();
  const files = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM attachments WHERE entity_type = 'drive_folder' AND entity_id = ?").bind(id).first<{ n: number }>();
  if ((sub?.n ?? 0) > 0 || (files?.n ?? 0) > 0) {
    return c.json({ error: "폴더 안에 파일 또는 하위 폴더가 있어 삭제할 수 없습니다. 먼저 비워주세요." }, 400);
  }
  return deleteRow(c, "drive_folders", id);
});

// 드라이브 전체 사용 용량
app.get("/usage", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(size), 0) AS total_bytes, COUNT(*) AS file_count FROM attachments WHERE entity_type = 'drive_folder'`
  ).first<{ total_bytes: number; file_count: number }>();
  return c.json({ total_bytes: row?.total_bytes ?? 0, file_count: row?.file_count ?? 0 });
});

export default app;
