import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";

// 환율 — Frankfurter(유럽중앙은행 기준환율, 무료·키 없음)에서 가져와 1시간 동안 저장해 두고 쓴다.
// 매 영업일 하루 한 번 갱신되는 기준환율이라 은행 실시간 고시환율과는 조금 다를 수 있다.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);

const API = "https://api.frankfurter.dev/v1";
const CACHE_KEY = "fx_cache";
const MAX_AGE_MS = 60 * 60 * 1000;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchFx() {
  const end = new Date();
  const start = new Date(end.getTime() - 45 * 24 * 60 * 60 * 1000);
  const [latestRes, seriesRes] = await Promise.all([
    fetch(`${API}/latest?base=USD&symbols=KRW,EUR,CNY,JPY`),
    fetch(`${API}/${ymd(start)}..${ymd(end)}?base=USD&symbols=KRW`),
  ]);
  if (!latestRes.ok) throw new Error(`환율 조회 실패 (${latestRes.status})`);
  const latest: any = await latestRes.json();
  const r = latest.rates || {};
  const usdkrw = Number(r.KRW);
  if (!usdkrw) throw new Error("환율 데이터가 비어 있습니다");
  // 기준이 USD라서 1 EUR/CNY/JPY 가 원화로 얼마인지는 KRW ÷ 해당 통화로 계산
  const cross = (code: string) => (r[code] ? usdkrw / Number(r[code]) : null);

  let series: { date: string; krw: number }[] = [];
  if (seriesRes.ok) {
    const s: any = await seriesRes.json();
    series = Object.entries(s.rates || {})
      .map(([date, v]: [string, any]) => ({ date, krw: Number(v?.KRW) }))
      .filter((x) => x.krw)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  // 최신 값이 시계열에 없으면 붙여 둔다
  if (!series.length || series[series.length - 1].date !== latest.date) series.push({ date: latest.date, krw: usdkrw });
  const prev = series.length >= 2 ? series[series.length - 2].krw : null;

  return {
    date: latest.date,
    usdkrw,
    change: prev != null ? usdkrw - prev : null,
    eurkrw: cross("EUR"),
    cnykrw: cross("CNY"),
    jpykrw100: r.JPY ? (usdkrw / Number(r.JPY)) * 100 : null,
    series: series.slice(-30),
    source: "유럽중앙은행(ECB) 기준환율 · Frankfurter",
    fetched_at: new Date().toISOString(),
  };
}

app.get("/", async (c) => {
  const db = c.env.DB;
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(CACHE_KEY).first<{ value: string }>();
  let cached: any = null;
  if (row) { try { cached = JSON.parse(row.value); } catch { /* 무시 */ } }
  const fresh = cached && Date.now() - new Date(cached.fetched_at).getTime() < MAX_AGE_MS;
  if (fresh && c.req.query("refresh") !== "1") return c.json({ item: cached });

  try {
    const item = await fetchFx();
    await db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).bind(CACHE_KEY, JSON.stringify(item)).run();
    return c.json({ item });
  } catch (e: any) {
    // 가져오기에 실패하면 마지막으로 받아둔 값이라도 보여준다
    if (cached) return c.json({ item: { ...cached, stale: true } });
    return c.json({ error: e.message || "환율을 불러오지 못했습니다" }, 502);
  }
});

export default app;
