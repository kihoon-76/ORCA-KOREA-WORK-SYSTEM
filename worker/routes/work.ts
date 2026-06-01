import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { pick, insertRow, updateRow, deleteRow } from "../crud";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// ============ 업무 / 할일 ============
const TASK_COLS = ["title","description","status","priority","assignee_id","due_date"];

app.get("/tasks", async (c) => {
  const mine = c.req.query("mine");
  let sql = `SELECT t.*, a.name AS assignee_name, cr.name AS creator_name
             FROM tasks t LEFT JOIN users a ON t.assignee_id = a.id LEFT JOIN users cr ON t.created_by = cr.id`;
  const binds: any[] = [];
  if (mine) { sql += " WHERE t.assignee_id = ? OR t.created_by = ?"; binds.push(c.get("user").uid, c.get("user").uid); }
  sql += " ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.due_date";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});
app.post("/tasks", async (c) => {
  const data = pick(await c.req.json(), TASK_COLS);
  data.created_by = c.get("user").uid;
  return insertRow(c, "tasks", data);
});
app.put("/tasks/:id", async (c) => updateRow(c, "tasks", c.req.param("id"), pick(await c.req.json(), TASK_COLS)));
app.delete("/tasks/:id", async (c) => deleteRow(c, "tasks", c.req.param("id")));

// ============ 근태 / 출퇴근 ============
app.get("/attendance", async (c) => {
  const month = c.req.query("month"); // YYYY-MM
  const user = c.get("user");
  let sql = "SELECT * FROM attendance WHERE user_id = ?";
  const binds: any[] = [user.uid];
  if (month) { sql += " AND work_date LIKE ?"; binds.push(`${month}%`); }
  sql += " ORDER BY work_date DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

app.post("/attendance/check-in", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString();
  await c.env.DB.prepare(
    `INSERT INTO attendance (user_id, work_date, check_in) VALUES (?,?,?)
     ON CONFLICT(user_id, work_date) DO UPDATE SET check_in = COALESCE(check_in, excluded.check_in)`
  ).bind(user.uid, date, time).run();
  const row = await c.env.DB.prepare("SELECT * FROM attendance WHERE user_id=? AND work_date=?").bind(user.uid, date).first();
  return c.json({ ok: true, item: row });
});

app.post("/attendance/check-out", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString();
  await c.env.DB.prepare(
    `INSERT INTO attendance (user_id, work_date, check_out) VALUES (?,?,?)
     ON CONFLICT(user_id, work_date) DO UPDATE SET check_out = excluded.check_out`
  ).bind(user.uid, date, time).run();
  const row = await c.env.DB.prepare("SELECT * FROM attendance WHERE user_id=? AND work_date=?").bind(user.uid, date).first();
  return c.json({ ok: true, item: row });
});

// 휴가 신청
app.get("/leaves", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, u.name AS user_name FROM leave_requests l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC`
  ).all();
  return c.json({ items: results });
});
const LEAVE_COLS = ["leave_type","start_date","end_date","reason"];
app.post("/leaves", async (c) => {
  const data = pick(await c.req.json(), LEAVE_COLS);
  data.user_id = c.get("user").uid;
  return insertRow(c, "leave_requests", data);
});
app.put("/leaves/:id/status", async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  return updateRow(c, "leave_requests", c.req.param("id"), { status });
});

// ============ 일정 / 캘린더 ============
const EVENT_COLS = ["title","description","event_type","start_date","end_date","all_day"];
app.get("/events", async (c) => {
  const month = c.req.query("month");
  let sql = "SELECT * FROM calendar_events";
  const binds: any[] = [];
  if (month) { sql += " WHERE start_date LIKE ?"; binds.push(`${month}%`); }
  sql += " ORDER BY start_date";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});
app.post("/events", async (c) => {
  const data = pick(await c.req.json(), EVENT_COLS);
  data.created_by = c.get("user").uid;
  return insertRow(c, "calendar_events", data);
});
app.put("/events/:id", async (c) => updateRow(c, "calendar_events", c.req.param("id"), pick(await c.req.json(), EVENT_COLS)));
app.delete("/events/:id", async (c) => deleteRow(c, "calendar_events", c.req.param("id")));

export default app;
