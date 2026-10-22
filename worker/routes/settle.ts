import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

// 정산 관리 — 바이어(HFS·KP HANSUK·DASAN BIO 등)가 대신 LC/TT를 열어 준 수입 건을 건별로 대조·확인한다.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const STEP_KEYS = ["statement", "amount", "invoice", "paid", "final"];
const JSON_COLS = ["st_fee_detail", "remits", "payments", "steps", "extracted"];
const EDIT_COLS = [
  "buyer", "margin_type", "margin_value",
  "st_unit_price", "st_unit_basis", "st_qty", "st_fx", "st_goods_krw", "st_fees_krw", "st_fee_detail",
  "st_margin_krw", "st_sell_unit", "st_total_krw", "st_grand_krw",
  "invoice_date", "due_date", "remits", "payments", "extracted", "note",
];

function normKey(s: string) {
  return (s || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function parseRow(r: any) {
  if (!r) return r;
  const out = { ...r };
  for (const k of JSON_COLS) {
    if (typeof out[k] === "string") { try { out[k] = JSON.parse(out[k]); } catch { out[k] = null; } }
  }
  return out;
}

// ---------- 목록 ----------
app.get("/", async (c) => {
  const [s, b] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM settlements").all(),
    c.env.DB.prepare("SELECT * FROM settle_buyers ORDER BY name").all(),
  ]);
  return c.json({ items: (s.results || []).map(parseRow), buyers: b.results || [], ai: !!c.env.ANTHROPIC_API_KEY });
});

// ---------- 건별 저장 (없으면 새로 만든다) ----------
async function ensureRow(c: any, importId: number) {
  const imp = await c.env.DB.prepare("SELECT id, lc_bank FROM imports WHERE id = ?").bind(importId).first();
  if (!imp) return null;
  await c.env.DB.prepare("INSERT OR IGNORE INTO settlements (import_id, buyer) VALUES (?, ?)").bind(importId, imp.lc_bank || null).run();
  return imp;
}

app.put("/:importId{[0-9]+}", async (c) => {
  const importId = Number(c.req.param("importId"));
  if (!(await ensureRow(c, importId))) return c.json({ error: "수입 건을 찾을 수 없습니다" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = [];
  const binds: any[] = [];
  for (const k of EDIT_COLS) {
    if (!(k in body)) continue;
    let v = body[k];
    if (JSON_COLS.includes(k)) v = v == null ? null : JSON.stringify(v);
    else if (v === "") v = null;
    sets.push(`${k} = ?`);
    binds.push(v);
  }
  if (sets.length) {
    sets.push("updated_by = ?", "updated_at = datetime('now')");
    binds.push(c.get("user").uid, importId);
    await c.env.DB.prepare(`UPDATE settlements SET ${sets.join(", ")} WHERE import_id = ?`).bind(...binds).run();
  }
  const row = await c.env.DB.prepare("SELECT * FROM settlements WHERE import_id = ?").bind(importId).first();
  return c.json({ ok: true, item: parseRow(row) });
});

// ---------- 단계 체크 (누가 언제 체크했는지 남긴다) ----------
app.post("/:importId{[0-9]+}/step", async (c) => {
  const importId = Number(c.req.param("importId"));
  if (!(await ensureRow(c, importId))) return c.json({ error: "수입 건을 찾을 수 없습니다" }, 404);
  const { step, done } = await c.req.json().catch(() => ({}));
  if (!STEP_KEYS.includes(step)) return c.json({ error: "알 수 없는 단계입니다" }, 400);
  const row: any = await c.env.DB.prepare("SELECT steps FROM settlements WHERE import_id = ?").bind(importId).first();
  let steps: any = {};
  try { steps = JSON.parse(row?.steps || "{}") || {}; } catch { steps = {}; }
  if (done) steps[step] = { at: new Date().toISOString(), by: c.get("user").name };
  else delete steps[step];
  await c.env.DB.prepare("UPDATE settlements SET steps = ?, updated_by = ?, updated_at = datetime('now') WHERE import_id = ?")
    .bind(JSON.stringify(steps), c.get("user").uid, importId).run();
  const fresh = await c.env.DB.prepare("SELECT * FROM settlements WHERE import_id = ?").bind(importId).first();
  return c.json({ ok: true, item: parseRow(fresh) });
});

// ---------- 바이어별 기본 마진 규칙 ----------
app.put("/buyers", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = (b.name || "").trim();
  if (!name) return c.json({ error: "회사 이름이 필요합니다" }, 400);
  const type = ["pct", "usd_per_mt", "krw_per_kg"].includes(b.margin_type) ? b.margin_type : "pct";
  await c.env.DB.prepare(
    `INSERT INTO settle_buyers (buyer_key, name, margin_type, margin_value, payment, note, updated_at)
     VALUES (?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(buyer_key) DO UPDATE SET name = excluded.name, margin_type = excluded.margin_type, margin_value = excluded.margin_value,
       payment = excluded.payment, note = excluded.note, updated_at = datetime('now')`
  ).bind(normKey(name), name, type, Number(b.margin_value) || 0, b.payment || null, b.note || null).run();
  const { results } = await c.env.DB.prepare("SELECT * FROM settle_buyers ORDER BY name").all();
  return c.json({ ok: true, buyers: results || [] });
});
app.delete("/buyers/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM settle_buyers WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- 정산서 자동 읽기 (Claude) ----------
// PDF·이미지는 그대로, 엑셀은 브라우저에서 표를 글자로 바꿔서 보낸다.
const EXTRACT_TOOL = {
  name: "record_statement",
  description: "바이어 회사가 보낸 정산서/원가계산서/청구 내역에서 거래 건별 숫자를 기록한다.",
  input_schema: {
    type: "object",
    properties: {
      issuer: { type: "string", description: "정산서를 보낸 회사(바이어) 이름. 예: KP HANSUK(한석), HFS, DASAN BIO, HJ" },
      items: {
        type: "array",
        description: "거래 건 목록. 한 장에 여러 건(BL)이 있으면 모두 넣는다. 같은 건의 여러 줄(분할 송금·분할 입금)은 한 건으로 합친다.",
        items: {
          type: "object",
          properties: {
            bl_no: { type: "string" },
            supplier: { type: "string", description: "수출자/공급사(Shipper)" },
            material: { type: "string", description: "품목명" },
            buyer: { type: "string", description: "이 건의 바이어/공급자 회사 (표에 따로 있으면)" },
            qty_mt: { type: "number", description: "수량. 반드시 MT 단위 (kg이면 1000으로 나눔)" },
            unit_price: { type: "number", description: "바이어 매입 단가" },
            unit_basis: { type: "string", enum: ["usd_mt", "krw_kg"], description: "단가 단위: $/MT 또는 원/kg" },
            fx_rate: { type: "number", description: "적용 환율 (원/$)" },
            goods_krw: { type: "number", description: "물대 원화 금액 (단가×수량×환율)" },
            fees: { type: "array", items: { type: "object", properties: { name: { type: "string" }, amount: { type: "number" } }, required: ["name", "amount"] },
              description: "부대비용 항목들 (LC 개설수수료, 보험료, 통관수수료, 선임료, 운송비 등). 바이어 이익은 넣지 않는다." },
            fees_total_krw: { type: "number" },
            margin_krw: { type: "number", description: "바이어 이익/마진 금액 (원). 예: '한석이익($20/MT)' 열" },
            margin_note: { type: "string", description: "이익 계산 근거 문구 (예: $20/MT, 2%)" },
            sell_unit_krw_kg: { type: "number", description: "바이어가 오르카에 파는 단가(원/kg)가 따로 적혀 있으면" },
            total_krw: { type: "number", description: "공급가 합계 (VAT 별도)" },
            grand_krw: { type: "number", description: "VAT 포함 합계 (Grand total / 청구액 / Actual INV)" },
            invoice_date: { type: "string", description: "세금계산서 일자 YYYY-MM-DD" },
            due_date: { type: "string", description: "오르카 결제 예정일 YYYY-MM-DD (모르면 비움, '10월 말' 같은 표현은 그 달 말일)" },
            remits: { type: "array", items: { type: "object", properties: { date: { type: "string" }, amount: { type: "number" }, currency: { type: "string" } } },
              description: "바이어가 공급사에 송금한 내역 (보통 USD)" },
            payments: { type: "array", items: { type: "object", properties: { date: { type: "string" }, amount: { type: "number" } } },
              description: "오르카가 바이어에게 입금한 내역 (원)" },
            notes: { type: "string" },
          },
        },
      },
    },
    required: ["items"],
  },
};

app.post("/extract", async (c) => {
  const key = c.env.ANTHROPIC_API_KEY;
  if (!key) return c.json({ error: "자동 읽기 키(ANTHROPIC_API_KEY)가 아직 설정되지 않았습니다" }, 400);
  const b = await c.req.json().catch(() => ({}));
  const { kind, data, media_type, filename, text } = b;
  const content: any[] = [];
  if (kind === "pdf" && data) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
  else if (kind === "image" && data) content.push({ type: "image", source: { type: "base64", media_type: media_type || "image/png", data } });
  else if (kind === "text" && text) content.push({ type: "text", text: `파일: ${filename || ""}\n\n${String(text).slice(0, 200000)}` });
  else return c.json({ error: "읽을 내용이 없습니다" }, 400);
  content.push({
    type: "text",
    text: `오르카코리아(바이오중유 원료 수입사)가 바이어 회사로부터 받은 정산서입니다. 오늘은 ${new Date().toISOString().slice(0, 10)} 입니다.
표의 숫자를 그대로 옮겨 record_statement 도구로 기록하세요. 계산해서 지어내지 말고, 적혀 있지 않은 값은 비워 두세요.
수량은 MT 단위로, 날짜는 YYYY-MM-DD로 바꿉니다 (연도가 없으면 문서 맥락이나 올해 기준).`,
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: c.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "record_statement" },
      messages: [{ role: "user", content }],
    }),
  });
  const out: any = await res.json().catch(() => ({}));
  if (!res.ok) return c.json({ error: `자동 읽기 실패: ${out?.error?.message || res.status}` }, 502);
  const tool = (out.content || []).find((x: any) => x.type === "tool_use");
  if (!tool) return c.json({ error: "정산서에서 내용을 찾지 못했습니다" }, 422);
  return c.json({ ok: true, result: tool.input });
});

export default app;
