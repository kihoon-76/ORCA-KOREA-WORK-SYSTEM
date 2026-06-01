import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 담당자(보고 대상): 대표/관리자를 제외한 모든 직원
function isReporter(role: string) {
  return role !== "ceo" && role !== "admin";
}

// 주간결산 목록
//  ?mine=1  : 내가 작성한 보고
//  (대표/관리자) 기본 : 상신된 전체 보고
app.get("/", async (c) => {
  const user = c.get("user");
  const mine = c.req.query("mine");
  const weekStart = c.req.query("week_start");
  let sql = `SELECT w.*, u.name AS user_name, u.department AS user_department,
                    a.status AS approval_status, a.current_step AS approval_step
             FROM weekly_reports w
             LEFT JOIN users u ON w.user_id = u.id
             LEFT JOIN approvals a ON w.approval_id = a.id`;
  const where: string[] = [];
  const binds: any[] = [];
  if (mine || isReporter(user.role)) {
    where.push("w.user_id = ?");
    binds.push(user.uid);
  } else {
    // 대표/관리자: 초안(draft)은 제외하고 상신된 것만
    where.push("w.status != 'draft'");
  }
  if (weekStart) { where.push("w.week_start = ?"); binds.push(weekStart); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY w.week_start DESC, u.name";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

// 팝업/알림용 상태: 이번 주 내 보고 상신 여부 + (대표) 미결재 주간결산 건수
app.get("/status", async (c) => {
  const user = c.get("user");
  const weekStart = c.req.query("week_start"); // 프론트(로컬시간)에서 계산한 이번 주 월요일
  const reporter = isReporter(user.role);

  let myReport: any = null;
  if (reporter && weekStart) {
    myReport = await c.env.DB.prepare(
      "SELECT id, status FROM weekly_reports WHERE user_id = ? AND week_start = ?"
    ).bind(user.uid, weekStart).first();
  }
  // 상신 완료로 인정: submitted | approved (반려는 미이행으로 간주 → 재상신 필요)
  const submitted = !!myReport && (myReport.status === "submitted" || myReport.status === "approved");

  let ceoPending = 0;
  if (user.role === "ceo") {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM approvals a
       WHERE a.doc_type = 'weekly' AND a.status = 'pending' AND EXISTS (
         SELECT 1 FROM approval_steps s WHERE s.approval_id = a.id
           AND s.step_order = a.current_step AND s.status = 'pending' AND s.approver_role = 'ceo')`
    ).first<{ n: number }>();
    ceoPending = row?.n ?? 0;
  }

  return c.json({
    is_reporter: reporter,
    submitted,
    my_report: myReport,
    ceo_pending: ceoPending,
  });
});

app.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const item = await c.env.DB.prepare(
    `SELECT w.*, u.name AS user_name, u.department AS user_department
     FROM weekly_reports w LEFT JOIN users u ON w.user_id = u.id WHERE w.id = ?`
  ).bind(id).first<any>();
  if (!item) return c.json({ error: "주간결산 보고를 찾을 수 없습니다" }, 404);
  // 작성자 본인, 대표, 관리자만 열람 가능
  if (item.user_id !== user.uid && user.role !== "ceo" && user.role !== "admin") {
    return c.json({ error: "열람 권한이 없습니다" }, 403);
  }
  let approval: any = null;
  let steps: any[] = [];
  if (item.approval_id) {
    approval = await c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(item.approval_id).first();
    const r = await c.env.DB.prepare(
      `SELECT s.*, u.name AS approver_name FROM approval_steps s
       LEFT JOIN users u ON s.approver_id = u.id WHERE s.approval_id = ? ORDER BY s.step_order`
    ).bind(item.approval_id).all();
    steps = r.results as any[];
  }
  return c.json({ item, approval, steps });
});

// 작성/저장 (이번 주 보고 upsert) — 작성자 본인만, 상신 전(draft/rejected)일 때만 수정
app.post("/", async (c) => {
  const user = c.get("user");
  const b = await c.req.json<any>();
  if (!b.week_start) return c.json({ error: "주(week_start) 정보가 필요합니다" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT * FROM weekly_reports WHERE user_id = ? AND week_start = ?"
  ).bind(user.uid, b.week_start).first<any>();

  if (existing) {
    if (existing.status === "submitted" || existing.status === "approved") {
      return c.json({ error: "이미 상신된 보고는 수정할 수 없습니다" }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE weekly_reports SET week_label = ?, progress = ?, completed = ?, status = 'draft', updated_at = datetime('now')
       WHERE id = ?`
    ).bind(b.week_label || null, b.progress || null, b.completed || null, existing.id).run();
    const item = await c.env.DB.prepare("SELECT * FROM weekly_reports WHERE id = ?").bind(existing.id).first();
    return c.json({ ok: true, item });
  }

  const res = await c.env.DB.prepare(
    `INSERT INTO weekly_reports (user_id, week_start, week_label, progress, completed, status)
     VALUES (?,?,?,?,?, 'draft')`
  ).bind(user.uid, b.week_start, b.week_label || null, b.progress || null, b.completed || null).run();
  const item = await c.env.DB.prepare("SELECT * FROM weekly_reports WHERE id = ?").bind(res.meta.last_row_id).first();
  return c.json({ ok: true, item });
});

// 결재 상신 → approvals(doc_type='weekly') 생성, 대표 결재함으로 전달
app.post("/:id/submit", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const report = await c.env.DB.prepare("SELECT * FROM weekly_reports WHERE id = ?").bind(id).first<any>();
  if (!report) return c.json({ error: "주간결산 보고를 찾을 수 없습니다" }, 404);
  if (report.user_id !== user.uid) return c.json({ error: "본인 보고만 상신할 수 있습니다" }, 403);
  if (report.status === "submitted" || report.status === "approved") {
    return c.json({ error: "이미 상신된 보고입니다" }, 400);
  }

  const title = `[주간결산] ${user.name} (${report.week_label || report.week_start})`;
  const content =
    `■ 진행사항\n${report.progress || "-"}\n\n■ 완료사항\n${report.completed || "-"}`;

  const res = await c.env.DB.prepare(
    `INSERT INTO approvals (doc_type, title, content, requester_id, related_type, related_id, status, current_step)
     VALUES ('weekly', ?, ?, ?, 'weekly_report', ?, 'pending', 1)`
  ).bind(title, content, user.uid, report.id).run();
  const approvalId = res.meta.last_row_id;
  await c.env.DB.prepare(
    "INSERT INTO approval_steps (approval_id, step_order, approver_role, status) VALUES (?, 1, 'ceo', 'pending')"
  ).bind(approvalId).run();

  await c.env.DB.prepare(
    "UPDATE weekly_reports SET status = 'submitted', approval_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(approvalId, report.id).run();

  const item = await c.env.DB.prepare("SELECT * FROM weekly_reports WHERE id = ?").bind(report.id).first();
  return c.json({ ok: true, item });
});

app.delete("/:id", async (c) => {
  const user = c.get("user");
  const report = await c.env.DB.prepare("SELECT * FROM weekly_reports WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!report) return c.json({ error: "없음" }, 404);
  if (report.user_id !== user.uid && user.role !== "admin") return c.json({ error: "권한 없음" }, 403);
  if (report.status === "submitted") return c.json({ error: "상신된 보고는 삭제할 수 없습니다" }, 400);
  await c.env.DB.prepare("DELETE FROM weekly_reports WHERE id = ?").bind(report.id).run();
  return c.json({ ok: true });
});

export default app;
