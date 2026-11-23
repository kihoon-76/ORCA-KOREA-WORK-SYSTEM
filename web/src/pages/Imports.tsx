import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import TradeModule from "./TradeModule";
import ShipCalendar from "../components/ShipCalendar";
import { api } from "../api";
import { PageHeader, Spinner, Icon } from "../components/ui";

// 원료 수입현황 — 선박일정(기본) / 목록 / 지도 를 한 페이지에서 탭으로 본다
const ImportMap = lazy(() => import("./ImportMap"));
const VIEWS = [
  { key: "calendar", label: "선박일정", icon: "calendar_month" },
  { key: "list", label: "목록", icon: "view_list" },
  { key: "map", label: "지도", icon: "public" },
] as const;

export default function Imports() {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as "list" | "calendar" | "map") || "calendar";
  const setView = (v: string) => setParams(v === "calendar" ? {} : { view: v }, { replace: true });

  return (
    <div>
      <div className="mb-4 flex w-fit gap-1 rounded-lg bg-surface-container p-1 text-sm">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${view === v.key ? "bg-surface-container-lowest text-primary shadow" : "text-on-surface-variant"}`}>
            <Icon name={v.icon} size={18} /> {v.label}
          </button>
        ))}
      </div>
      {view === "list" && (
        <TradeModule config={{
          kind: "import",
          title: "원료 수입현황",
          subtitle: "LC개설·선박일정·계약서·선적서류·가격을 관리합니다",
          endpoint: "/trade/imports",
          entityType: "import",
          partnerKey: "supplier",
          partnerLabel: "공급사(Seller)",
          lcLabel: "구매자(Buyer)",
        }} />
      )}
      {view === "calendar" && <CalendarView />}
      {view === "map" && <Suspense fallback={<Spinner />}><ImportMap /></Suspense>}
    </div>
  );
}

function CalendarView() {
  const [imports, setImports] = useState<any[] | null>(null);
  useEffect(() => { api.get("/trade/imports").then((r: any) => setImports(r.items || [])); }, []);
  return (
    <div>
      <PageHeader title="원료 수입현황 · 선박일정" subtitle="ETD(출항)·ETA(도착)를 달력으로 봅니다. 끌어서 날짜를 바꾸고, 빈 날짜를 눌러 새 건을 등록할 수 있어요." />
      {!imports ? <Spinner /> : (
        <div className="card overflow-hidden">
          <ShipCalendar imports={imports} onUpdated={(item) => setImports((prev) => (prev || []).map((x) => (x.id === item.id ? item : x)))}
            onCreated={(item) => setImports((prev) => [item, ...(prev || [])])} />
        </div>
      )}
    </div>
  );
}
