import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner, Icon } from "../components/ui";
import FxCard from "../components/FxCard";
import ShipCalendar from "../components/ShipCalendar";
import { addMonths, ym } from "../planCalc";

// 대시보드 — 핵심 숫자 4개(원료 확보·재고·입항 예정·처리 대기) → 선박 일정 → 할 일 → 환율.
// 자세한 내용은 각 메뉴에서 본다.

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
  const need = calc.need(now);
  const arrivingMt = calc.etaMonth.reduce((a, r) => a + n(r.quantity), 0);
  const waiting = inbox.length + calc.dueSoon.length;
  const tiles = [
    need
      ? { label: `${m}월 원료 확보`, value: calc.gapNow < 0 ? `부족 ${fmt(-calc.gapNow)}` : `여유 ${fmt(calc.gapNow)}`, unit: "MT",
          sub: `납품 ${fmt(need)} · 확보 ${fmt(calc.haveNow)} MT`, tone: calc.gapNow < 0 ? "red" : "green", to: "/plan" }
      : { label: `${m}월 원료 확보`, value: "납품계획 미입력", unit: "", sub: "입력하면 부족분을 계산해요", tone: "amber", to: "/plan" },
    { label: "현재 재고", value: fmt(calc.stockMt), unit: "MT", sub: `공장투입 진행 ${fmt(calc.doingMt)} MT`, tone: "plain", to: "/stock" },
    { label: `${m}월 입항 예정`, value: fmt(arrivingMt), unit: "MT", sub: `${calc.etaMonth.length}건 · 이동 중 ${calc.transit.length}건`, tone: "plain", to: "/imports" },
    { label: "처리 대기", value: `${waiting}`, unit: "건", sub: `결재 ${inbox.length} · 정산 결제 임박 ${calc.dueSoon.length}`, tone: waiting ? "amber" : "plain", to: inbox.length ? "/approvals" : "/settlements" },
  ];
  const TONE: Record<string, string> = { red: "text-error", green: "text-success", amber: "text-amber-700", plain: "text-primary" };
  const shown = todos.slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="headline text-3xl font-bold tracking-tight text-primary">대시보드</h1>
          <p className="text-on-surface-variant">안녕하세요, {user!.name}님.</p>
        </div>
        <Link to="/flow" className="flex items-center gap-1 text-sm font-semibold text-secondary hover:underline"><Icon name="account_tree" size={18} /> 우리 회사 업무 흐름</Link>
      </div>

      {/* 핵심 숫자 4개 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <Link key={x.label} to={x.to} className="card p-4 transition-shadow hover:shadow-md">
            <p className="mono-label text-on-surface-variant">{x.label}</p>
            <p className={`headline mt-1 text-2xl font-bold ${TONE[x.tone]}`}>{x.value} <span className="text-sm font-medium text-on-surface-variant">{x.unit}</span></p>
            <p className="mt-0.5 truncate text-xs text-on-surface-variant">{x.sub}</p>
          </Link>
        ))}
      </div>

      {/* 선박 일정 */}
      <div className="card overflow-hidden">
        <ShipCalendar imports={imports} onUpdated={(item) => setImports((prev) => (prev || []).map((x) => (x.id === item.id ? item : x)))}
          onCreated={(item) => setImports((prev) => [item, ...(prev || [])])} />
      </div>

      {/* 할 일 */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-3">
          <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="checklist" className="text-secondary" /> 할 일</h3>
          <span className="text-xs text-on-surface-variant">{todos.length > shown.length ? `급한 순 ${shown.length}건 / 전체 ${todos.length}건` : `${todos.length}건`}</span>
        </div>
        {shown.length === 0 ? <p className="px-5 py-8 text-center text-sm text-on-surface-variant">지금 챙길 일이 없어요</p> : (
          <ul className="grid divide-y divide-outline-variant md:grid-cols-2 md:divide-y-0">
            {shown.map((x, i) => (
              <li key={i} className="md:border-b md:border-outline-variant">
                <Link to={x.to} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-container-low">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${x.tone === "red" ? "bg-error" : x.tone === "amber" ? "bg-amber-500" : "bg-outline"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{x.text}</span>
                    {x.sub && <span className="block truncate text-xs text-on-surface-variant">{x.sub}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <FxCard />
    </div>
  );
}
