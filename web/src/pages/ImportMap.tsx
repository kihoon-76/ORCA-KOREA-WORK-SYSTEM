import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api";
import { Spinner, Modal, Icon, PageHeader } from "../components/ui";
import { PORT_PRESETS, KOREA_PORTS, PRESET_COUNTRIES } from "../ports";

// ───────────────────────── 공용 도우미 ─────────────────────────
// 배경지도: Esri 지도 (API 키 없이 사용) — 바다 / 일반 / 위성 중 골라 볼 수 있다
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const ESRI_ATTR = 'Tiles &copy; <a href="https://www.esri.com/">Esri</a>';
type BaseKey = "ocean" | "street" | "satellite";
const BASEMAPS: Record<BaseKey, { label: string; layers: { url: string; native: number }[] }> = {
  ocean: { label: "바다", layers: [
    { url: `${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`, native: 10 },
    { url: `${ESRI}/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`, native: 10 },
  ] },
  street: { label: "일반", layers: [
    { url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, native: 16 },
  ] },
  satellite: { label: "위성", layers: [
    { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, native: 16 },
    { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, native: 16 },
  ] },
};
function makeBaseLayer(k: BaseKey) {
  return L.layerGroup(BASEMAPS[k].layers.map((l) => L.tileLayer(l.url, { attribution: ESRI_ATTR, maxNativeZoom: l.native, maxZoom: 14 })));
}
const BASE_PREF_KEY = "orca_import_map_base";
function loadBasePref(): BaseKey {
  try {
    const v = localStorage.getItem(BASE_PREF_KEY);
    if (v === "ocean" || v === "street" || v === "satellite") return v;
  } catch { /* 저장소를 못 쓰는 환경이면 기본값 */ }
  return "ocean";
}

const COLOR_DONE = "#4059aa";    // 계약 / 도착 이후
const COLOR_TRANSIT = "#d97706"; // 이동 중 (선적~통관)
const COLOR_DEST = "#001629";

const STATUS_LABEL: Record<string, string> = {
  contracted: "계약", shipped: "선적", customs: "통관", stored: "입고", processed: "가공", released: "출고", settled: "정산",
  arrived: "도착", cleared: "통관완료", melt_in: "멜팅", melt_out: "멜팅", delivered: "출고", done: "완료",
};
const IN_TRANSIT = new Set(["shipped", "arrived", "customs"]);

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
function fmtDate(v?: string | null) {
  if (!v) return "-";
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return v;
  const w = WEEKDAY_KO[new Date(y, m - 1, d).getDay()];
  const thisYear = new Date().getFullYear();
  return `${y !== thisYear ? `${String(y).slice(2)}-` : ""}${v.slice(5, 10)}(${w})`;
}
function fmtNum(n: number) {
  return Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function esc(s: any) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}
function normKey(s: string) {
  return (s || "").trim().replace(/\s+/g, " ").toUpperCase();
}
// 한국 중심으로 보기 위해 아메리카 대륙은 태평양 건너 오른쪽(동쪽)에 그린다
function wrapLng(lng: number) {
  return lng < -30 ? lng + 360 : lng;
}
function rowAmount(r: any) {
  if (r.total_price != null && r.total_price !== "") return Number(r.total_price) || 0;
  return (Number(r.quantity) || 0) * (Number(r.unit_price) || 0);
}
function sumByCurrency(rows: any[]) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const amt = rowAmount(r);
    if (!amt) continue;
    const cur = r.currency || "USD";
    m.set(cur, (m.get(cur) || 0) + amt);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}
function moneyText(rows: any[]) {
  const s = sumByCurrency(rows);
  return s.length ? s.map(([c, v]) => `${c} ${fmtNum(v)}`).join(" · ") : "-";
}
// 출발지 → 도착지 사이를 살짝 휘어진 곡선으로 (항로처럼 보이도록)
function curvePoints(a: [number, number], b: [number, number]): [number, number][] {
  const [y1, x1] = a, [y2, x2] = b;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const k = 0.18;
  const cx = mx - dy * k, cy = my + dx * k;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
    const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
    pts.push([y, x]);
  }
  return pts;
}

interface Group {
  key: string;
  lat: number;
  lng: number;
  country: string;
  region: string;
  suppliers: string[];
  rows: any[];
  qty: number;
  transit: number;
}

// ───────────────────────── 페이지 ─────────────────────────
export default function ImportMap() {
  const [imports, setImports] = useState<any[] | null>(null);
  const [locs, setLocs] = useState<any[]>([]);
  const [dest, setDest] = useState<any>(null);
  const [year, setYear] = useState("");
  const [stage, setStage] = useState("");
  const [material, setMaterial] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerFocus, setManagerFocus] = useState<string | null>(null);

  function loadAll() {
    api.get("/trade/imports").then((r) => setImports(r.items || []));
    api.get("/geo/suppliers").then((r) => setLocs(r.items || []));
    api.get("/geo/dest").then((r) => setDest(r.item));
  }
  useEffect(loadAll, []);

  const locByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const l of locs) m.set(l.supplier_key || normKey(l.supplier), l);
    return m;
  }, [locs]);

  const years = useMemo(() => {
    const s = new Set<string>();
    for (const r of imports || []) if (r.contract_date) s.add(String(r.contract_date).slice(0, 4));
    return Array.from(s).sort().reverse();
  }, [imports]);
  const materials = useMemo(() => {
    const s = new Set<string>();
    for (const r of imports || []) if (r.material_name) s.add(r.material_name);
    return Array.from(s).sort();
  }, [imports]);

  const rows = useMemo(() => (imports || []).filter((r) => {
    if (year && !String(r.contract_date || "").startsWith(year)) return false;
    if (material && r.material_name !== material) return false;
    if (stage === "transit" && !IN_TRANSIT.has(r.status)) return false;
    if (stage === "contracted" && r.status !== "contracted") return false;
    if (stage === "after" && (r.status === "contracted" || IN_TRANSIT.has(r.status))) return false;
    return true;
  }), [imports, year, material, stage]);

  // 위치별(같은 항구에 여러 공급사가 있을 수 있음)로 묶기
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of rows) {
      const loc = locByKey.get(normKey(r.supplier));
      if (!loc) continue;
      const key = `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}`;
      let g = m.get(key);
      if (!g) {
        g = { key, lat: Number(loc.lat), lng: wrapLng(Number(loc.lng)), country: loc.country || "", region: loc.region || "", suppliers: [], rows: [], qty: 0, transit: 0 };
        m.set(key, g);
      }
      if (!g.suppliers.includes(loc.supplier)) g.suppliers.push(loc.supplier);
      g.rows.push(r);
      g.qty += Number(r.quantity) || 0;
      if (IN_TRANSIT.has(r.status)) g.transit++;
    }
    for (const g of m.values()) g.rows.sort((a, b) => String(b.contract_date || "").localeCompare(String(a.contract_date || "")));
    return Array.from(m.values()).sort((a, b) => b.qty - a.qty);
  }, [rows, locByKey]);

  const unlocated = useMemo(() => {
    const s = new Map<string, number>();
    for (const r of imports || []) {
      if (!r.supplier || locByKey.has(normKey(r.supplier))) continue;
      s.set(r.supplier.trim(), (s.get(r.supplier.trim()) || 0) + 1);
    }
    return Array.from(s.entries());
  }, [imports, locByKey]);

  const selected = groups.find((g) => g.key === selectedKey) || null;
  useEffect(() => {
    if (selectedKey && !groups.some((g) => g.key === selectedKey)) setSelectedKey(null);
  }, [groups, selectedKey]);

  // 현황판 숫자
  const kpi = useMemo(() => {
    const countries = new Set<string>();
    const suppliers = new Set<string>();
    for (const r of rows) {
      if (r.supplier) suppliers.add(normKey(r.supplier));
      const loc = locByKey.get(normKey(r.supplier));
      if (loc?.country) countries.add(loc.country);
    }
    return {
      count: rows.length,
      qty: rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0),
      money: sumByCurrency(rows),
      countries: countries.size,
      suppliers: suppliers.size,
      transit: rows.filter((r) => IN_TRANSIT.has(r.status)).length,
    };
  }, [rows, locByKey]);

  const byCountry = useMemo(() => {
    const m = new Map<string, { country: string; qty: number; count: number; keys: Set<string> }>();
    for (const g of groups) {
      const c = g.country || "기타";
      const e = m.get(c) || { country: c, qty: 0, count: 0, keys: new Set<string>() };
      e.qty += g.qty;
      e.count += g.rows.length;
      e.keys.add(g.key);
      m.set(c, e);
    }
    return Array.from(m.values()).sort((a, b) => b.qty - a.qty);
  }, [groups]);

  const bySupplier = useMemo(() => {
    const m = new Map<string, { supplier: string; qty: number; count: number; key: string | null; place: string }>();
    for (const r of rows) {
      if (!r.supplier) continue;
      const k = normKey(r.supplier);
      const loc = locByKey.get(k);
      const e = m.get(k) || {
        supplier: loc?.supplier || r.supplier.trim(), qty: 0, count: 0,
        key: loc ? `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}` : null,
        place: loc ? [loc.country, loc.region].filter(Boolean).join(" · ") : "위치 미등록",
      };
      e.qty += Number(r.quantity) || 0;
      e.count++;
      m.set(k, e);
    }
    return Array.from(m.values()).sort((a, b) => b.qty - a.qty);
  }, [rows, locByKey]);

  const mapApi = useRef<{ fitTo: (keys?: Set<string>) => void } | null>(null);

  if (!imports || !dest) return <Spinner />;

  function openManager(supplier?: string) {
    setManagerFocus(supplier || null);
    setManagerOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="수입 지도 현황판" subtitle="원료 수입현황에 입력한 건들을 공급사 위치 기준으로 세계지도에 보여줍니다"
        action={
          <button className="btn-secondary" onClick={() => openManager()}>
            <span className="inline-flex items-center gap-1"><Icon name="edit_location_alt" size={18} /> 공급사 위치 관리</span>
          </button>
        } />

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input w-auto py-1.5 text-sm" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">기간: 전체</option>
          {years.map((y) => <option key={y} value={y}>{y}년 계약</option>)}
        </select>
        <select className="input w-auto py-1.5 text-sm" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">진행상황: 전체</option>
          <option value="contracted">계약 (선적 전)</option>
          <option value="transit">이동 중 (선적~통관)</option>
          <option value="after">입고 이후</option>
        </select>
        <select className="input w-auto py-1.5 text-sm" value={material} onChange={(e) => setMaterial(e.target.value)}>
          <option value="">원료: 전체</option>
          {materials.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {(year || stage || material) && (
          <button className="text-xs text-slate-500 underline" onClick={() => { setYear(""); setStage(""); setMaterial(""); }}>필터 초기화</button>
        )}
      </div>

      {/* 현황판 숫자 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="수입 건수" value={`${kpi.count.toLocaleString()}건`} />
        <Kpi label="총 물량" value={`${fmtNum(kpi.qty)} MT`} />
        <Kpi label="총 금액" value={kpi.money.length ? `${kpi.money[0][0]} ${fmtNum(kpi.money[0][1])}` : "-"}
          sub={kpi.money.slice(1).map(([c, v]) => `${c} ${fmtNum(v)}`).join(" · ") || undefined} />
        <Kpi label="공급 국가" value={`${kpi.countries}개국`} />
        <Kpi label="공급사" value={`${kpi.suppliers}곳`} />
        <Kpi label="이동 중 (선적~통관)" value={`${kpi.transit}건`} accent={kpi.transit > 0} />
      </div>

      {unlocated.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <Icon name="location_off" size={18} />
          <span>위치가 등록되지 않아 지도에 안 보이는 공급사 {unlocated.length}곳:</span>
          {unlocated.slice(0, 8).map(([s, n]) => (
            <button key={s} className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs hover:bg-amber-100" onClick={() => openManager(s)}>
              {s} <span className="text-amber-600">({n}건)</span>
            </button>
          ))}
          {unlocated.length > 8 && <span className="text-xs">외 {unlocated.length - 8}곳</span>}
          <button className="ml-auto text-xs font-semibold underline" onClick={() => openManager(unlocated[0][0])}>위치 등록하기</button>
        </div>
      )}

      {/* 지도 + 오른쪽 상세 */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <WorldMap groups={groups} dest={dest} selectedKey={selectedKey} onSelect={setSelectedKey} apiRef={mapApi} />
        </div>
        <div className="card flex max-h-[600px] flex-col overflow-hidden">
          {selected ? (
            <LocationDetail g={selected} onClose={() => setSelectedKey(null)} onEdit={(s) => openManager(s)} />
          ) : (
            <Overview byCountry={byCountry} bySupplier={bySupplier}
              onCountry={(keys) => mapApi.current?.fitTo(keys)}
              onSupplier={(s) => (s.key ? setSelectedKey(s.key) : openManager(s.supplier))} />
          )}
        </div>
      </div>

      {/* 월별 물량 + 최근 기록 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <MonthlyChart rows={rows} year={year} />
        </div>
        <div className="card flex max-h-[360px] flex-col overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-primary">최근 수입 기록</div>
          <div className="overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">계약일</th>
                  <th className="px-2 py-1.5 text-left font-semibold">원료</th>
                  <th className="px-2 py-1.5 text-left font-semibold">공급사 · 위치</th>
                  <th className="px-2 py-1.5 text-right font-semibold">물량</th>
                  <th className="px-3 py-1.5 text-left font-semibold">상태</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => String(b.contract_date || "").localeCompare(String(a.contract_date || ""))).slice(0, 30).map((r) => {
                  const loc = locByKey.get(normKey(r.supplier));
                  const key = loc ? `${Number(loc.lat).toFixed(3)},${Number(loc.lng).toFixed(3)}` : null;
                  return (
                    <tr key={r.id} className={`border-t border-slate-50 ${key ? "cursor-pointer hover:bg-brand-50" : ""}`}
                      onClick={() => key && setSelectedKey(key)}>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{fmtDate(r.contract_date)}</td>
                      <td className="px-2 py-1.5 font-semibold text-slate-700">{r.material_name}</td>
                      <td className="px-2 py-1.5 text-slate-600">
                        {r.supplier || "-"}
                        <span className="ml-1 text-slate-400">{loc ? `· ${[loc.country, loc.region].filter(Boolean).join(" ")}` : "· 위치 미등록"}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-slate-700">{r.quantity != null ? `${fmtNum(Number(r.quantity))} ${r.unit || "MT"}` : "-"}</td>
                      <td className="px-3 py-1.5"><StatusPill status={r.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="py-8 text-center text-xs text-slate-400">조건에 맞는 수입 건이 없습니다</div>}
          </div>
        </div>
      </div>

      <LocationManager open={managerOpen} focus={managerFocus} onClose={() => setManagerOpen(false)}
        imports={imports} locs={locs} dest={dest}
        onSaved={() => { api.get("/geo/suppliers").then((r) => setLocs(r.items || [])); api.get("/geo/dest").then((r) => setDest(r.item)); }} />
    </div>
  );
}

// ───────────────────────── 작은 조각들 ─────────────────────────
function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${accent ? "text-amber-700" : "text-primary"}`}>{value}</div>
      {sub && <div className="truncate text-[11px] text-slate-400" title={sub}>{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const transit = IN_TRANSIT.has(status);
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${transit ? "bg-amber-50 text-amber-800" : status === "contracted" ? "bg-slate-100 text-slate-600" : "bg-blue-50 text-blue-800"}`}>
      {transit && <Icon name="directions_boat" size={12} />}
      {STATUS_LABEL[status] || status || "-"}
    </span>
  );
}

// 지도: 공급사 위치 원(크기 = 물량) + 한국 도착항까지 곡선(굵기 = 물량)
function WorldMap({ groups, dest, selectedKey, onSelect, apiRef }: {
  groups: Group[]; dest: any; selectedKey: string | null; onSelect: (k: string | null) => void;
  apiRef: React.MutableRefObject<{ fitTo: (keys?: Set<string>) => void } | null>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [base, setBase] = useState<BaseKey>(loadBasePref);
  const baseLayerRef = useRef<L.LayerGroup | null>(null);

  // 배경지도 바꾸기 (선택은 이 브라우저에 기억해 둔다)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    baseLayerRef.current?.remove();
    const layer = makeBaseLayer(base).addTo(map);
    baseLayerRef.current = layer;
    try { localStorage.setItem(BASE_PREF_KEY, base); } catch { /* 무시 */ }
  }, [base]);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { center: [25, 115], zoom: 3, minZoom: 2, zoomControl: true, worldCopyJump: false });
    baseLayerRef.current = makeBaseLayer(base).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", () => onSelectRef.current(null));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  function fitTo(keys?: Set<string>) {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngExpression[] = groupsRef.current.filter((g) => !keys || keys.has(g.key)).map((g) => [g.lat, g.lng]);
    if (!keys && dest) pts.push([dest.lat, dest.lng]);
    if (pts.length === 0) return;
    if (pts.length === 1) map.setView(pts[0], 6);
    else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 6 });
  }
  apiRef.current = { fitTo };

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const maxQty = Math.max(1, ...groups.map((g) => g.qty));
    const destPt: [number, number] = [dest.lat, dest.lng];

    // 1) 항로 곡선 (선택된 위치는 진하게, 나머지는 옅게)
    for (const g of groups) {
      const sel = selectedKey === g.key;
      const transit = g.transit > 0;
      L.polyline(curvePoints([g.lat, g.lng], destPt), {
        color: transit ? COLOR_TRANSIT : COLOR_DONE,
        weight: 1.5 + 5 * (g.qty / maxQty) + (sel ? 1.5 : 0),
        opacity: selectedKey ? (sel ? 0.9 : 0.15) : 0.5,
        dashArray: transit ? "8 8" : undefined,
        className: transit ? "orca-flow" : undefined,
        interactive: false,
      }).addTo(layer);
    }

    // 2) 한국 도착항
    L.circleMarker(destPt, { radius: 7, color: "#fff", weight: 2, fillColor: COLOR_DEST, fillOpacity: 1 })
      .bindTooltip(`<b>${esc(dest.name)}</b> (도착항)`, { permanent: true, direction: "right", offset: [8, 0], className: "orca-map-label" })
      .addTo(layer);

    // 3) 공급사 위치 원 (마우스 올리면 요약, 클릭하면 오른쪽에 상세)
    for (const g of groups) {
      const sel = selectedKey === g.key;
      const transit = g.transit > 0;
      const r = 7 + 15 * Math.sqrt(g.qty / maxQty);
      const place = [g.region, g.country].filter(Boolean).join(", ");
      const last = g.rows[0];
      const tip = `<div style="min-width:160px">
        <div style="font-weight:700;color:#001629">${g.suppliers.map(esc).join(", ")}</div>
        <div style="color:#64748b;font-size:11px">${esc(place)}</div>
        <div style="margin-top:4px;font-size:12px">${g.rows.length}건 · <b>${fmtNum(g.qty)} MT</b>${transit ? ` · <span style="color:${COLOR_TRANSIT};font-weight:700">이동 중 ${g.transit}건</span>` : ""}</div>
        ${last ? `<div style="color:#64748b;font-size:11px">최근: ${esc(fmtDate(last.contract_date))} ${esc(last.material_name)}</div>` : ""}
        <div style="color:#94a3b8;font-size:10px;margin-top:2px">클릭하면 전체 기록 보기</div>
      </div>`;
      L.circleMarker([g.lat, g.lng], {
        radius: r,
        color: sel ? COLOR_DEST : "#fff",
        weight: sel ? 3 : 2,
        fillColor: transit ? COLOR_TRANSIT : COLOR_DONE,
        fillOpacity: selectedKey && !sel ? 0.45 : 0.88,
        bubblingMouseEvents: false,
      })
        .bindTooltip(tip, { direction: "top", offset: [0, -r], opacity: 1 })
        .on("click", () => onSelectRef.current(g.key))
        .addTo(layer);
    }

    if (!fittedRef.current && groups.length > 0) {
      fittedRef.current = true;
      fitTo();
    }
  }, [groups, dest, selectedKey]);

  // 선택하면 그 위치로 부드럽게 이동
  useEffect(() => {
    const map = mapRef.current;
    const g = groups.find((x) => x.key === selectedKey);
    if (map && g && !map.getBounds().pad(-0.15).contains([g.lat, g.lng])) map.panTo([g.lat, g.lng]);
  }, [selectedKey]);

  return (
    <div className="relative isolate">
      <style>{`
        .orca-flow { animation: orca-flow-dash 1.2s linear infinite; }
        @keyframes orca-flow-dash { to { stroke-dashoffset: -16; } }
        @media (prefers-reduced-motion: reduce) { .orca-flow { animation: none; } }
        .orca-map-label { background: rgba(255,255,255,.92); border: 0; box-shadow: 0 1px 3px rgba(0,0,0,.15); font-size: 11px; padding: 2px 6px; }
        .orca-map-label::before { display: none; }
      `}</style>
      <div ref={elRef} className="h-[420px] w-full sm:h-[600px]" />
      <div className="absolute bottom-3 left-3 z-[1000] rounded-lg bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow">
        <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_TRANSIT }} /> 이동 중인 건 있음 (선적~통관)</div>
        <div className="mt-1 flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_DONE }} /> 계약 / 도착 이후</div>
        <div className="mt-1 flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_DEST }} /> 한국 도착항</div>
        <div className="mt-1 text-slate-400">원 크기 · 선 굵기 = 물량</div>
      </div>
      <div className="absolute right-3 top-3 z-[1000] flex items-center gap-2">
        <button className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow hover:bg-slate-50"
          onClick={() => { onSelect(null); fitTo(); }}>
          전체 보기
        </button>
        <div className="flex overflow-hidden rounded-md bg-white text-xs font-semibold shadow">
          {(Object.keys(BASEMAPS) as BaseKey[]).map((k) => (
            <button key={k} onClick={() => setBase(k)}
              className={`px-2.5 py-1 ${base === k ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
          <div className="rounded-lg bg-white/95 px-4 py-3 text-center text-sm text-slate-500 shadow">
            지도에 표시할 건이 없습니다.<br />
            <span className="text-xs">오른쪽 위 "공급사 위치 관리"에서 공급사 위치를 등록해 주세요.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Overview({ byCountry, bySupplier, onCountry, onSupplier }: {
  byCountry: { country: string; qty: number; count: number; keys: Set<string> }[];
  bySupplier: { supplier: string; qty: number; count: number; key: string | null; place: string }[];
  onCountry: (keys: Set<string>) => void;
  onSupplier: (s: { supplier: string; key: string | null }) => void;
}) {
  const maxC = Math.max(1, ...byCountry.map((c) => c.qty));
  return (
    <div className="overflow-y-auto p-4">
      <div className="mb-1 text-sm font-bold text-primary">국가별 수입 물량</div>
      <div className="mb-3 text-[11px] text-slate-400">지도의 원에 마우스를 올리거나 클릭하면 상세 기록을 볼 수 있어요</div>
      {byCountry.length === 0 && <div className="py-4 text-xs text-slate-400">위치가 등록된 공급사의 수입 건이 없습니다</div>}
      <div className="space-y-2">
        {byCountry.map((c) => (
          <button key={c.country} className="group block w-full text-left" onClick={() => onCountry(c.keys)} title="클릭하면 지도에서 해당 국가로 이동">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-slate-700 group-hover:text-brand-700">{c.country}</span>
              <span className="text-slate-500">{fmtNum(c.qty)} MT · {c.count}건</span>
            </div>
            <div className="mt-1 h-2 w-full rounded bg-slate-100">
              <div className="h-2 rounded" style={{ width: `${Math.max(2, (c.qty / maxC) * 100)}%`, background: COLOR_DONE }} />
            </div>
          </button>
        ))}
      </div>

      <div className="mb-2 mt-6 text-sm font-bold text-primary">공급사별 수입 물량</div>
      <table className="w-full text-xs">
        <tbody>
          {bySupplier.map((s, i) => (
            <tr key={s.supplier} className="cursor-pointer border-t border-slate-50 hover:bg-brand-50" onClick={() => onSupplier(s)}>
              <td className="w-5 py-1.5 text-slate-400">{i + 1}</td>
              <td className="py-1.5">
                <div className="font-semibold text-slate-700">{s.supplier}</div>
                <div className={`text-[11px] ${s.key ? "text-slate-400" : "text-amber-600"}`}>{s.place}</div>
              </td>
              <td className="whitespace-nowrap py-1.5 text-right text-slate-600">{fmtNum(s.qty)} MT<div className="text-[11px] text-slate-400">{s.count}건</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LocationDetail({ g, onClose, onEdit }: { g: Group; onClose: () => void; onEdit: (supplier: string) => void }) {
  const multi = g.suppliers.length > 1;
  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] text-slate-500"><Icon name="location_on" size={14} />{[g.country, g.region].filter(Boolean).join(" · ") || "위치"}</div>
          <div className="text-base font-bold text-primary">{g.suppliers.join(", ")}</div>
        </div>
        <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" onClick={onClose} title="닫기 (전체 현황으로)">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-slate-100 px-4 py-3 text-xs">
        <div><div className="text-slate-400">수입 건수</div><div className="font-bold text-slate-700">{g.rows.length}건</div></div>
        <div><div className="text-slate-400">총 물량</div><div className="font-bold text-slate-700">{fmtNum(g.qty)} MT</div></div>
        <div className="col-span-2"><div className="text-slate-400">총 금액</div><div className="font-bold text-slate-700">{moneyText(g.rows)}</div></div>
        {g.transit > 0 && <div className="col-span-2 font-semibold text-amber-700">🚢 지금 이동 중인 건 {g.transit}건</div>}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold">계약일</th>
              <th className="px-2 py-1.5 text-left font-semibold">원료{multi ? " · 공급사" : ""}</th>
              <th className="px-2 py-1.5 text-right font-semibold">물량</th>
              <th className="px-3 py-1.5 text-left font-semibold">상태</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-50 align-top">
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{fmtDate(r.contract_date)}</td>
                <td className="px-2 py-1.5">
                  <div className="font-semibold text-slate-700">{r.material_name}</div>
                  {multi && <div className="text-[11px] text-slate-400">{r.supplier}</div>}
                  <div className="text-[11px] text-slate-400">
                    {r.unit_price != null ? `${r.currency || "USD"} ${fmtNum(Number(r.unit_price))}/MT` : ""}
                    {(r.etd || r.eta) && ` · ETD ${fmtDate(r.etd)} → ETA ${fmtDate(r.eta)}`}
                  </div>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-slate-700">{r.quantity != null ? `${fmtNum(Number(r.quantity))} ${r.unit || "MT"}` : "-"}</td>
                <td className="px-3 py-1.5"><StatusPill status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs">
        <Link to="/imports" className="font-semibold text-brand-700 hover:underline">원료 수입현황에서 보기 →</Link>
        <button className="text-slate-500 hover:underline" onClick={() => onEdit(g.suppliers[0])}>위치 수정</button>
      </div>
    </>
  );
}

// 월별 수입 물량 (계약일 기준) — 한 가지 값만 보여주는 막대그래프
function MonthlyChart({ rows, year }: { rows: any[]; year: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const months = useMemo(() => {
    const list: { ym: string; label: string }[] = [];
    if (year) {
      for (let m = 1; m <= 12; m++) list.push({ ym: `${year}-${String(m).padStart(2, "0")}`, label: `${m}월` });
    } else {
      const now = new Date();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        list.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: `${d.getMonth() + 1}월` });
      }
    }
    return list.map((m) => {
      const rs = rows.filter((r) => String(r.contract_date || "").startsWith(m.ym));
      return { ...m, qty: rs.reduce((a, r) => a + (Number(r.quantity) || 0), 0), count: rs.length };
    });
  }, [rows, year]);
  const max = Math.max(1, ...months.map((m) => m.qty));
  const total = months.reduce((a, m) => a + m.qty, 0);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-bold text-primary">월별 수입 물량 <span className="text-xs font-normal text-slate-400">(계약일 기준{year ? `, ${year}년` : ", 최근 12개월"})</span></div>
        <div className="text-xs text-slate-500">합계 {fmtNum(total)} MT</div>
      </div>
      <div className="relative mt-4 flex h-44 items-end gap-[2px] border-b border-slate-200">
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-slate-100" />
        <div className="pointer-events-none absolute -top-4 right-0 text-[10px] text-slate-400">{fmtNum(max)} MT</div>
        {months.map((m, i) => (
          <div key={m.ym} className="relative flex h-full flex-1 items-end justify-center"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="w-full max-w-[28px] rounded-t transition-opacity"
              style={{ height: `${(m.qty / max) * 100}%`, minHeight: m.qty > 0 ? 2 : 0, background: COLOR_DONE, opacity: hover === null || hover === i ? 1 : 0.45 }} />
            {hover === i && (
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded bg-primary px-2 py-1 text-[11px] text-white shadow">
                {m.ym.replace("-", "년 ")}월 · <b>{fmtNum(m.qty)} MT</b> · {m.count}건
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {months.map((m) => <div key={m.ym} className="flex-1 text-center text-[10px] text-slate-400">{m.label}</div>)}
      </div>
    </div>
  );
}

// ───────────────────────── 공급사 위치 관리 ─────────────────────────
function LocationManager({ open, focus, onClose, imports, locs, dest, onSaved }: {
  open: boolean; focus: string | null; onClose: () => void; imports: any[]; locs: any[]; dest: any; onSaved: () => void;
}) {
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [destName, setDestName] = useState(dest?.name || "");

  const suppliers = useMemo(() => {
    const m = new Map<string, { supplier: string; count: number; loc: any }>();
    for (const l of locs) m.set(l.supplier_key || normKey(l.supplier), { supplier: l.supplier, count: 0, loc: l });
    for (const r of imports) {
      if (!r.supplier) continue;
      const k = normKey(r.supplier);
      const e = m.get(k) || { supplier: r.supplier.trim(), count: 0, loc: null };
      e.count++;
      m.set(k, e);
    }
    // 위치 미등록 먼저, 그다음 이름순
    return Array.from(m.values()).sort((a, b) => (a.loc ? 1 : 0) - (b.loc ? 1 : 0) || a.supplier.localeCompare(b.supplier));
  }, [imports, locs]);

  function startEdit(s: { supplier: string; loc: any }) {
    setEditing({
      supplier: s.supplier,
      country: s.loc?.country || "",
      region: s.loc?.region || "",
      lat: s.loc?.lat ?? "",
      lng: s.loc?.lng ?? "",
      note: s.loc?.note || "",
    });
  }

  useEffect(() => {
    if (!open) { setEditing(null); return; }
    setDestName(dest?.name || "");
    if (focus) {
      const s = suppliers.find((x) => normKey(x.supplier) === normKey(focus));
      startEdit(s || { supplier: focus, loc: null });
    }
  }, [open, focus]);

  async function saveSupplier() {
    if (!editing) return;
    if (editing.lat === "" || editing.lng === "") { alert("항구를 고르거나 지도에서 위치를 클릭해 주세요"); return; }
    setSaving(true);
    try {
      await api.put("/geo/suppliers", editing);
      onSaved();
      setEditing(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function removeLoc(l: any) {
    if (!confirm(`${l.supplier}의 위치 정보를 삭제할까요? (수입 기록은 그대로 남습니다)`)) return;
    await api.del(`/geo/suppliers/${l.id}`);
    onSaved();
  }
  async function saveDest(name: string) {
    const p = KOREA_PORTS.find((x) => x.name === name);
    if (!p) return;
    setDestName(name);
    await api.put("/geo/dest", { name: p.name, country: p.country, lat: p.lat, lng: p.lng });
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="공급사 위치 관리" wide>
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <Icon name="anchor" size={18} />
        <span className="font-semibold text-slate-700">한국 도착항</span>
        <select className="input w-auto py-1 text-sm" value={destName} onChange={(e) => saveDest(e.target.value)}>
          {!KOREA_PORTS.some((p) => p.name === destName) && <option value={destName}>{destName}</option>}
          {KOREA_PORTS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <span className="text-xs text-slate-400">지도에서 선이 이어지는 도착 지점이에요</span>
      </div>

      {editing ? (
        <SupplierEditor value={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={saveSupplier} saving={saving} />
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-2 text-left font-semibold">공급사</th>
                <th className="py-2 text-left font-semibold">위치</th>
                <th className="py-2 text-right font-semibold">수입 건수</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.supplier} className="border-b border-slate-50">
                  <td className="py-2 font-semibold text-slate-700">{s.supplier}</td>
                  <td className="py-2 text-xs">
                    {s.loc ? <span className="text-slate-600">{[s.loc.country, s.loc.region].filter(Boolean).join(" · ") || `${s.loc.lat}, ${s.loc.lng}`}</span>
                      : <span className="font-semibold text-amber-600">미등록</span>}
                  </td>
                  <td className="py-2 text-right text-xs text-slate-500">{s.count}건</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right text-xs">
                    <button className="font-semibold text-brand-700 hover:underline" onClick={() => startEdit(s)}>{s.loc ? "수정" : "위치 지정"}</button>
                    {s.loc && <button className="ml-3 text-slate-400 hover:text-red-500" onClick={() => removeLoc(s.loc)}>삭제</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suppliers.length === 0 && <div className="py-8 text-center text-sm text-slate-400">원료 수입현황에 등록된 공급사가 없습니다</div>}
        </div>
      )}
    </Modal>
  );
}

function SupplierEditor({ value, onChange, onCancel, onSave, saving }: {
  value: any; onChange: (v: any) => void; onCancel: () => void; onSave: () => void; saving: boolean;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  const presetIdx = PORT_PRESETS.findIndex((p) => Number(value.lat) === p.lat && Number(value.lng) === p.lng);

  return (
    <div>
      <div className="mb-3 text-base font-bold text-primary">{value.supplier} <span className="text-sm font-normal text-slate-500">위치 지정</span></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500 sm:col-span-2">주요 항구에서 고르기
          <select className="input mt-1 text-sm" value={presetIdx >= 0 ? String(presetIdx) : ""}
            onChange={(e) => {
              const p = PORT_PRESETS[Number(e.target.value)];
              if (p) onChange({ ...value, country: p.country, region: p.name, lat: p.lat, lng: p.lng });
            }}>
            <option value="">— 목록에 없으면 아래 지도에서 직접 클릭 —</option>
            {PRESET_COUNTRIES.map((c) => (
              <optgroup key={c} label={c}>
                {PORT_PRESETS.map((p, i) => p.country === c ? <option key={i} value={i}>{p.name}</option> : null)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">나라
          <input className="input mt-1 text-sm" value={value.country} onChange={(e) => set("country", e.target.value)} placeholder="예: 인도" />
        </label>
        <label className="text-xs text-slate-500">지역 / 항구
          <input className="input mt-1 text-sm" value={value.region} onChange={(e) => set("region", e.target.value)} placeholder="예: Mundra (문드라)" />
        </label>
      </div>
      <div className="mt-3 text-xs text-slate-500">
        지도를 클릭하면 그 위치로 지정돼요
        {value.lat !== "" && <span className="ml-2 text-slate-400">(현재: {Number(value.lat).toFixed(3)}, {Number(value.lng).toFixed(3)})</span>}
      </div>
      <LocationPicker lat={value.lat === "" ? null : Number(value.lat)} lng={value.lng === "" ? null : Number(value.lng)}
        onPick={(lat, lng) => onChange({ ...value, lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) })} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel}>목록으로</button>
        <button className="btn-primary" onClick={onSave} disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
      </div>
    </div>
  );
}

function LocationPicker({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (lat: number, lng: number) => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, { center: lat != null && lng != null ? [lat, wrapLng(lng)] : [20, 100], zoom: lat != null ? 5 : 2, minZoom: 2 });
    makeBaseLayer("street").addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      const p = e.latlng.wrap();
      onPickRef.current(p.lat, p.lng);
    });
    mapRef.current = map;
    // 모달이 열리는 중에는 크기 계산이 틀어질 수 있어서 한 번 더 맞춰준다
    const t = setTimeout(() => map.invalidateSize(), 150);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat == null || lng == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const pt: [number, number] = [lat, wrapLng(lng)];
    if (!markerRef.current) {
      markerRef.current = L.circleMarker(pt, { radius: 8, color: "#fff", weight: 2, fillColor: COLOR_TRANSIT, fillOpacity: 1 }).addTo(map);
    } else {
      markerRef.current.setLatLng(pt);
    }
    if (!map.getBounds().contains(pt)) map.setView(pt, Math.max(map.getZoom(), 5));
  }, [lat, lng]);

  return (
    <div className="relative isolate mt-1 overflow-hidden rounded-lg border border-slate-200">
      <div ref={elRef} className="h-72 w-full cursor-crosshair" />
    </div>
  );
}
