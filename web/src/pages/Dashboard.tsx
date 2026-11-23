import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner, Icon } from "../components/ui";
import FxCard from "../components/FxCard";
import { CUSTOMERS, addMonths, customerOf, supplyPrice, won, ym } from "../planCalc";

// 대시보드 — 오르카 업무 흐름(입찰 → 납품계획 → 구매 → 입출고·재고 → 재무)을 한눈에.
// 그 아래에 이번 달·다음 달 원료 부족 경고와, 지금 챙겨야 할 일 목록, 환율.

const IN_TRANSIT = new Set(["shipped", "arrived", "customs"]);
const NOT_RECEIVED = new Set(["contracted", "shipped", "arrived", "customs"]);
const n = (v: any) => Number(v) || 0;
const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const today = () => new Date().toLocaleDateString("sv-SE");
const md = (d?: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "-");
const daysTo = (d: string) => Math.round((new Date(d + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);

export default function Dashboard() {
  const { user } = useAuth();
  const [imports, setImports] = useState<any[] | null>(null);
  const [stock, setStock] = useState<{ lots: any[]; moves: any[] }>({ lots: [], moves: [] });
  const [plan, setPlan] = useState<{ bids: any[]; plans: any[] }>({ bids: [], plans: [] });
  const [settles, setSettles] = useState<any[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);

  useEffect(() => {
    api.get("/trade/imports").then((r: any) => setImports(r.items || [])).catch(() => setImports([]));
    api.get("/stock").then((r: any) => setStock({ lots: r.lots || [], moves: r.moves || [] })).catch(() => {});
    api.get("/plan").then((r: any) => setPlan({ bids: r.bids || [], plans: r.plans || [] })).catch(() => {});
    api.get("/settle").then((r: any) => setSettles(r.items || [])).catch(() => {});
    api.get("/approvals?inbox=1").then((r: any) => setInbox(r.items || [])).catch(() => {});
  }, []);

  const now = ym();
  const next = addMonths(now, 1);
  const t = today();

  const calc = useMemo(() => {
    const imps = imports || [];
    // 입출고·재고
    const inputs = new Map<number, { done: number; doing: number }>();
    for (const m of stock.moves) if (m.kind === "input" && m.lot_id) {
      const x = inputs.get(m.lot_id) || { done: 0, doing: 0 };
      if (m.status === "done") x.done += n(m.qty); else if (m.status === "doing") x.doing += n(m.qty);
      inputs.set(m.lot_id, x);
    }
    let stockMt = 0, doingMt = 0;
    const lotRemain = new Map<number, number>();
    for (const l of stock.lots) {
      const x = inputs.get(l.id) || { done: 0, doing: 0 };
      const remain = Math.max(0, n(l.qty) - x.done - x.doing);
      lotRemain.set(l.id, remain);
      stockMt += remain; doingMt += x.doing;
    }
    const outMonth = stock.moves.filter((m) => m.kind === "out" && m.status === "done" && (m.move_date || "").startsWith(now)).reduce((a, m) => a + n(m.qty), 0);

    // 구매
    const arriving = (month: string) => imps.filter((r) => (r.eta || "").startsWith(month) && NOT_RECEIVED.has(r.status));
    const etaMonth = imps.filter((r) => (r.eta || "").startsWith(now));
    const transit = imps.filter((r) => IN_TRANSIT.has(r.status));
    const contracted = imps.filter((r) => r.status === "contracted");

    // 납품계획
    const plansOf = (month: string) => plan.plans.filter((p) => p.ym === month);
    const need = (month: string) => plansOf(month).reduce((a, p) => a + n(p.qty_mt), 0);

    // 부족 경고: 이번 달 확보 = 재고(미투입+투입 진행) + 이번 달 입항 예정(아직 입고 전), 남으면 다음 달로 이월
    const haveNow = stockMt + doingMt + arriving(now).reduce((a, r) => a + n(r.quantity), 0);
    const gapNow = haveNow - need(now);
    const haveNext = Math.max(0, gapNow) + arriving(next).reduce((a, r) => a + n(r.quantity), 0);
    const gapNext = haveNext - need(next);

    // 입찰: 발전소별 가장 최근 입찰
    const latestBid = new Map<string, any>();
    for (const b of plan.bids) if (!latestBid.has(b.plant)) latestBid.set(b.plant, b);

    // 재무: 바이어가 있는 수입 건 중 최종 확인 전
    const settleById = new Map(settles.map((s) => [s.import_id, s]));
    const finScope = imps.filter((r) => (r.lc_bank || "").trim() && !/ORCA/i.test(r.lc_bank));
    const openSettle = finScope.filter((r) => !settleById.get(r.id)?.steps?.final);
    const dueSoon = openSettle.map((r) => ({ r, s: settleById.get(r.id) })).filter(({ s }) => s?.due_date && daysTo(s.due_date) <= 14);

    return { stockMt, doingMt, outMonth, lotRemain, etaMonth, transit, contracted, plansOf, need, haveNow, gapNow, haveNext, gapNext, latestBid, openSettle, dueSoon, imps };
  }, [imports, stock, plan, settles, now, next]);

  // 할 일 목록
  const todos = useMemo(() => {
    const list: { tone: "red" | "amber" | "plain"; icon: string; text: string; sub?: string; to: string; sortKey: number }[] = [];
    for (const a of inbox) list.push({ tone: "red", icon: "approval", text: `결재할 차례: ${a.title}`, sub: a.requester_name, to: "/approvals", sortKey: -100 });
    for (const { r, s } of calc.dueSoon) {
      const d = daysTo(s.due_date);
      list.push({ tone: d < 0 ? "red" : "amber", icon: "receipt_long", text: `정산 결제 ${d < 0 ? `${-d}일 지남` : d === 0 ? "오늘" : `D-${d}`} · ${s.buyer || r.lc_bank} · ${r.material_name}`, sub: `결제 예정 ${md(s.due_date)}`, to: "/settlements", sortKey: d });
    }
    for (const l of stock.lots) {
      if (!l.free_until || (calc.lotRemain.get(l.id) || 0) <= 0.001) continue;
      const d = daysTo(l.free_until);
      if (d <= 7) list.push({ tone: d <= 2 ? "red" : "amber", icon: "timer", text: `프리타임 ${d < 0 ? `${-d}일 지남` : d === 0 ? "오늘 만료" : `D-${d}`} · ${l.material}`, sub: `잔여 ${fmt(calc.lotRemain.get(l.id) || 0)}MT`, to: "/stock", sortKey: d });
    }
    for (const r of calc.imps) {
      if (r.eta && r.eta < t && r.status === "shipped") list.push({ tone: "amber", icon: "directions_boat", text: `ETA 지남 · 도착 처리 확인: ${r.material_name}`, sub: `${r.supplier || ""} · ETA ${md(r.eta)}`, to: "/imports", sortKey: 3 });
    }
    const unlinked = stock.lots.filter((l) => !l.import_id && (l.in_date || "") >= `${now}-01`).length;
    if (unlinked) list.push({ tone: "plain", icon: "link", text: `이번 달 입고 ${unlinked}건이 계약과 연결 안 됨`, sub: "연결하면 업체·LC개설처·단가가 붙어요", to: "/stock", sortKey: 20 });
    if (!calc.plansOf(next).length) list.push({ tone: "plain", icon: "edit_calendar", text: `${Number(next.slice(5))}월 납품계획 미입력`, sub: "애경·대경 수량과 단가를 넣어주세요", to: "/plan", sortKey: 30 });
    return list.sort((a, b) => a.sortKey - b.sortKey);
  }, [inbox, calc, stock.lots, next, now, t]);

  if (!imports) return <Spinner />;

  const m = Number(now.slice(5));
  const thisPlans = calc.plansOf(now);
  const bidLines = [...calc.latestBid.values()].map((b) => {
    const ours = b.results.filter((r: any) => customerOf(r.company));
    const period = b.period_from ? `${Number(b.period_from.slice(5, 7))}~${Number((b.period_to || "").slice(5, 7))}월` : "";
    return { key: b.id, label: `${b.plant} ${period}`, ours };
  });

  const steps = [
    {
      no: 1, title: "입찰", icon: "gavel", to: "/plan",
      main: bidLines.length ? `${bidLines.length}개 발전소` : "입력 전",
      lines: bidLines.length ? bidLines.map((b) => `${b.label}: ${b.ours.length ? b.ours.map((r: any) => `${customerOf(r.company)} ${r.status || ""}${r.price_l ? ` ${won(r.price_l, 0)}원/L` : ""}`).join(", ") : "우리 납품처 결과 없음"}`) : ["남부·중부 입찰 결과를 넣어주세요"],
      warn: !bidLines.length,
    },
    {
      no: 2, title: `${m}월 납품계획`, icon: "edit_calendar", to: "/plan",
      main: thisPlans.length ? `${fmt(calc.need(now))} MT` : "미입력",
      lines: thisPlans.length
        ? CUSTOMERS.map((c) => { const p = thisPlans.find((x) => x.customer === c.key); return p ? `${c.key} ${fmt(n(p.qty_mt))}MT${p.price_l ? ` · 납품가 ${won(supplyPrice(p.price_l, p.freight), 0)}원/kg` : ""}` : `${c.key} -`; })
        : ["대표님께 받은 수량·가격을 넣어주세요"],
      warn: !thisPlans.length,
    },
    {
      no: 3, title: "구매 · 선적", icon: "sailing", to: "/imports",
      main: `${fmt(calc.etaMonth.reduce((a, r) => a + n(r.quantity), 0))} MT`,
      lines: [`${m}월 도착 예정 ${calc.etaMonth.length}건`, `이동 중 ${calc.transit.length}건 · ${fmt(calc.transit.reduce((a, r) => a + n(r.quantity), 0))}MT`, `계약(선적 전) ${calc.contracted.length}건`],
    },
    {
      no: 4, title: "입출고 · 재고", icon: "inventory_2", to: "/stock",
      main: `${fmt(calc.stockMt)} MT`,
      lines: ["현재 재고 (공장 미투입)", `공장투입 진행 ${fmt(calc.doingMt)}MT`, `${m}월 출고 ${fmt(calc.outMonth)}MT`],
    },
    {
      no: 5, title: "재무 · 정산", icon: "receipt_long", to: "/settlements",
      main: `${calc.openSettle.length}건`,
      lines: ["정산 진행 중 (최종 확인 전)", `결제 예정 14일 내 ${calc.dueSoon.length}건`, `내 결재 차례 ${inbox.length}건`],
      warn: calc.dueSoon.length > 0 || inbox.length > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="headline text-3xl font-bold tracking-tight text-primary">대시보드</h1>
        <p className="text-on-surface-variant">안녕하세요, {user!.name}님. 입찰부터 정산까지 오르카 업무 흐름이에요.</p>
      </div>

      {/* 업무 흐름 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <Link key={s.no} to={s.to} className={`card relative flex flex-col p-4 transition-all hover:shadow-md ${s.warn ? "border-amber-400" : ""}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">{s.no}</span>
              <span className="font-bold text-primary">{s.title}</span>
              <Icon name={s.icon} className="ml-auto text-on-surface-variant" size={20} />
            </div>
            <div className={`headline text-2xl font-bold ${s.warn ? "text-amber-700" : "text-primary"}`}>{s.main}</div>
            <div className="mt-1 space-y-0.5 text-xs text-on-surface-variant">
              {s.lines.map((l, j) => <div key={j} className="truncate" title={l}>{l}</div>)}
            </div>
            {i < steps.length - 1 && <Icon name="chevron_right" className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-surface text-outline lg:block" size={22} />}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* 부족 경고 */}
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="warning" className="text-secondary" /> 원료 확보 현황</h3>
            <Link to="/plan" className="text-xs font-semibold text-secondary hover:underline">납품계획</Link>
          </div>
          {[{ month: now, need: calc.need(now), have: calc.haveNow, gap: calc.gapNow, label: `${m}월`, haveNote: "재고 + 이번 달 입항 예정" },
            { month: next, need: calc.need(next), have: calc.haveNext, gap: calc.gapNext, label: `${Number(next.slice(5))}월`, haveNote: "이월 + 다음 달 입항 예정" }].map((x) => (
            <div key={x.month} className="mb-4 last:mb-0">
              <div className="flex items-baseline justify-between">
                <span className="font-bold">{x.label}</span>
                {x.need ? (
                  x.gap < 0
                    ? <span className="font-bold text-error">부족 {fmt(-x.gap)} MT</span>
                    : <span className="font-bold text-success">여유 {fmt(x.gap)} MT</span>
                ) : <span className="text-xs text-on-surface-variant">납품계획 미입력</span>}
              </div>
              <Bar label="납품 필요" value={x.need} max={Math.max(x.need, x.have, 1)} cls="bg-outline" />
              <Bar label="확보" value={x.have} max={Math.max(x.need, x.have, 1)} cls={x.need && x.gap < 0 ? "bg-error" : "bg-primary"} note={x.haveNote} />
            </div>
          ))}
          <p className="mt-3 text-[11px] text-on-surface-variant">원료 MT 기준 단순 비교예요 (가공 로스는 아직 반영 안 함). 입항 예정은 아직 입고 전 단계(계약·선적·도착·통관)인 건만 셉니다.</p>
        </div>

        {/* 할 일 */}
        <div className="card overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between border-b border-outline-variant px-5 py-3">
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="checklist" className="text-secondary" /> 할 일</h3>
            <span className="text-xs text-on-surface-variant">{todos.length}건</span>
          </div>
          {todos.length === 0 ? <p className="px-5 py-10 text-center text-sm text-on-surface-variant">지금 챙길 일이 없어요</p> : (
            <ul className="max-h-[360px] divide-y divide-outline-variant overflow-y-auto">
              {todos.map((x, i) => (
                <li key={i}>
                  <Link to={x.to} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-container-low">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${x.tone === "red" ? "bg-error-container text-error" : x.tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-surface-container-highest text-on-surface-variant"}`}>
                      <Icon name={x.icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{x.text}</span>
                      {x.sub && <span className="block truncate text-xs text-on-surface-variant">{x.sub}</span>}
                    </span>
                    <Icon name="chevron_right" className="text-on-surface-variant" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <FxCard />
    </div>
  );
}

function Bar({ label, value, max, cls, note }: { label: string; value: number; max: number; cls: string; note?: string }) {
  return (
    <div className="mt-1.5">
      <div className="flex justify-between text-xs text-on-surface-variant"><span>{label}{note ? ` (${note})` : ""}</span><span>{fmt(value)} MT</span></div>
      <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-surface-container-highest"><div className={`h-full ${cls}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
    </div>
  );
}
