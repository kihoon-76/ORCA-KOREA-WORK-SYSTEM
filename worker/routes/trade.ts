import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { pick, insertRow, updateRow, deleteRow } from "../crud";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const IMPORT_COLS = ["ref_no","material_id","material_name","supplier","lc_bank","lc_no","quantity","unit","unit_price","total_price","currency","vessel","etd","eta","status","note"];
const EXPORT_COLS = ["ref_no","material_id","material_name","buyer","lc_bank","lc_no","quantity","unit","unit_price","total_price","currency","vessel","etd","eta","status","note"];

function withTotal(data: Record<string, any>) {
  if (data.total_price == null && data.quantity != null && data.unit_price != null) {
    data.total_price = Number(data.quantity) * Number(data.unit_price);
  }
  return data;
}

// ---------- 수입 ----------
app.get("/imports", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM imports ORDER BY created_at DESC").all();
  return c.json({ items: results });
});
app.get("/imports/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM imports WHERE id = ?").bind(c.req.param("id")).first();
  return row ? c.json({ item: row }) : c.json({ error: "없음" }, 404);
});
app.post("/imports", async (c) => {
  const body = await c.req.json();
  const data = withTotal(pick(body, IMPORT_COLS));
  data.created_by = c.get("user").uid;
  return insertRow(c, "imports", data);
});
app.put("/imports/:id", async (c) => {
  const body = await c.req.json();
  return updateRow(c, "imports", c.req.param("id"), withTotal(pick(body, IMPORT_COLS)));
});
app.delete("/imports/:id", async (c) => deleteRow(c, "imports", c.req.param("id")));

// 수입 -> 재고 입고 처리
app.post("/imports/:id/receive", async (c) => {
  const imp = await c.env.DB.prepare("SELECT * FROM imports WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!imp) return c.json({ error: "수입 건을 찾을 수 없습니다" }, 404);
  const body: { quantity?: number; warehouse?: string; txn_date?: string } = await c.req.json().catch(() => ({}));
  const qty = body.quantity ?? imp.quantity;
  const txnDate = body.txn_date ?? new Date().toISOString().slice(0, 10);
  await c.env.DB.prepare(
    `INSERT INTO inventory_txns (material_id, material_name, txn_type, source, source_id, quantity, unit, warehouse, txn_date, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(imp.material_id, imp.material_name, "in", "import", imp.id, qty, imp.unit, body.warehouse || null, txnDate, c.get("user").uid).run();
  await c.env.DB.prepare("UPDATE imports SET status = 'stored', updated_at = datetime('now') WHERE id = ?").bind(imp.id).run();
  return c.json({ ok: true });
});

// ---------- 수출 ----------
app.get("/exports", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM exports ORDER BY created_at DESC").all();
  return c.json({ items: results });
});
app.get("/exports/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM exports WHERE id = ?").bind(c.req.param("id")).first();
  return row ? c.json({ item: row }) : c.json({ error: "없음" }, 404);
});
app.post("/exports", async (c) => {
  const body = await c.req.json();
  const data = withTotal(pick(body, EXPORT_COLS));
  data.created_by = c.get("user").uid;
  return insertRow(c, "exports", data);
});
app.put("/exports/:id", async (c) => {
  const body = await c.req.json();
  return updateRow(c, "exports", c.req.param("id"), withTotal(pick(body, EXPORT_COLS)));
});
app.delete("/exports/:id", async (c) => deleteRow(c, "exports", c.req.param("id")));

export default app;
