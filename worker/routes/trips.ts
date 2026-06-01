import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { pick, insertRow, updateRow, deleteRow } from "../crud";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const TRIP_COLS = ["title","destination","purpose","start_date","end_date","status","note"];

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, u.name AS user_name FROM business_trips t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC`
  ).all();
  return c.json({ items: results });
});
app.post("/", async (c) => {
  const data = pick(await c.req.json(), TRIP_COLS);
  data.user_id = c.get("user").uid;
  return insertRow(c, "business_trips", data);
});
app.put("/:id", async (c) => updateRow(c, "business_trips", c.req.param("id"), pick(await c.req.json(), TRIP_COLS)));
app.delete("/:id", async (c) => deleteRow(c, "business_trips", c.req.param("id")));

export default app;
