import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { pick, insertRow, deleteRow } from "../crud";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 재고 현황 (원료별 입고/출고/재고 집계)
app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
        COALESCE(material_id, 0) AS material_id,
        material_name,
        unit,
        SUM(CASE WHEN txn_type='in' THEN quantity ELSE 0 END) AS in_qty,
        SUM(CASE WHEN txn_type='out' THEN quantity ELSE 0 END) AS out_qty,
        SUM(CASE WHEN txn_type='in' THEN quantity ELSE -quantity END) AS stock_qty,
        SUM(CASE WHEN txn_type='in' AND source='import' THEN quantity ELSE 0 END) AS import_qty
     FROM inventory_txns
     GROUP BY material_name, unit
     ORDER BY material_name`
  ).all();
  return c.json({ items: results });
});

// 입출고 트랜잭션 목록
app.get("/txns", async (c) => {
  const materialName = c.req.query("material_name");
  let sql = "SELECT * FROM inventory_txns";
  const binds: any[] = [];
  if (materialName) { sql += " WHERE material_name = ?"; binds.push(materialName); }
  sql += " ORDER BY txn_date DESC, id DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

const TXN_COLS = ["material_id","material_name","txn_type","source","source_id","quantity","unit","warehouse","txn_date","note"];

app.post("/txns", async (c) => {
  const body = await c.req.json();
  const data = pick(body, TXN_COLS);
  if (!data.txn_date) data.txn_date = new Date().toISOString().slice(0, 10);
  if (!data.source) data.source = "manual";
  data.created_by = c.get("user").uid;
  return insertRow(c, "inventory_txns", data);
});

app.delete("/txns/:id", async (c) => deleteRow(c, "inventory_txns", c.req.param("id")));

export default app;
