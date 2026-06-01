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

// 목록: ?inbox=1 (내가 결재할 차례) | ?mine=1 (내가 상신) | 전체
app.get("/", async (c) => {
  const user = c.get("user");
  const inbox = c.req.query("inbox");
  const mine = c.req.query("mine");
  let sql = `SELECT a.*, u.name AS requester_name FROM approvals a LEFT JOIN users u ON a.requester_id = u.id`;
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
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY a.created_at DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const item = await c.env.DB.prepare(
    `SELECT a.*, u.name AS requester_name FROM approvals a LEFT JOIN users u ON a.requester_id = u.id WHERE a.id = ?`
  ).bind(id).first();
  if (!item) return c.json({ error: "결재 문서를 찾을 수 없습니다" }, 404);
  const { results: steps } = await c.env.DB.prepare(
    `SELECT s.*, u.name AS approver_name FROM approval_steps s LEFT JOIN users u ON s.approver_id = u.id
     WHERE s.approval_id = ? ORDER BY s.step_order`
  ).bind(id).all();
  return c.json({ item, steps });
});

// 상신
app.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<any>();
  const docType = body.doc_type || "payment";
  const flow = APPROVAL_FLOWS[docType] || APPROVAL_FLOWS.general;

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
  const item = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(approvalId).first();
  return c.json({ ok: true, item });
});

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

app.delete("/:id", async (c) => {
  const user = c.get("user");
  const approval = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!approval) return c.json({ error: "없음" }, 404);
  if (approval.requester_id !== user.uid && user.role !== "admin") return c.json({ error: "권한 없음" }, 403);
  await c.env.DB.prepare("DELETE FROM approvals WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default app;
