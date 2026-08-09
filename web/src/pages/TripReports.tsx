import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader, Spinner, Empty, Badge } from "../components/ui";
import { ApprovalCreateModal, ApprovalDetailModal } from "./Approvals";
import { parseTripReportContent, tripPeriod } from "../tripReport";

// 출장결과보고: 누구나 기안 → 대표이사 최종결재 (재무차장 자동 열람, 참조 지정 가능)
export default function TripReports() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    api.get(`/approvals?doc_type=trip_report${tab === "mine" ? "&mine=1" : ""}`)
      .then((r) => setItems(r.items || []))
      .finally(() => setLoading(false));
  }
  useEffect(load, [tab]);

  return (
    <div>
      <PageHeader title="출장결과보고" subtitle="누구나 기안 → 대표이사 최종결재 · 재무차장 자동 열람 (참조 지정 가능)"
        action={<button className="btn-primary" onClick={() => setCreating(true)}>+ 출장결과보고 기안</button>} />

      <div className="mb-4 flex w-fit gap-1 rounded-lg bg-slate-200 p-1 text-sm">
        {[["all", "전체"], ["mine", "내 기안"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === k ? "bg-white shadow text-brand-700" : "text-slate-600"}`}>{l}</button>
        ))}
      </div>

      {loading ? <Spinner /> : items.length === 0 ? (
        <Empty text={tab === "mine" ? "기안한 출장결과보고가 없습니다" : "열람 가능한 출장결과보고가 없습니다"} icon="flight_takeoff" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead><tr className="bg-slate-50">
              <th className="th">제목</th><th className="th">기안자</th><th className="th">출장지</th>
              <th className="th">출장기간</th><th className="th">출장비용</th><th className="th">기안일</th>
              <th className="th">상태</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((t) => {
                const p = parseTripReportContent(t.content || "");
                return (
                  <tr key={t.id}>
                    <td className="td font-medium">{t.title}</td>
                    <td className="td">{t.requester_name}</td>
                    <td className="td">{p.destination || "-"}</td>
                    <td className="td font-mono text-xs">{tripPeriod(p) || "-"}</td>
                    <td className="td">{t.amount != null ? `${t.currency} ${Number(t.amount).toLocaleString()}` : "-"}</td>
                    <td className="td font-mono text-xs">{(t.created_at || "").slice(0, 10)}</td>
                    <td className="td"><Badge value={t.status} /></td>
                    <td className="td text-right">
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setDetailId(t.id)}>열기</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editItem) && (
        <ApprovalCreateModal docType="trip_report" editItem={editItem}
          onClose={() => { setCreating(false); setEditItem(null); }}
          onSaved={() => { setCreating(false); setEditItem(null); load(); }} />
      )}
      {detailId !== null && (
        <ApprovalDetailModal id={detailId} role={user!.role} meId={user!.id}
          onClose={() => { setDetailId(null); load(); }}
          onEdit={(item) => { setDetailId(null); setEditItem({ ...item, viewer_ids: item.viewer_ids || [] }); }} />
      )}
    </div>
  );
}
