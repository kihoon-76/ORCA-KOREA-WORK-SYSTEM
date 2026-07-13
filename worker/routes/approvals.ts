import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 결재선 정의: 문서 유형별 결재 단계 (role 순서)
const APPROVAL_FLOWS: Record<string, string[]> = {
  payment: ["ceo"],        // 자금결제: 재무차장 상신 -> 대표 승인
  general: ["ceo"],        // 일반 결재
  trip: ["ceo"],           // 출장 결재
  weekly: ["ceo"],         // 주간결산: 담당자 상신 -> 대표 승인
};

// 열람권 테이블 보장 (원격 DB 마이그레이션 없이도 동작하도록 런타임 생성)
async function ensureViewers(db: any) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS approval_viewers (
       approval_id INTEGER NOT NULL,
       user_id     INTEGER NOT NULL,
       PRIMARY KEY (approval_id, user_id)
     )`
  ).run();
}

// 열람 권한 판정: 전체보기/상세에서 결재 내용을 볼 수 있는가
//  - 대표(ceo)·관리자(admin): 전체 열람
//  - 상신자 본인 / 결재 대상 역할 / 상신자가 지정한 열람자
//  - 재무차장(finance)이 올린 자금결제는 재무차장도 열람 가능
function canViewApproval(
  a: { requester_id: number; doc_type: string; requester_role?: string },
  user: { uid: number; role: string },
  viewerIds: Set<number>,
  approverRoles: Set<string>
): boolean {
  if (user.role === "admin" || user.role === "ceo") return true;
  if (a.requester_id === user.uid) return true;
  if (viewerIds.has(user.uid)) return true;
  if (approverRoles.has(user.role)) return true;
  if (a.requester_role === "finance" && a.doc_type === "payment" && user.role === "finance") return true;
  return false;
}

// 목록: ?inbox=1 (내가 결재할 차례) | ?mine=1 (내가 상신) | 전체
app.get("/", async (c) => {
  const user = c.get("user");
  await ensureViewers(c.env.DB);
  const inbox = c.req.query("inbox");
  const mine = c.req.query("mine");
  let sql = `SELECT a.*, u.name AS requester_name, u.role AS requester_role
             FROM approvals a LEFT JOIN users u ON a.requester_id = u.id`;
  const binds: any[] = [];
  const where: string[] = [];
  if (mine) { where.push("a.requester_id = ?"); binds.push(user.uid); }
  if (inbox) {
    // 내 역할이 현재 단계의 결재 역할이고, 아직 pending 인 건
    where.push(`a.status = 'pending' AND EXISTS (
      SELECT 1 FROM approval_steps s WHERE s.approval_id = a.id
        AND s.step_order = a.current_step AND s.status = 'pending' AND s.approver_role = ?)`);
    binds.push(user.role);
  }
  // 열람 권한 필터: 대표·관리자가 아니면 볼 수 있는 문서만 노출
  if (user.role !== "admin" && user.role !== "ceo") {
    where.push(`(
      a.requester_id = ?
      OR EXISTS (SELECT 1 FROM approval_viewers v WHERE v.approval_id = a.id AND v.user_id = ?)
      OR EXISTS (SELECT 1 FROM approval_steps s2 WHERE s2.approval_id = a.id AND s2.approver_role = ?)
      OR (u.role = 'finance' AND a.doc_type = 'payment' AND ? = 'finance')
    )`);
    binds.push(user.uid, user.uid, user.role, user.role);
  }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY a.created_at DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await ensureViewers(c.env.DB);
  const item = await c.env.DB.prepare(
    `SELECT a.*, u.name AS requester_name, u.role AS requester_role
     FROM approvals a LEFT JOIN users u ON a.requester_id = u.id WHERE a.id = ?`
  ).bind(id).first<any>();
  if (!item) return c.json({ error: "결재 문서를 찾을 수 없습니다" }, 404);
  const { results: steps } = await c.env.DB.prepare(
    `SELECT s.*, u.name AS approver_name FROM approval_steps s LEFT JOIN users u ON s.approver_id = u.id
     WHERE s.approval_id = ? ORDER BY s.step_order`
  ).bind(id).all<any>();
  const { results: viewers } = await c.env.DB.prepare(
    `SELECT v.user_id, u.name FROM approval_viewers v LEFT JOIN users u ON v.user_id = u.id
     WHERE v.approval_id = ?`
  ).bind(id).all<any>();

  const viewerIds = new Set<number>(viewers.map((v: any) => v.user_id));
  const approverRoles = new Set<string>(steps.map((s: any) => s.approver_role));
  if (!canViewApproval(item, user, viewerIds, approverRoles)) {
    return c.json({ error: "이 결재 문서를 열람할 권한이 없습니다" }, 403);
  }
  return c.json({ item, steps, viewers, viewer_ids: [...viewerIds] });
});

// 상신
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<any>();
  const docType = body.doc_type || "payment";
  const flow = APPROVAL_FLOWS[docType] || APPROVAL_FLOWS.general;

  await ensureViewers(c.env.DB);
  const res = await c.env.DB.prepare(
    `INSERT INTO approvals (doc_type, title, content, amount, currency, requester_id, related_type, related_id, status, current_step)
     VALUES (?,?,?,?,?,?,?,?, 'pending', 1)`
  ).bind(
    docType, body.title, body.content || null, body.amount ?? null, body.currency || "KRW",
    user.uid, body.related_type || null, body.related_id || null
  ).run();
  const approvalId = res.meta.last_row_id;

  for (let i = 0; i < flow.length; i++) {
    await c.env.DB.prepare(
      "INSERT INTO approval_steps (approval_id, step_order, approver_role, status) VALUES (?,?,?, 'pending')"
    ).bind(approvalId, i + 1, flow[i]).run();
  }
  await setViewers(c.env.DB, approvalId as number, body.viewer_ids, user.uid);
  const item = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(approvalId).first();
  return c.json({ ok: true, item });
});

// 열람 지정자 저장(기존 지정 대체). 상신자 본인은 항상 열람 가능하므로 목록에서 제외.
async function setViewers(db: any, approvalId: number, viewerIds: any, requesterId: number) {
  await db.prepare("DELETE FROM approval_viewers WHERE approval_id = ?").bind(approvalId).run();
  if (!Array.isArray(viewerIds)) return;
  const uniq = [...new Set(viewerIds.map((v: any) => Number(v)).filter((v: number) => v && v !== requesterId))];
  for (const uid of uniq) {
    await db.prepare("INSERT OR IGNORE INTO approval_viewers (approval_id, user_id) VALUES (?,?)").bind(approvalId, uid).run();
  }
}

// 결재 처리 (승인/반려)
app.post("/:id/action", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { action, comment } = await c.req.json<{ action: "approve" | "reject"; comment?: string }>();

  const approval = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<any>();
  if (!approval) return c.json({ error: "결재 문서를 찾을 수 없습니다" }, 404);
  if (approval.status !== "pending") return c.json({ error: "이미 처리된 문서입니다" }, 400);

  const step = await c.env.DB.prepare(
    "SELECT * FROM approval_steps WHERE approval_id = ? AND step_order = ?"
  ).bind(id, approval.current_step).first<any>();
  if (!step) return c.json({ error: "결재 단계 오류" }, 400);
  if (step.approver_role !== user.role) {
    return c.json({ error: "현재 단계의 결재 권한이 없습니다" }, 403);
  }

  const newStepStatus = action === "approve" ? "approved" : "rejected";
  await c.env.DB.prepare(
    "UPDATE approval_steps SET status = ?, approver_id = ?, comment = ?, acted_at = datetime('now') WHERE id = ?"
  ).bind(newStepStatus, user.uid, comment || null, step.id).run();

  if (action === "reject") {
    await c.env.DB.prepare("UPDATE approvals SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  } else {
    // 다음 단계 존재 여부 확인
    const next = await c.env.DB.prepare(
      "SELECT * FROM approval_steps WHERE approval_id = ? AND step_order = ?"
    ).bind(id, approval.current_step + 1).first();
    if (next) {
      await c.env.DB.prepare("UPDATE approvals SET current_step = current_step + 1, updated_at = datetime('now') WHERE id = ?").bind(id).run();
    } else {
      await c.env.DB.prepare("UPDATE approvals SET status = 'approved', updated_at = datetime('now') WHERE id = ?").bind(id).run();
    }
  }
  // 주간결산 보고 연동 시 상태 동기화
  const updated = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<any>();
  if (updated?.related_type === "weekly_report" && updated.related_id && updated.status !== "pending") {
    await c.env.DB.prepare(
      "UPDATE weekly_reports SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(updated.status, updated.related_id).run();
  }
  return c.json({ ok: true, item: updated });
});

// 상신 내용 수정 (상신자 본인, 결재중(pending) 상태에서만 — 회수 후 수정)
app.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const approval = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<any>();
  if (!approval) return c.json({ error: "결재 문서를 찾을 수 없습니다" }, 404);
  if (approval.requester_id !== user.uid) return c.json({ error: "상신자만 수정할 수 있습니다" }, 403);
  if (approval.status !== "pending") return c.json({ error: "결재중인 문서만 수정할 수 있습니다" }, 400);
  const body = await c.req.json<any>();
  await c.env.DB.prepare(
    "UPDATE approvals SET title = ?, content = ?, amount = ?, currency = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(
    body.title ?? approval.title,
    body.content ?? approval.content,
    body.amount ?? null,
    body.currency || approval.currency,
    id
  ).run();
  if (body.viewer_ids !== undefined) {
    await ensureViewers(c.env.DB);
    await setViewers(c.env.DB, Number(id), body.viewer_ids, approval.requester_id);
  }
  const item = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first();
  return c.json({ ok: true, item });
});

// 상신 취소 (상신자 본인, 결재중(pending) 상태에서만 — cancelled 로 기록 남김)
app.post("/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const approval = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<any>();
  if (!approval) return c.json({ error: "결재 문서를 찾을 수 없습니다" }, 404);
  if (approval.requester_id !== user.uid) return c.json({ error: "상신자만 취소할 수 있습니다" }, 403);
  if (approval.status !== "pending") return c.json({ error: "결재중인 문서만 취소할 수 있습니다" }, 400);
  await c.env.DB.prepare("UPDATE approvals SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  const item = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first();
  return c.json({ ok: true, item });
});

app.delete("/:id", async (c) => {
  const user = c.get("user");
  const approval = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!approval) return c.json({ error: "없음" }, 404);
  if (approval.requester_id !== user.uid && user.role !== "admin") return c.json({ error: "권한 없음" }, 403);
  await c.env.DB.prepare("DELETE FROM approval_viewers WHERE approval_id = ?").bind(c.req.param("id")).run();
  await c.env.DB.prepare("DELETE FROM approvals WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default app;
