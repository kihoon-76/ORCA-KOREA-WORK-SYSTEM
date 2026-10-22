import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner, Icon, Badge, Modal } from "../components/ui";
import { ApprovalCreateModal, ApprovalDetailModal, DOC_LABEL } from "./Approvals";
import ShipCalendar from "../components/ShipCalendar";
import FxCard from "../components/FxCard";

// 수입 지도 미니 보기 — 지도 라이브러리가 커서 필요할 때만 불러온다
const MiniImportMap = lazy(() => import("./ImportMap").then((m) => ({ default: m.MiniImportMap })));
const IN_TRANSIT = new Set(["shipped", "arrived", "customs"]);
function fmtNum(n: number) {
  return Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ETD/ETA처럼 "10-02(금)" 형식으로 날짜 + 요일을 함께 보여준다 (원료 수입/수출현황과 동일한 표기 방식)
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
function formatDateWithWeekday(v: string | null | undefined): string {
  if (!v) return "-";
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return v;
  const w = WEEKDAY_KO[new Date(y, m - 1, d).getDay()];
  return `${v.slice(5)}${w ? `(${w})` : ""}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  // 이번 달 수입 요약(ETA 기준)을 계산하기 위한 원료 수입현황 전체 목록
  const [imports, setImports] = useState<any[]>([]);
  // 결재 대기 문서: 내가 결재할 차례인 문서 + 내가 올렸는데 아직 결재 중인 문서
  const [pending, setPending] = useState<any[]>([]);
  const [editItem, setEditItem] = useState<any>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  function loadPending() {
    Promise.all([
      api.get("/approvals?inbox=1").catch(() => ({ items: [] })),
      api.get("/approvals?mine=1").catch(() => ({ items: [] })),
    ]).then(([inbox, mine]) => {
      const seen = new Set<number>();
      const list: any[] = [];
      for (const a of inbox.items || []) { seen.add(a.id); list.push({ ...a, _mine: false }); }
      for (const a of mine.items || []) if (a.status === "pending" && !seen.has(a.id)) list.push({ ...a, _mine: true });
      setPending(list);
    });
  }
  useEffect(() => {
    api.get("/dashboard").then(setData);
    api.get("/trade/imports").then((r) => setImports(r.items || []));
    loadPending();
  }, []);
  // 이번 달 도착(ETA) 건수·물량·금액 + 지금 이동 중(선적~통관)
  const month = useMemo(() => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const rs = imports.filter((r) => String(r.eta || "").startsWith(ym));
    const money = new Map<string, number>();
    for (const r of rs) {
      const amt = r.total_price != null && r.total_price !== "" ? Number(r.total_price) || 0 : (Number(r.quantity) || 0) * (Number(r.unit_price) || 0);
      if (amt) money.set(r.currency || "USD", (money.get(r.currency || "USD") || 0) + amt);
    }
    const transit = imports.filter((r) => IN_TRANSIT.has(r.status));
    return {
      m: d.getMonth() + 1,
      count: rs.length,
      qty: rs.reduce((a, r) => a + (Number(r.quantity) || 0), 0),
      money: Array.from(money.entries()).sort((a, b) => b[1] - a[1]),
      transitCount: transit.length,
      transitQty: transit.reduce((a, r) => a + (Number(r.quantity) || 0), 0),
    };
  }, [imports]);

  if (!data) return <Spinner />;

  const cards = [
    { label: `${month.m}월 도착 건수 (ETA)`, value: `${month.count}`, unit: "건", icon: "sailing", iconBg: "bg-primary-fixed text-primary" },
    { label: `${month.m}월 도착 물량 (ETA)`, value: fmtNum(month.qty), unit: "MT", icon: "scale", iconBg: "bg-secondary-fixed text-secondary" },
    { label: `${month.m}월 도착 금액 (ETA)`, value: month.money.length ? fmtNum(month.money[0][1]) : "-", unit: month.money.length ? month.money[0][0] : "",
      sub: month.money.slice(1).map(([c, v]) => `${c} ${fmtNum(v)}`).join(" · "), icon: "payments", iconBg: "bg-tertiary-fixed text-on-tertiary-container" },
    { label: "지금 이동 중 (선적~통관)", value: `${month.transitCount}`, unit: "건", sub: `${fmtNum(month.transitQty)} MT`, icon: "directions_boat", iconBg: "bg-amber-100 text-amber-700" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="headline text-3xl font-bold tracking-tight text-primary">대시보드</h1>
        <p className="text-on-surface-variant">안녕하세요, {user!.name}님. 이번 달 원료 수입 현황이에요.</p>
      </div>

      {/* 이번 달 수입 요약 — 클릭하면 수입 지도 현황판 */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} to="/import-map" className="card p-6 transition-all duration-300 hover:shadow-md">
            <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBg}`}><Icon name={card.icon} /></div>
            <p className="mono-label text-on-surface-variant">{card.label}</p>
            <h2 className="headline mt-1 text-3xl font-bold text-primary">{card.value} <span className="text-lg">{card.unit}</span></h2>
            {card.sub ? <p className="mt-0.5 text-xs text-on-surface-variant">{card.sub}</p> : null}
          </Link>
        ))}
      </div>

      {/* 환율 */}
      <FxCard />

      {/* 선박 일정 캘린더 — ETD(출항)·ETA(도착)를 달력으로, 끌어서/클릭해서 날짜 수정 */}
      <div className="card overflow-hidden">
        <ShipCalendar imports={imports} onUpdated={(item) => setImports((prev) => prev.map((x) => (x.id === item.id ? item : x)))} />
      </div>

      {/* 결재 대기 + 수입 지도 미니 보기 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      {/* 결재 대기 */}
        <div className="card overflow-hidden lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-6 py-4">
          <div>
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="pending_actions" className="text-secondary" /> 결재 대기</h3>
            <p className="mt-0.5 text-xs text-on-surface-variant">내가 결재할 차례인 문서와, 내가 올렸는데 아직 결재가 끝나지 않은 문서예요</p>
          </div>
          <Link to="/approvals" className="text-sm font-semibold text-secondary hover:underline">전자결재 열기</Link>
        </div>
        {pending.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-on-surface-variant">결재 대기 중인 문서가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[640px]">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr><th className="th">구분</th><th className="th">문서</th><th className="th">제목</th><th className="th whitespace-nowrap">기안자</th><th className="th">금액</th><th className="th">상신일</th><th className="th"></th></tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {pending.map((a) => (
                  <tr key={a.id} className="cursor-pointer transition-colors hover:bg-surface-container-low" onClick={() => setDetailId(a.id)}>
                    <td className="td whitespace-nowrap">
                      {a._mine
                        ? <span className="badge bg-surface-container-highest text-on-surface-variant">내가 상신</span>
                        : <span className="badge bg-error-container text-error">내 결재 차례</span>}
                    </td>
                    <td className="td whitespace-nowrap text-xs">{DOC_LABEL[a.doc_type] || a.doc_type || "-"}</td>
                    <td className="td min-w-[180px] font-bold">{a.title}</td>
                    <td className="td whitespace-nowrap">{a.requester_name || "-"}</td>
                    <td className="td whitespace-nowrap">{a.amount != null ? `${a.currency || ""} ${Number(a.amount).toLocaleString()}` : "-"}</td>
                    <td className="td whitespace-nowrap font-mono text-xs">{formatDateWithWeekday(String(a.created_at || "").slice(0, 10))}</td>
                    <td className="td text-right"><Icon name="chevron_right" className="text-on-surface-variant" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        <div className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="public" className="text-secondary" /> 수입 지도</h3>
            <Link to="/import-map" className="text-sm font-semibold text-secondary hover:underline">현황판 열기</Link>
          </div>
          <Suspense fallback={<div className="flex h-[340px] items-center justify-center"><Spinner /></div>}>
            <MiniImportMap />
          </Suspense>
        </div>
      </div>


      {editItem && (
        <ApprovalCreateModal docType={editItem.doc_type || null} editItem={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); loadPending(); }} />
      )}
      {detailId !== null && (
        <ApprovalDetailModal id={detailId} role={user!.role} meId={user!.id}
          onClose={() => { setDetailId(null); loadPending(); }}
          onEdit={(item) => { setDetailId(null); setEditItem({ ...item, viewer_ids: item.viewer_ids || [] }); }} />
      )}

    </div>
  );
}
