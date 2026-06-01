import type { AppContext } from "./middleware";

// 허용된 컬럼만 골라 INSERT/UPDATE payload 구성
export function pick(body: Record<string, any>, cols: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const col of cols) {
    if (body[col] !== undefined) out[col] = body[col] === "" ? null : body[col];
  }
  return out;
}

export async function insertRow(c: AppContext, table: string, data: Record<string, any>) {
  const cols = Object.keys(data);
  if (cols.length === 0) return c.json({ error: "데이터가 없습니다" }, 400);
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`;
  const res = await c.env.DB.prepare(sql).bind(...cols.map((k) => data[k])).run();
  const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(res.meta.last_row_id).first();
  return c.json({ ok: true, item: row });
}

export async function updateRow(c: AppContext, table: string, id: string | number, data: Record<string, any>) {
  const cols = Object.keys(data);
  if (cols.length === 0) return c.json({ error: "변경할 데이터가 없습니다" }, 400);
  const setClause = cols.map((k) => `${k} = ?`).join(", ");
  const hasUpdatedAt = await tableHasColumn(c, table, "updated_at");
  const extra = hasUpdatedAt ? ", updated_at = datetime('now')" : "";
  const sql = `UPDATE ${table} SET ${setClause}${extra} WHERE id = ?`;
  await c.env.DB.prepare(sql).bind(...cols.map((k) => data[k]), id).run();
  const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  return c.json({ ok: true, item: row });
}

const colCache: Record<string, Set<string>> = {};
async function tableHasColumn(c: AppContext, table: string, col: string): Promise<boolean> {
  if (!colCache[table]) {
    const { results } = await c.env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    colCache[table] = new Set((results || []).map((r) => r.name));
  }
  return colCache[table].has(col);
}

export async function deleteRow(c: AppContext, table: string, id: string | number) {
  await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
}
