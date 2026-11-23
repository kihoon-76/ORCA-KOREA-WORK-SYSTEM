import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

// 입출고·재고 — 부장님 입출고 대장(엑셀)을 대신하는 화면용 API
//  · 입고(stock_lots): DO 받은 시점부터 재고. 수입 계약 건(imports)과 연결하면 업체·LC개설처·단가가 따라온다.
//  · 이동(stock_moves): 공장투입(input: 예정/진행/완료) 과 출고(out: 예정/완료)
//  · 재고 = 입고량 − 투입(진행+완료)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const LOT_COLS = ["import_id", "in_date", "material", "supplier", "buyer", "unit_price", "currency", "qty", "plant", "process",
  "process_note", "free_until", "container_info", "note"];
const MOVE_COLS = ["lot_id", "kind", "move_date", "qty", "plant", "process", "status", "product", "customer", "load_site", "loss_pct", "note"];

let ready = false;
async function ensureTables(db: D1Database) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS stock_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ext_key TEXT UNIQUE,
      import_id INTEGER,
      in_date TEXT NOT NULL,
      material TEXT NOT NULL,
      supplier TEXT, buyer TEXT,
      unit_price REAL, currency TEXT DEFAULT 'USD',
      qty REAL NOT NULL,
      plant TEXT, process TEXT, process_note TEXT,
      free_until TEXT, container_info TEXT, note TEXT,
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS stock_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ext_key TEXT UNIQUE,
      lot_id INTEGER,
      kind TEXT NOT NULL,
      move_date TEXT NOT NULL,
      qty REAL NOT NULL,
      plant TEXT, process TEXT,
      status TEXT NOT NULL DEFAULT 'done',
      product TEXT, customer TEXT, load_site TEXT,
      loss_pct REAL, note TEXT,
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_stock_moves_lot ON stock_moves(lot_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_stock_lots_import ON stock_lots(import_id)"),
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
  const [lots, moves] = await Promise.all([
    db.prepare("SELECT * FROM stock_lots ORDER BY in_date DESC, id DESC").all(),
    db.prepare("SELECT * FROM stock_moves ORDER BY move_date DESC, id DESC").all(),
  ]);
  return c.json({ lots: lots.results || [], moves: moves.results || [] });
});

async function insert(c: any, table: string, data: Record<string, any>) {
  data.created_by = c.get("user").uid;
  const cols = Object.keys(data);
  const res = await c.env.DB.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .bind(...cols.map((k) => data[k])).run();
  return c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(res.meta.last_row_id).first();
}
async function update(c: any, table: string, id: string, data: Record<string, any>) {
  const cols = Object.keys(data);
  if (cols.length) {
    await c.env.DB.prepare(`UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...cols.map((k) => data[k]), id).run();
  }
  return c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}

// ---------- 입고 ----------
app.post("/lots", async (c) => {
  await ensureTables(c.env.DB);
  const data = clean(await c.req.json(), LOT_COLS);
  if (!data.in_date || !data.material || !(Number(data.qty) > 0)) return c.json({ error: "입고일·품명·수량은 꼭 넣어주세요" }, 400);
  return c.json({ ok: true, item: await insert(c, "stock_lots", data) });
});
app.put("/lots/:id", async (c) => {
  await ensureTables(c.env.DB);
  return c.json({ ok: true, item: await update(c, "stock_lots", c.req.param("id"), clean(await c.req.json(), LOT_COLS)) });
});
app.delete("/lots/:id", async (c) => {
  await ensureTables(c.env.DB);
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM stock_moves WHERE lot_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM stock_lots WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- 공장투입 / 출고 ----------
app.post("/moves", async (c) => {
  await ensureTables(c.env.DB);
  const data = clean(await c.req.json(), MOVE_COLS);
  if (!["input", "out"].includes(data.kind)) return c.json({ error: "구분(투입/출고)이 필요합니다" }, 400);
  if (!data.move_date || !(Number(data.qty) > 0)) return c.json({ error: "일자와 수량을 넣어주세요" }, 400);
  return c.json({ ok: true, item: await insert(c, "stock_moves", data) });
});
app.put("/moves/:id", async (c) => {
  await ensureTables(c.env.DB);
  return c.json({ ok: true, item: await update(c, "stock_moves", c.req.param("id"), clean(await c.req.json(), MOVE_COLS)) });
});
app.delete("/moves/:id", async (c) => {
  await ensureTables(c.env.DB);
  await c.env.DB.prepare("DELETE FROM stock_moves WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- 엑셀 이관 (같은 ext_key 는 한 번만 들어간다) ----------
app.post("/bulk", async (c) => {
  const db = c.env.DB;
  await ensureTables(db);
  const { lots = [], moves = [] } = await c.req.json().catch(() => ({}));
  const uid = c.get("user").uid;
  const stmts: D1PreparedStatement[] = [];
  for (const l of lots) {
    const d = clean(l, LOT_COLS);
    d.ext_key = l.ext_key; d.created_by = uid;
    const cols = Object.keys(d);
    stmts.push(db.prepare(`INSERT OR IGNORE INTO stock_lots (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((k) => d[k])));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  // 이동 기록은 lot_ext 로 입고 건을 찾아 연결
  const mstmts: D1PreparedStatement[] = [];
  for (const m of moves) {
    const d = clean(m, MOVE_COLS);
    d.ext_key = m.ext_key; d.created_by = uid;
    const cols = Object.keys(d);
    if (m.lot_ext) {
      mstmts.push(db.prepare(`INSERT OR IGNORE INTO stock_moves (${cols.join(",")}, lot_id) SELECT ${cols.map(() => "?").join(",")}, id FROM stock_lots WHERE ext_key = ?`)
        .bind(...cols.map((k) => d[k]), m.lot_ext));
    } else {
      mstmts.push(db.prepare(`INSERT OR IGNORE INTO stock_moves (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...cols.map((k) => d[k])));
    }
  }
  for (let i = 0; i < mstmts.length; i += 50) await db.batch(mstmts.slice(i, i + 50));
  const [a, b] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM stock_lots").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM stock_moves").first<{ n: number }>(),
  ]);
  return c.json({ ok: true, lots: a?.n, moves: b?.n });
});

export default app;
