import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

// 입찰 · 납품계획
//  · bids / bid_results: 제주 남부·중부발전소 입찰 공고와 업체별 결과(투찰단가 원/L, 낙찰수량, 결과)
//  · supply_plans: 애경·대경에 월별로 납품할 수량(MT)과 단가(낙찰 원/L → ÷0.92 → 원/kg − 운송비)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const BID_COLS = ["plant", "notice_date", "open_date", "period_from", "period_to", "total_qty", "qty_unit", "est_price", "note"];
const RESULT_COLS = ["company", "price_l", "bid_qty", "awarded_qty", "status", "rounds", "note"];
const PLAN_COLS = ["ym", "customer", "qty_mt", "price_l", "freight", "bid_id", "note"];

let ready = false;
async function ensureTables(db: D1Database) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plant TEXT NOT NULL, notice_date TEXT, open_date TEXT, period_from TEXT, period_to TEXT,
      total_qty REAL, qty_unit TEXT DEFAULT 'kL', est_price REAL, note TEXT,
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS bid_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bid_id INTEGER NOT NULL, sort INTEGER DEFAULT 0,
      company TEXT NOT NULL, price_l REAL, bid_qty REAL, awarded_qty REAL, status TEXT, rounds INTEGER, note TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS supply_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ym TEXT NOT NULL, customer TEXT NOT NULL, qty_mt REAL, price_l REAL, freight REAL DEFAULT 40, bid_id INTEGER, note TEXT,
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_bid_results_bid ON bid_results(bid_id)"),
  ]);
  ready = true;
}
function clean(body: any, cols: string[]) {
  const out: Record<string, any> = {};
  for (const k of cols) if (body[k] !== undefined) out[k] = body[k] === "" ? null : body[k];
  return out;
}

app.get("/", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const [bids, results, plans] = await Promise.all([
    db.prepare("SELECT * FROM bids ORDER BY COALESCE(period_from, open_date) DESC, id DESC").all(),
    db.prepare("SELECT * FROM bid_results ORDER BY bid_id, sort, id").all(),
    db.prepare("SELECT * FROM supply_plans ORDER BY ym DESC, customer").all(),
  ]);
  const byBid = new Map<number, any[]>();
  for (const r of (results.results || []) as any[]) byBid.set(r.bid_id, [...(byBid.get(r.bid_id) || []), r]);
  return c.json({
    bids: ((bids.results || []) as any[]).map((b) => ({ ...b, results: byBid.get(b.id) || [] })),
    plans: plans.results || [],
  });
});

// 입찰은 결과 목록과 함께 통째로 저장한다
async function saveResults(db: D1Database, bidId: number, results: any[]) {
  const stmts: D1PreparedStatement[] = [db.prepare("DELETE FROM bid_results WHERE bid_id = ?").bind(bidId)];
  results.filter((r) => (r.company || "").trim()).forEach((r, i) => {
    const d = clean(r, RESULT_COLS);
    d.bid_id = bidId; d.sort = i;
    const cols = Object.keys(d);
    stmts.push(db.prepare(`INSERT INTO bid_results (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((k) => d[k])));
  });
  await db.batch(stmts);
}
app.post("/bids", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const body = await c.req.json().catch(() => ({}));
  const d = clean(body, BID_COLS);
  if (!d.plant) return c.json({ error: "발전소(남부/중부)를 선택해 주세요" }, 400);
  d.created_by = c.get("user").uid;
  const cols = Object.keys(d);
  const res = await db.prepare(`INSERT INTO bids (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((k) => d[k])).run();
  const id = Number(res.meta.last_row_id);
  await saveResults(db, id, body.results || []);
  return c.json({ ok: true, id });
});
app.put("/bids/:id", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const id = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const d = clean(body, BID_COLS);
  const cols = Object.keys(d);
  if (cols.length) await db.prepare(`UPDATE bids SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...cols.map((k) => d[k]), id).run();
  if (Array.isArray(body.results)) await saveResults(db, id, body.results);
  return c.json({ ok: true, id });
});
app.delete("/bids/:id", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const id = c.req.param("id");
  await db.batch([db.prepare("DELETE FROM bid_results WHERE bid_id = ?").bind(id), db.prepare("DELETE FROM bids WHERE id = ?").bind(id)]);
  return c.json({ ok: true });
});

// ---------- 월별 납품계획 ----------
app.post("/plans", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const d = clean(await c.req.json().catch(() => ({})), PLAN_COLS);
  if (!d.ym || !d.customer) return c.json({ error: "월과 납품처를 넣어주세요" }, 400);
  d.created_by = c.get("user").uid;
  const cols = Object.keys(d);
  const res = await db.prepare(`INSERT INTO supply_plans (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((k) => d[k])).run();
  return c.json({ ok: true, item: await db.prepare("SELECT * FROM supply_plans WHERE id = ?").bind(res.meta.last_row_id).first() });
});
app.put("/plans/:id", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const d = clean(await c.req.json().catch(() => ({})), PLAN_COLS);
  const cols = Object.keys(d);
  if (cols.length) await db.prepare(`UPDATE supply_plans SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...cols.map((k) => d[k]), c.req.param("id")).run();
  return c.json({ ok: true, item: await db.prepare("SELECT * FROM supply_plans WHERE id = ?").bind(c.req.param("id")).first() });
});
app.delete("/plans/:id", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  await db.prepare("DELETE FROM supply_plans WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default app;
