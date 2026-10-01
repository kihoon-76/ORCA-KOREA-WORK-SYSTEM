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

// 원료 수입/수출현황 건의 거래처(공급사/바이어)명 + 계약 식별용 라벨 — 백업 폴더를 거래처별/계약별로 나누는 데 사용
async function tradeFolderInfo(c: any, entityType: string, entityId: number): Promise<{ partner: string | null; contract: string }> {
  let row: any = null;
  let partnerField = "";
  if (entityType === "import") {
    row = await c.env.DB.prepare("SELECT supplier, material_name, contract_date FROM imports WHERE id = ?").bind(entityId).first();
    partnerField = "supplier";
  } else if (entityType === "export") {
    row = await c.env.DB.prepare("SELECT buyer, material_name, contract_date FROM exports WHERE id = ?").bind(entityId).first();
    partnerField = "buyer";
  }
  const partner = (row?.[partnerField] || "").toString().trim() || null;
  const parts = [row?.material_name, row?.contract_date].filter((v) => v && String(v).trim());
  const contract = `${parts.length ? parts.join(" ") : "계약"} #${entityId}`;
  return { partner, contract };
}

// 백업 폴더 경로("자동 백업" -> 엔티티 라벨 -> (거래처별인 경우) 거래처명 -> (원료 수입/수출인 경우) 계약별 폴더)를 보장하고 그 폴더 id를 반환
async function ensureBackupFolder(c: any, entityType: string, entityId: number): Promise<number> {
  const rootId = await ensureFolder(c, "자동 백업", null);
  let folderId = await ensureFolder(c, ENTITY_LABELS[entityType] || entityType, rootId);
  if (entityType === "import" || entityType === "export") {
    const { partner, contract } = await tradeFolderInfo(c, entityType, entityId);
    if (partner) folderId = await ensureFolder(c, partner, folderId);
    folderId = await ensureFolder(c, contract, folderId);
  }
  return folderId;
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
  const newId = res.meta.last_row_id as number;

  // 업로드와 동시에 "파일함" 공용 드라이브에도 자동 백업 (원본과 별개 R2 객체로 저장 — 원본 삭제와 무관하게 보존)
  if (entityType !== "drive_folder") {
    try {
      const subId = await ensureBackupFolder(c, entityType, entityId);
      const backupKey = `drive_folder/${subId}/${crypto.randomUUID()}_${safeName}`;
      await c.env.FILES.put(backupKey, buf, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      const backupDesc = description ? `${description} (${category})` : `[${category}] ${file.name}`;
      await c.env.DB.prepare(
        `INSERT INTO attachments (entity_type, entity_id, category, file_name, file_key, content_type, size, uploaded_by, description, backup_source_id)
         VALUES ('drive_folder',?,?,?,?,?,?,?,?,?)`
      ).bind(subId, category, file.name, backupKey, file.type || null, file.size, user.uid, backupDesc, newId).run();
    } catch {
      // 백업 실패는 원본 업로드 성공을 막지 않음
    }
  }

  return c.json({ ok: true, id: newId, file_name: file.name, file_key: key });
});

// 과거에 올라와 아직 자동 백업이 안 된 파일들을 거래처(공급사/바이어)별로 파일함에 백업
// kind: "import" | "export"
app.post("/backfill-trade-backup", authMiddleware, async (c) => {
  const kind = String(c.req.query("kind") || "import");
  if (kind !== "import" && kind !== "export") return c.json({ error: "kind는 import 또는 export 여야 합니다" }, 400);
  const user = c.get("user");

  const { results: originals } = await c.env.DB.prepare(
    `SELECT * FROM attachments WHERE entity_type = ? AND category IN ('contract','shipping_docs','settlement') ORDER BY id`
  ).bind(kind).all<any>();

  let backedUp = 0, moved = 0, skipped = 0, failed = 0;
  for (const orig of originals) {
    try {
      const targetFolderId = await ensureBackupFolder(c, kind, orig.entity_id);
      const already: any = await c.env.DB.prepare("SELECT id, entity_id FROM attachments WHERE backup_source_id = ?").bind(orig.id).first();
      if (already) {
        // 이미 백업되어 있던 파일 — 폴더 구조가 바뀌었으면(거래처/계약별 폴더 신설 등) 새 위치로 옮겨줌
        if (already.entity_id !== targetFolderId) {
          await c.env.DB.prepare("UPDATE attachments SET entity_id = ? WHERE id = ?").bind(targetFolderId, already.id).run();
          moved++;
        } else {
          skipped++;
        }
        continue;
      }
      const obj = await c.env.FILES.get(orig.file_key);
      if (!obj) { failed++; continue; }
      const buf = await obj.arrayBuffer();
      const safeName = orig.file_name.replace(/[^\w.\-가-힣]/g, "_");
      const backupKey = `drive_folder/${targetFolderId}/${crypto.randomUUID()}_${safeName}`;
      await c.env.FILES.put(backupKey, buf, { httpMetadata: { contentType: orig.content_type || "application/octet-stream" } });
      const backupDesc = orig.description ? `${orig.description} (${orig.category})` : `[${orig.category}] ${orig.file_name}`;
      await c.env.DB.prepare(
        `INSERT INTO attachments (entity_type, entity_id, category, file_name, file_key, content_type, size, uploaded_by, description, backup_source_id)
         VALUES ('drive_folder',?,?,?,?,?,?,?,?,?)`
      ).bind(targetFolderId, orig.category, orig.file_name, backupKey, orig.content_type || null, orig.size, user.uid, backupDesc, orig.id).run();
      backedUp++;
    } catch {
      failed++;
    }
  }
  return c.json({ ok: true, total: originals.length, backed_up: backedUp, moved, skipped, failed });
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
  const inline = c.req.query("inline") === "1";
  const headers = new Headers();
  headers.set("Content-Type", row.content_type || "application/octet-stream");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
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
