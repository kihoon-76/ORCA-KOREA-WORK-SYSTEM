import { Hono } from "hono";
import type { Env, Variables } from "../types";
import type { AppContext } from "../middleware";
import { authMiddleware } from "../middleware";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

// 기준정보(환율·LC개설처별 마진율·물류비·가공비/로스율·오르카 판매 마진율) 기본값
// — [기준정보] 탭의 초기 값과 동일. 설정 페이지에서 저장하면 DB의 app_settings('pricing')로 덮어씌워진다.
const DEFAULT_PRICING_SETTINGS = {
  exchangeRate: 1380,
  lcMargin: {
    "매입처(타사) LC 개설": 0.02,
    "오르카(당사) LC 개설 - Usance": 0.01,
  } as Record<string, number>,
  logistics: { customs: 20, cntr: 25, melting: 25, transport1: 7, transport2: 7 },
  processing: {
    "탈검": { cost: 110, loss: 0.03 },
    "탈수": { cost: 40, loss: 0.01 },
    "블랜딩": { cost: 20, loss: 0 },
    "없음": { cost: 0, loss: 0 },
  } as Record<string, { cost: number; loss: number }>,
  salesMarginRate: 0.05,
};

async function getPricingSettings(c: AppContext) {
  const row = await c.env.DB.prepare("SELECT value FROM app_settings WHERE key = 'pricing'").first<{ value: string }>();
  if (!row) return DEFAULT_PRICING_SETTINGS;
  try {
    return { ...DEFAULT_PRICING_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return DEFAULT_PRICING_SETTINGS;
  }
}

// ROUNDUP(x, 0) — 엑셀과 동일하게, 모든 계산값은 양수이므로 올림 처리
function roundUp(n: number) {
  return Math.ceil(n);
}

app.get("/settings", async (c) => c.json({ item: await getPricingSettings(c) }));

app.put("/settings", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const merged = { ...(await getPricingSettings(c)), ...body };
  await c.env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('pricing', ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).bind(JSON.stringify(merged), c.get("user").uid).run();
  return c.json({ ok: true, item: merged });
});

// ---------- 품질규격 측정값 ----------
app.get("/quality", async (c) => {
  const entityType = c.req.query("entity_type");
  const entityId = c.req.query("entity_id");
  if (!entityType || !entityId) return c.json({ error: "entity 정보가 필요합니다" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT qr.*, u.name AS created_by_name FROM quality_results qr LEFT JOIN users u ON u.id = qr.created_by
     WHERE qr.entity_type = ? AND qr.entity_id = ? ORDER BY qr.id DESC`
  ).bind(entityType, entityId).all();
  return c.json({ items: (results || []).map((r: any) => ({ ...r, measured: JSON.parse(r.measured || "{}") })) });
});

app.post("/quality", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { entity_type, entity_id, measured, note } = body;
  if (!entity_type || !entity_id) return c.json({ error: "entity 정보가 필요합니다" }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO quality_results (entity_type, entity_id, measured, note, created_by) VALUES (?,?,?,?,?)`
  ).bind(entity_type, entity_id, JSON.stringify(measured || {}), note || null, c.get("user").uid).run();
  const row = await c.env.DB.prepare("SELECT * FROM quality_results WHERE id = ?").bind(res.meta.last_row_id).first<any>();
  return c.json({ ok: true, item: { ...row, measured: JSON.parse(row.measured || "{}") } });
});

app.delete("/quality/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM quality_results WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- 예상판가 계산 ----------
app.get("/price", async (c) => {
  const entityType = c.req.query("entity_type");
  const entityId = c.req.query("entity_id");
  if (!entityType || !entityId) return c.json({ error: "entity 정보가 필요합니다" }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT pc.*, u.name AS created_by_name FROM price_calcs pc LEFT JOIN users u ON u.id = pc.created_by
     WHERE pc.entity_type = ? AND pc.entity_id = ? ORDER BY pc.id DESC`
  ).bind(entityType, entityId).all();
  return c.json({ items: results || [] });
});

app.post("/price", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const {
    entity_type, entity_id, shipper, product, quantity, incoterms, contract_price, freight, lc_type, proc_type, exchange_rate, av, iv, s_value,
    customs, cntr, melting, transport1, transport2, note,
  } = body;
  if (!entity_type || !entity_id) return c.json({ error: "entity 정보가 필요합니다" }, 400);

  const settings = await getPricingSettings(c);
  const marginRate = settings.lcMargin[lc_type] ?? 0;
  const proc = settings.processing[proc_type] ?? { cost: 0, loss: 0 };
  const rate = Number(exchange_rate) || settings.exchangeRate;

  // 항만비·컨테이너운송료·멜팅비·1차/2차운송은 건별로 기준정보 기본값을 덮어쓸 수 있다
  const customsV = customs != null && customs !== "" ? Number(customs) : settings.logistics.customs;
  const cntrV = cntr != null && cntr !== "" ? Number(cntr) : settings.logistics.cntr;
  const meltingV = melting != null && melting !== "" ? Number(melting) : settings.logistics.melting;
  const transport1V = transport1 != null && transport1 !== "" ? Number(transport1) : settings.logistics.transport1;
  const transport2V = transport2 != null && transport2 !== "" ? Number(transport2) : settings.logistics.transport2;

  const buyingPrice = incoterms === "FOB" ? Number(contract_price || 0) + Number(freight || 0) : Number(contract_price || 0);
  const orcaPrice = buyingPrice * (1 + marginRate);
  const muldePrice = roundUp((rate * orcaPrice) / 1000);
  const lossCost = muldePrice * proc.loss;
  const totalCost = muldePrice + customsV + cntrV + meltingV + transport1V + proc.cost + lossCost + transport2V;
  const margin = roundUp(totalCost * settings.salesMarginRate);
  const expectedPrice = totalCost + margin;
  const qty = quantity != null && quantity !== "" ? Number(quantity) : null;
  const totalBuyAmount = qty != null ? qty * buyingPrice : null;
  const totalSellAmount = qty != null ? qty * 1000 * expectedPrice : null;

  const res = await c.env.DB.prepare(
    `INSERT INTO price_calcs (entity_type, entity_id, shipper, product, quantity, incoterms, contract_price, freight, lc_type, proc_type,
      exchange_rate, av, iv, s_value, customs, cntr, melting, transport1, transport2,
      buying_price, orca_price, mulde_price, total_cost, margin, expected_price, total_buy_amount, total_sell_amount, note, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    entity_type, entity_id, shipper || null, product || null, qty, incoterms || null,
    contract_price != null ? Number(contract_price) : null, freight != null ? Number(freight) : null,
    lc_type || null, proc_type || null, rate,
    av != null && av !== "" ? Number(av) : null, iv != null && iv !== "" ? Number(iv) : null, s_value != null && s_value !== "" ? Number(s_value) : null,
    customsV, cntrV, meltingV, transport1V, transport2V,
    buyingPrice, orcaPrice, muldePrice, totalCost, margin, expectedPrice, totalBuyAmount, totalSellAmount, note || null, c.get("user").uid
  ).run();
  const row = await c.env.DB.prepare("SELECT * FROM price_calcs WHERE id = ?").bind(res.meta.last_row_id).first();
  return c.json({ ok: true, item: row });
});

app.delete("/price/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM price_calcs WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

export default app;
