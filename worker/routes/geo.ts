import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

// 수입 지도 현황판 — 공급사별 위치(나라·지역/항구·좌표)와 한국 도착항 정보를 관리한다.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const DEFAULT_DEST = { name: "부산항", country: "대한민국", lat: 35.1028, lng: 129.0403 };

// 공급사 이름은 대소문자·앞뒤 공백·연속 공백 차이를 무시하고 같은 회사로 본다
function normKey(s: string) {
  return (s || "").trim().replace(/\s+/g, " ").toUpperCase();
}

app.get("/suppliers", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM supplier_locations ORDER BY supplier").all();
  return c.json({ items: results || [] });
});

// 공급사 위치 등록/수정 (같은 공급사면 덮어쓰기)
app.put("/suppliers", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const supplier = (b.supplier || "").trim();
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!supplier) return c.json({ error: "공급사 이름이 필요합니다" }, 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return c.json({ error: "위치(좌표)를 지정해 주세요" }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO supplier_locations (supplier_key, supplier, country, region, lat, lng, domestic, note, updated_by, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(supplier_key) DO UPDATE SET supplier = excluded.supplier, country = excluded.country, region = excluded.region,
       lat = excluded.lat, lng = excluded.lng, domestic = excluded.domestic, note = excluded.note,
       updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).bind(normKey(supplier), supplier, b.country || null, b.region || null, lat, lng, b.domestic ? 1 : 0, b.note || null, c.get("user").uid).run();
  const row = await c.env.DB.prepare("SELECT * FROM supplier_locations WHERE supplier_key = ?").bind(normKey(supplier)).first();
  return c.json({ ok: true, item: row });
});

app.delete("/suppliers/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM supplier_locations WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// 한국 도착항 (지도에서 선이 이어지는 도착 지점)
app.get("/dest", async (c) => {
  const row = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'map_dest'").first<{ value: string }>();
  let item = DEFAULT_DEST;
  if (row) {
    try { item = { ...DEFAULT_DEST, ...JSON.parse(row.value) }; } catch { /* 기본값 사용 */ }
  }
  return c.json({ item });
});

app.put("/dest", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const item = {
    name: (b.name || DEFAULT_DEST.name).trim(),
    country: b.country || "대한민국",
    lat: Number(b.lat),
    lng: Number(b.lng),
  };
  if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return c.json({ error: "도착항 좌표가 올바르지 않습니다" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('map_dest', ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).bind(JSON.stringify(item), c.get("user").uid).run();
  return c.json({ ok: true, item });
});

export default app;
