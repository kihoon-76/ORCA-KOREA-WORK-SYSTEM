import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon } from "./ui";
import { AttachmentPanel, QualityPanel, PriceCalcPanel } from "../pages/TradeModule";

// 수입 건 상세 팝업 — 화면 가운데 중간 크기.
//  맨 위: 품목·진행상황·공급사/물량/바이어 → 일정(ETD→ETA) → 서류 3칸(바로 보임)
//  아래 작은 탭: 거래 정보 · 메모 · 진행상황 · 품질규격 · 원가계산 (누를 때만 펼침)
//  ◀ 이전 / 다음 ▶ 으로 창을 닫지 않고 날짜순으로 다른 일정을 넘겨 본다.

const STAGES = [
  { v: "contracted", l: "계약" }, { v: "shipped", l: "선적" }, { v: "customs", l: "통관" }, { v: "stored", l: "입고" },
  { v: "processed", l: "가공" }, { v: "released", l: "출고" }, { v: "settled", l: "정산" },
];
const LEGACY: Record<string, number> = { arrived: 1, cleared: 3, melt_in: 4, melt_out: 4, delivered: 6, done: 6 };
const stageIdx = (s: string) => { const i = STAGES.findIndex((x) => x.v === s); return i >= 0 ? i : LEGACY[s] ?? 0; };
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const d10 = (v: any) => (v ? String(v).slice(0, 10) : "");
function md(v?: string | null) {
  if (!v) return "-";
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return String(v);
  return `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}
function fmt(n: any) {
  if (n == null || n === "") return "-";
  const v = Number(n);
  return Number.isFinite(v) ? (Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : String(n);
}

const EDIT_FIELDS: { k: string; l: string; type?: string; opts?: string[] }[] = [
  { k: "contract_date", l: "계약일", type: "date" },
  { k: "material_name", l: "원료명" },
  { k: "supplier", l: "공급사(Seller)" },
  { k: "lc_bank", l: "구매자(Buyer)" },
  { k: "quantity", l: "물량", type: "number" },
  { k: "unit", l: "단위", opts: ["MT", "KG"] },
  { k: "currency", l: "통화", opts: ["USD", "KRW", "EUR", "CNY"] },
  { k: "unit_price", l: "단가", type: "number" },
  { k: "incoterms", l: "Incoterms", opts: ["", "FOB", "CFR", "CIF"] },
  { k: "payment_type", l: "결제", opts: ["", "LC", "TT"] },
  { k: "vessel", l: "선박명" },
  { k: "bl_no", l: "BL번호" },
  { k: "lc_no", l: "LC번호" },
];

type Tab = "" | "info" | "note" | "stage" | "quality" | "price";

export default function ImportDrawer({ row, list, onNavigate, onClose, onUpdated, onLocate }: {
  row: any;
  list?: any[];                       // 이전/다음으로 넘겨 볼 순서 (날짜순)
  onNavigate?: (row: any) => void;
  onClose: () => void;
  onUpdated: (item: any) => void;
  onLocate?: () => void;
  variant?: string;                   // (예전 호환용, 쓰지 않음)
}) {
  const [r, setR] = useState<any>(row);
  useEffect(() => setR(row), [row]);
  const [tab, setTab] = useState<Tab>("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [etd, setEtd] = useState(d10(row.etd));
  const [eta, setEta] = useState(d10(row.eta));
  const [note, setNote] = useState(row.note || "");
  const [busy, setBusy] = useState(false);
  const [qualityDraft, setQualityDraft] = useState<Record<string, string> | undefined>(undefined);

  useEffect(() => { setEditing(false); setQualityDraft(undefined); }, [row.id]);
  useEffect(() => { setEtd(d10(r.etd)); setEta(d10(r.eta)); setNote(r.note || ""); }, [r.id, r.etd, r.eta, r.note]);

  const idx = list ? list.findIndex((x) => x.id === r.id) : -1;
  const prev = idx > 0 ? list![idx - 1] : null;
  const next = idx >= 0 && idx < (list?.length ?? 0) - 1 ? list![idx + 1] : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if (e.key === "Escape") onClose();
      else if (!typing && e.key === "ArrowLeft" && prev && onNavigate) onNavigate(prev);
      else if (!typing && e.key === "ArrowRight" && next && onNavigate) onNavigate(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, prev, next]);

  async function put(patch: any) {
    setBusy(true);
    try {
      const res = await api.put(`/trade/imports/${r.id}`, patch);
      setR(res.item);
      onUpdated(res.item);
      return true;
    } catch (e: any) {
      alert(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function setStage(v: string) {
    if (v === r.status) return;
    if (v === "stored") {
      if (!confirm(`${r.material_name} ${r.quantity ?? ""}${r.unit || ""} 을(를) 재고에 입고 처리할까요?`)) return;
      try {
        await api.post(`/trade/imports/${r.id}/receive`, {});
        const fresh = await api.get(`/trade/imports/${r.id}`);
        setR(fresh.item);
        onUpdated(fresh.item);
      } catch (e: any) { alert(e.message); }
      return;
    }
    await put({ status: v });
  }
  async function saveDates() {
    if (etd && eta && eta < etd && !confirm("ETA(도착)가 ETD(출항)보다 빠릅니다. 그래도 저장할까요?")) return;
    await put({ etd: etd || null, eta: eta || null });
  }
  function startEdit() {
    const f: any = {};
    for (const x of EDIT_FIELDS) f[x.k] = x.type === "date" ? d10(r[x.k]) : r[x.k] ?? "";
    setForm(f);
    setEditing(true);
  }
  async function saveEdit() {
    const patch: any = {};
    for (const x of EDIT_FIELDS) {
      let v = form[x.k];
      if (x.type === "number") v = v === "" || v == null ? null : Number(String(v).replace(/,/g, ""));
      else v = v === "" ? null : v;
      const old = x.type === "date" ? d10(r[x.k]) || null : r[x.k] ?? null;
      if (String(v ?? "") !== String(old ?? "")) patch[x.k] = v;
    }
    if ("quantity" in patch || "unit_price" in patch) {
      const q = "quantity" in patch ? patch.quantity : r.quantity;
      const p = "unit_price" in patch ? patch.unit_price : r.unit_price;
      patch.total_price = q != null && p != null ? Number(q) * Number(p) : null;
    }
    if (Object.keys(patch).length === 0) { setEditing(false); return; }
    if (await put(patch)) setEditing(false);
  }

  const si = stageIdx(r.status);
  const total = r.total_price != null ? Number(r.total_price) : r.quantity != null && r.unit_price != null ? Number(r.quantity) * Number(r.unit_price) : null;
  const todayMs = new Date(new Date().toDateString()).getTime();
  const dday = eta ? Math.round((new Date(eta).getTime() - todayMs) / 86400000) : null;
  const sail = etd && eta && eta >= etd ? Math.round((new Date(eta).getTime() - new Date(etd).getTime()) / 86400000) : null;
  const datesChanged = etd !== d10(r.etd) || eta !== d10(r.eta);

  const info: [string, any][] = [
    ["계약일", md(r.contract_date)], ["구매자(Buyer)", r.lc_bank || "-"],
    ["단가", r.unit_price != null ? `${r.currency || "USD"} ${fmt(r.unit_price)}` : "-"], ["총액", total != null ? `${r.currency || "USD"} ${fmt(total)}` : "-"],
    ["Incoterms · 결제", [r.incoterms, r.payment_type].filter(Boolean).join(" · ") || "-"], ["선박명", r.vessel || "-"],
    ["BL번호", r.bl_no || "-"], ["LC번호", r.lc_no || "-"],
  ];
  const tabs: [Tab, string][] = [["info", "📋 거래 정보"], ["note", "📝 메모"], ["stage", "📊 진행상황"], ["quality", "🧪 품질규격"], ["price", "💰 원가계산"]];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary/40 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className="card my-4 w-full max-w-4xl rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 머리: 이전/다음 + 품목 */}
        <div className="flex items-center gap-2 border-b border-outline-variant px-4 py-3">
          {list && (
            <button className="flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-30"
              disabled={!prev} onClick={() => prev && onNavigate?.(prev)} title={prev ? `${prev.material_name} (←)` : ""}>
              <Icon name="chevron_left" size={18} /> 이전
            </button>
          )}
          <div className="min-w-0 flex-1 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="shrink-0 rounded-full bg-secondary-fixed px-2 py-0.5 text-[11px] font-bold text-on-secondary-container">{STAGES[si]?.l || r.status}</span>
              <h2 className="truncate text-lg font-bold text-primary">{r.material_name}</h2>
            </div>
            <div className="truncate text-xs text-on-surface-variant">
              {r.supplier || "-"} · {r.quantity != null ? `${fmt(r.quantity)} ${r.unit || "MT"}` : "-"}
              {total != null ? ` · ${r.currency || "USD"} ${fmt(total)}` : ""}{r.lc_bank ? ` · 바이어 ${r.lc_bank}` : ""}
            </div>
          </div>
          {list && (
            <button className="flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-30"
              disabled={!next} onClick={() => next && onNavigate?.(next)} title={next ? `${next.material_name} (→)` : ""}>
              다음 <Icon name="chevron_right" size={18} />
            </button>
          )}
          <button className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-surface-container" onClick={onClose} title="닫기 (Esc)"><Icon name="close" size={18} /></button>
        </div>

        <div className="space-y-3 p-4">
          {/* 일정 한 줄 */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-sm">
            <span className="text-xs text-on-surface-variant">ETD</span>
            <input type="date" className="input w-40 py-1 text-sm" value={etd} onChange={(e) => setEtd(e.target.value)} />
            <span className="text-on-surface-variant">→</span>
            <span className="text-xs text-on-surface-variant">ETA</span>
            <input type="date" className="input w-40 py-1 text-sm" value={eta} onChange={(e) => setEta(e.target.value)} />
            {datesChanged && <button className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={saveDates}>날짜 저장</button>}
            <span className="ml-auto flex gap-3 text-xs">
              {sail != null && <span className="text-on-surface-variant">항해 <b className="text-on-surface">{sail}일</b></span>}
              {dday != null && <b className={dday >= 0 && dday <= 3 ? "text-amber-700" : "text-on-surface"}>{dday > 0 ? `D-${dday}` : dday === 0 ? "오늘 도착" : `도착 후 ${-dday}일`}</b>}
            </span>
          </div>

          {/* 서류 3칸 — 바로 보임 */}
          <div className="grid gap-3 md:grid-cols-3">
            <AttachmentPanel entityType="import" entityId={r.id} category="contract" label="📄 계약서" />
            <AttachmentPanel entityType="import" entityId={r.id} category="shipping_docs" label="🚢 선적서류" />
            <AttachmentPanel entityType="import" entityId={r.id} category="settlement" label="💰 정산서류" />
          </div>

          {/* 작은 탭 — 누를 때만 펼침 */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-outline-variant pt-3">
            {tabs.map(([k, l]) => (
              <button key={k} onClick={() => setTab((t) => (t === k ? "" : k))}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${tab === k ? "border-primary bg-primary text-white" : "border-outline-variant bg-white text-on-surface-variant hover:bg-surface-container-low"}`}>
                {l}{k === "note" && r.note ? " ✓" : ""}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-3 text-xs">
              {onLocate && <button className="font-semibold text-secondary hover:underline" onClick={onLocate}>📍 지도에서 보기</button>}
              <Link to="/imports" className="font-semibold text-secondary hover:underline">원료 수입현황 →</Link>
            </span>
          </div>

          {tab === "info" && (
            <div className="rounded-lg border border-outline-variant p-3">
              {!editing ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    {info.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <div className="text-[11px] text-on-surface-variant">{label}</div>
                        <div className="truncate text-sm font-semibold text-on-surface" title={String(value)}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <button className="mt-2 text-xs font-semibold text-secondary hover:underline" onClick={startEdit}>✏️ 수정</button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {EDIT_FIELDS.map((x) => (
                      <label key={x.k} className="text-[11px] text-on-surface-variant">{x.l}
                        {x.opts ? (
                          <select className="input mt-0.5 py-1 text-sm" value={form[x.k] ?? ""} onChange={(e) => setForm({ ...form, [x.k]: e.target.value })}>
                            {x.opts.map((o) => <option key={o} value={o}>{o || "-"}</option>)}
                            {form[x.k] && !x.opts.includes(form[x.k]) && <option value={form[x.k]}>{form[x.k]}</option>}
                          </select>
                        ) : (
                          <input type={x.type === "date" ? "date" : "text"} inputMode={x.type === "number" ? "decimal" : undefined}
                            className="input mt-0.5 py-1 text-sm" value={form[x.k] ?? ""} onChange={(e) => setForm({ ...form, [x.k]: e.target.value })} />
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <button className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing(false)}>취소</button>
                    <button className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={saveEdit}>저장</button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "note" && (
            <div className="rounded-lg border border-outline-variant p-3">
              <textarea className="input min-h-[72px] text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="이 건에 대한 메모" />
              {note !== (r.note || "") && <div className="mt-2 text-right"><button className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => put({ note: note || null })}>메모 저장</button></div>}
            </div>
          )}

          {tab === "stage" && (
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-outline-variant p-3">
              {STAGES.map((s, i) => (
                <Fragment key={s.v}>
                  <button disabled={busy} onClick={() => setStage(s.v)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${i === si ? "bg-primary text-white" : i < si ? "bg-secondary-fixed text-on-secondary-container" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}`}>{s.l}</button>
                  {i < STAGES.length - 1 && <span className={`h-0.5 w-3 ${i < si ? "bg-secondary-fixed-dim" : "bg-outline-variant"}`} />}
                </Fragment>
              ))}
              <span className="ml-auto text-[11px] text-on-surface-variant">단계를 누르면 바로 바뀌어요</span>
            </div>
          )}

          {tab === "quality" && <QualityPanel entityType="import" entityId={r.id} draft={qualityDraft} onDraftChange={setQualityDraft} />}
          {tab === "price" && (
            <PriceCalcPanel entityType="import" entityId={r.id} defaultProduct={r.material_name} defaultQuantity={r.quantity}
              defaultShipper={r.supplier} defaultIncoterms={r.incoterms} defaultContractPrice={r.unit_price} qualityDraft={qualityDraft} />
          )}

          {list && idx >= 0 && <p className="text-center text-[11px] text-on-surface-variant">{idx + 1} / {list.length} · 키보드 ← → 로도 넘길 수 있어요</p>}
        </div>
      </div>
    </div>
  );
}
