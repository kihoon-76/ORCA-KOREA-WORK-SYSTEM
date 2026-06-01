import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { pick, insertRow, updateRow, deleteRow } from "../crud";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const MAT_COLS = ["code","name","spec","unit","origin","note"];

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM materials ORDER BY name").all();
  return c.json({ items: results });
});
app.post("/", async (c) => insertRow(c, "materials", pick(await c.req.json(), MAT_COLS)));
app.put("/:id", async (c) => updateRow(c, "materials", c.req.param("id"), pick(await c.req.json(), MAT_COLS)));
app.delete("/:id", async (c) => deleteRow(c, "materials", c.req.param("id")));

// ---------- 샘플 분석결과 ----------
app.get("/analyses", async (c) => {
  const materialId = c.req.query("material_id");
  let sql = `SELECT a.*, m.name AS material_name FROM material_analyses a LEFT JOIN materials m ON a.material_id = m.id`;
  const binds: any[] = [];
  if (materialId) { sql += " WHERE a.material_id = ?"; binds.push(materialId); }
  sql += " ORDER BY a.created_at DESC";
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ items: results });
});

const ANALYSIS_COLS = ["material_id","sample_no","analyzed_at","result_summary"];
app.post("/analyses", async (c) => {
  const data = pick(await c.req.json(), ANALYSIS_COLS);
  data.created_by = c.get("user").uid;
  return insertRow(c, "material_analyses", data);
});
app.delete("/analyses/:id", async (c) => deleteRow(c, "material_analyses", c.req.param("id")));

export default app;
