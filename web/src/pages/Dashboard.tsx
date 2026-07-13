import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Spinner, Icon, Badge } from "../components/ui";

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [stock, setStock] = useState<any[]>([]);
  const [inbox, setInbox] = useState<any[]>([]);

  useEffect(() => {
    api.get("/dashboard").then(setData);
    api.get("/inventory").then((r) => setStock(r.items || []));
    api.get("/approvals?inbox=1").then((r) => setInbox(r.items || []));
  }, []);
  if (!data) return <Spinner />;

  const c = data.counts;
  const cards = [
    { label: "진행 수입건", value: c.open_imports, icon: "sailing", to: "/imports", chip: "실시간", chipClass: "bg-primary-fixed text-on-primary-fixed", iconBg: "bg-primary-fixed text-primary" },
    { label: "진행 수출건", value: c.open_exports, icon: "local_shipping", to: "/exports", chip: "실시간", chipClass: "bg-secondary-fixed text-on-secondary-container", iconBg: "bg-secondary-fixed text-secondary" },
    { label: "내 결재함", value: c.my_inbox, icon: "pending_actions", to: "/approvals", chip: c.my_inbox > 0 ? "확인 필요" : "없음", chipClass: c.my_inbox > 0 ? "bg-error-container text-error" : "bg-surface-container text-on-surface-variant", iconBg: "bg-tertiary-fixed text-on-tertiary-container" },
    { label: "진행중 업무", value: c.open_tasks, icon: "task_alt", to: "/tasks", chip: "오늘", chipClass: "bg-surface-container text-on-surface-variant", iconBg: "bg-surface-container-high text-on-surface-variant" },
  ];

  const maxStock = Math.max(1, ...stock.map((s) => Number(s.in_qty) || 0));
  const barColors = ["bg-primary", "bg-secondary", "bg-on-tertiary-container", "bg-primary-fixed-dim"];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="headline text-3xl font-bold tracking-tight text-primary">대시보드</h1>
        <p className="text-on-surface-variant">안녕하세요, {user!.name}님. 바이오 연료 물류 현황을 확인하세요.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} to={card.to} className="card p-6 transition-all duration-300 hover:shadow-md">
            <div className="mb-4 flex items-start justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBg}`}><Icon name={card.icon} /></div>
              <span className={`mono-label rounded px-2 py-1 ${card.chipClass}`}>{card.chip}</span>
            </div>
            <p className="mono-label text-on-surface-variant">{card.label}</p>
            <h2 className="headline mt-1 text-3xl font-bold text-primary">{card.value} <span className="text-lg">건</span></h2>
          </Link>
        ))}
      </div>

      {/* Bento: shipments + inventory */}
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
                  <tr><th className="th">구분</th><th className="th">원료명</th><th className="th">공급사</th><th className="th">물량</th><th className="th">ETA</th></tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {data.upcoming_shipments.map((s: any, i: number) => (
                    <tr key={i} className="transition-colors hover:bg-surface-container-low">
                      <td className="td"><span className="mr-1 text-xs text-on-surface-variant">{s.kind === "import" ? "수입" : "수출"}</span><Badge value={s.status} /></td>
                      <td className="td font-bold">{s.material_name}</td>
                      <td className="td">{s.partner || "-"}</td>
                      <td className="td">{s.quantity != null ? `${Number(s.quantity).toLocaleString()} ${s.unit || "MT"}` : "-"}</td>
                      <td className="td font-mono text-xs">{s.eta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card flex flex-col p-6 lg:col-span-2">
          <h3 className="headline mb-6 flex items-center gap-2 text-lg font-bold text-primary"><Icon name="inventory" className="text-secondary" /> 재고 수준</h3>
          {stock.length === 0 ? (
            <p className="flex-1 text-sm text-on-surface-variant">재고 데이터가 없습니다</p>
          ) : (
            <div className="flex-1 space-y-5">
              {stock.slice(0, 5).map((s, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="mono-label">{s.material_name}</span>
                    <span className="font-bold">{Number(s.stock_qty).toLocaleString()} {s.unit}</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-surface-container">
                    <div className={`h-full rounded-full transition-all duration-1000 ${barColors[i % barColors.length]}`}
                      style={{ width: `${Math.max(4, (Number(s.stock_qty) / maxStock) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <Link to="/inventory" className="mt-6 border-t border-outline-variant pt-4 text-center text-xs text-secondary hover:underline">재고관리 바로가기</Link>
        </div>
      </div>

      {/* Bottom: approval queue + quick links */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="border-b border-outline-variant px-6 py-4">
            <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="credit_score" className="text-secondary" /> 내 결재 대기 항목</h3>
          </div>
          {inbox.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-on-surface-variant">결재할 문서가 없습니다</p>
          ) : (
            <div className="divide-y divide-outline-variant">
              {inbox.slice(0, 5).map((a) => (
                <Link to="/approvals" key={a.id} className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-surface-container-low">
                  <div>
                    <p className="font-bold">{a.title}</p>
                    <p className="font-mono text-xs text-on-surface-variant">{a.requester_name} 상신 {a.amount != null ? `· ${a.currency} ${Number(a.amount).toLocaleString()}` : ""}</p>
                  </div>
                  <Icon name="chevron_right" className="text-on-surface-variant" />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <h3 className="headline mb-4 flex items-center gap-2 text-lg font-bold text-primary"><Icon name="bolt" className="text-secondary" /> 빠른 메뉴</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { to: "/imports", label: "수입 등록", icon: "sailing" },
              { to: "/exports", label: "수출 등록", icon: "local_shipping" },
              { to: "/approvals", label: "자금결제 상신", icon: "approval" },
              { to: "/materials", label: "분석결과 등록", icon: "science" },
              { to: "/trips", label: "출장계획서", icon: "flight" },
              { to: "/attendance", label: "출퇴근 체크", icon: "schedule" },
            ].map((q) => (
              <Link key={q.to} to={q.to} className="flex items-center gap-3 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-3 transition-colors hover:bg-surface-container">
                <Icon name={q.icon} className="text-secondary" /><span className="text-sm font-semibold text-primary">{q.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
