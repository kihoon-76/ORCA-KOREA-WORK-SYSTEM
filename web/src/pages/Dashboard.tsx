import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner, Icon, Badge, Modal } from "../components/ui";
import { ApprovalCreateModal, ApprovalDetailModal } from "./Approvals";
import { parseTripReportContent, tripPeriod } from "../tripReport";
import { AttachmentPanel } from "./TradeModule";

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
  // 출장결과보고: 누구나 기안 → 대표이사 최종결재 (재무차장 자동 열람)
  const [tripReports, setTripReports] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  // 다가오는 선박 일정에서 행 클릭 시 해당 건의 첨부파일을 바로 보여주기 위한 상태
  const [filesFor, setFilesFor] = useState<any>(null);

  function loadTripReports() {
    api.get("/approvals?doc_type=trip_report&limit=6").then((r) => setTripReports(r.items || [])).catch(() => {});
  }
  useEffect(() => {
    api.get("/dashboard").then(setData);
    api.get("/trade/imports").then((r) => setImports(r.items || []));
    loadTripReports();
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

      {/* 다가오는 선박 일정 + 수입 지도 미니 보기 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="card overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="sailing" className="text-secondary" /> 다가오는 선박 일정</h3>
            <Link to="/imports" className="text-sm font-semibold text-secondary hover:underline">전체보기</Link>
          </div>
          {data.upcoming_shipments.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-on-surface-variant">예정된 선박 일정이 없습니다</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-outline-variant bg-surface-container-low">
                  <tr><th className="th">구분</th><th className="th">원료명</th><th className="th">공급사</th><th className="th">물량</th><th className="th">ETD</th><th className="th">ETA</th><th className="th">LC개설</th></tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {data.upcoming_shipments.map((s: any, i: number) => (
                    <tr key={i} className="cursor-pointer transition-colors hover:bg-surface-container-low" onClick={() => setFilesFor(s)} title="클릭하면 첨부파일 보기">
                      <td className="td"><span className="mr-1 text-xs text-on-surface-variant">{s.kind === "import" ? "수입" : "수출"}</span><Badge value={s.status} /></td>
                      <td className="td font-bold">{s.material_name}</td>
                      <td className="td">{s.partner || "-"}</td>
                      <td className="td">{s.quantity != null ? `${Number(s.quantity).toLocaleString()} ${s.unit || "MT"}` : "-"}</td>
                      <td className="td font-mono text-xs">{formatDateWithWeekday(s.etd)}</td>
                      <td className="td font-mono text-xs">{formatDateWithWeekday(s.eta)}</td>
                      <td className="td">{s.lc_bank || "-"}{s.lc_no ? <div className="text-xs text-on-surface-variant">{s.lc_no}</div> : null}</td>
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

      {/* 출장결과보고 결재 */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-6 py-4">
          <div>
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="flight_takeoff" className="text-secondary" /> 출장결과보고 결재</h3>
            <p className="mt-0.5 text-xs text-on-surface-variant">누구나 기안 · 대표이사 최종결재 · 재무차장 자동 열람 (참조 지정 가능)</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" onClick={() => setCreating(true)}>+ 출장결과보고 기안</button>
            <Link to="/trip-reports" className="text-sm font-semibold text-secondary hover:underline">전체보기</Link>
          </div>
        </div>
        {tripReports.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-on-surface-variant">기안된 출장결과보고가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr><th className="th">제목</th><th className="th">기안자</th><th className="th">출장지</th><th className="th">출장기간</th><th className="th">출장비용</th><th className="th">상태</th><th className="th"></th></tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {tripReports.map((t) => {
                  const p = parseTripReportContent(t.content || "");
                  return (
                    <tr key={t.id} className="cursor-pointer transition-colors hover:bg-surface-container-low" onClick={() => setDetailId(t.id)}>
                      <td className="td font-bold">{t.title}</td>
                      <td className="td">{t.requester_name}</td>
                      <td className="td">{p.destination || "-"}</td>
                      <td className="td font-mono text-xs">{tripPeriod(p) || "-"}</td>
                      <td className="td">{t.amount != null ? `${t.currency} ${Number(t.amount).toLocaleString()}` : "-"}</td>
                      <td className="td"><Badge value={t.status} /></td>
                      <td className="td text-right"><Icon name="chevron_right" className="text-on-surface-variant" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filesFor && (
        <Modal open={!!filesFor} onClose={() => setFilesFor(null)} title={`📎 ${filesFor.material_name} 첨부파일`} wide>
          <p className="mb-3 text-xs text-on-surface-variant">
            {filesFor.kind === "import" ? "수입" : "수출"} · {filesFor.partner || "-"}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <AttachmentPanel entityType={filesFor.kind} entityId={filesFor.id} category="contract" label="📄 계약서" />
            <AttachmentPanel entityType={filesFor.kind} entityId={filesFor.id} category="shipping_docs" label="🚢 선적서류" />
            <AttachmentPanel entityType={filesFor.kind} entityId={filesFor.id} category="settlement" label="💰 정산서류" />
          </div>
        </Modal>
      )}

      {(creating || editItem) && (
        <ApprovalCreateModal docType="trip_report" editItem={editItem}
          onClose={() => { setCreating(false); setEditItem(null); }}
          onSaved={() => { setCreating(false); setEditItem(null); loadTripReports(); }} />
      )}
      {detailId !== null && (
        <ApprovalDetailModal id={detailId} role={user!.role} meId={user!.id}
          onClose={() => { setDetailId(null); loadTripReports(); }}
          onEdit={(item) => { setDetailId(null); setEditItem({ ...item, viewer_ids: item.viewer_ids || [] }); }} />
      )}

    </div>
  );
}
