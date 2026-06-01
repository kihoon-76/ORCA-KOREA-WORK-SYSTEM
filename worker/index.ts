import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { authMiddleware } from "./middleware";

import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import workRoutes from "./routes/work";
import approvalsRoutes from "./routes/approvals";
import tradeRoutes from "./routes/trade";
import inventoryRoutes from "./routes/inventory";
import materialsRoutes from "./routes/materials";
import tripsRoutes from "./routes/trips";
import filesRoutes from "./routes/files";
import chatRoutes from "./routes/chat";
import meetingsRoutes from "./routes/meetings";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.route("/auth", authRoutes);
api.route("/users", usersRoutes);
api.route("/work", workRoutes);
api.route("/approvals", approvalsRoutes);
api.route("/trade", tradeRoutes);
api.route("/inventory", inventoryRoutes);
api.route("/materials", materialsRoutes);
api.route("/trips", tripsRoutes);
api.route("/files", filesRoutes);
api.route("/chat", chatRoutes);
api.route("/meetings", meetingsRoutes);

// 대시보드 요약
api.get("/dashboard", authMiddleware, async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const [tasks, pendingApprovals, inboxApprovals, importsCnt, exportsCnt, trips] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status != 'done'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM approvals a WHERE a.status='pending' AND EXISTS (
        SELECT 1 FROM approval_steps s WHERE s.approval_id=a.id AND s.step_order=a.current_step
        AND s.status='pending' AND s.approver_role=?)`).bind(user.role).first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM imports WHERE status != 'done'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM exports WHERE status != 'done'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM business_trips WHERE status != 'completed'").first<{ n: number }>(),
  ]);
  // 다가오는 선박 일정 (ETA 기준)
  const { results: upcoming } = await db.prepare(
    `SELECT 'import' AS kind, id, material_name, vessel, eta FROM imports WHERE eta >= date('now')
     UNION ALL SELECT 'export' AS kind, id, material_name, vessel, eta FROM exports WHERE eta >= date('now')
     ORDER BY eta LIMIT 8`
  ).all();
  return c.json({
    counts: {
      open_tasks: tasks?.n ?? 0,
      pending_approvals: pendingApprovals?.n ?? 0,
      my_inbox: inboxApprovals?.n ?? 0,
      open_imports: importsCnt?.n ?? 0,
      open_exports: exportsCnt?.n ?? 0,
      open_trips: trips?.n ?? 0,
    },
    upcoming_shipments: upcoming,
  });
});

api.all("*", (c) => c.json({ error: "Not found" }, 404));

app.route("/api", api);

// 그 외 모든 요청은 정적 자산(React SPA)으로
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
