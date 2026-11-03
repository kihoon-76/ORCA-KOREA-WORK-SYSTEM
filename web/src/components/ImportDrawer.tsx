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

// 한눈에 보기 칸 (바로 수정)
const QUICK_KEYS = ["supplier", "lc_bank", "quantity", "unit", "unit_price", "currency", "incoterms", "payment_type", "etd", "eta", "bl_no"];
function quickFrom(r: any) {
  return {
    supplier: r.supplier ?? "", lc_bank: r.lc_bank ?? "",
    quantity: r.quantity != null ? String(r.quantity) : "", unit: r.unit || "MT",
    unit_price: r.unit_price != null ? String(r.unit_price) : "", currency: r.currency || "USD",
    incoterms: r.incoterms ?? "", payment_type: r.payment_type ?? "",
    etd: d10(r.etd), eta: d10(r.eta), bl_no: r.bl_no ?? "",
  } as Record<string, string>;
}
// 폭을 따로 주는 칸(단위·통화 선택)은 QBOX, 나머지는 꽉 차게 QIN
const QBOX = "rounded-md border border-outline-variant/60 bg-white px-2 py-1 text-sm font-semibold text-on-surface hover:border-outline focus:border-primary focus:outline-none";
const QIN = `w-full ${QBOX}`;
// 큰 화면(lg)에서 12칸 기준으로 몇 칸 차지할지
const LG_SPAN: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" };
function QF({ label, changed, span = 2, children }: { label: string; changed?: boolean; span?: number; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${LG_SPAN[span] || ""}`}>
      <span className={`mb-0.5 block text-[11px] ${changed ? "font-bold text-amber-800" : "text-on-surface-variant"}`}>{label}{changed ? " •" : ""}</span>
      {children}
    </label>
  );
}

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
  const [q, setQ] = useState<any>(() => quickFrom(row));
  const setQf = (k: string, v: any) => setQ((p: any) => ({ ...p, [k]: v }));
  const [note, setNote] = useState(row.note || "");
  const [busy, setBusy] = useState(false);
  const [qualityDraft, setQualityDraft] = useState<Record<string, string> | undefined>(undefined);

  useEffect(() => { setEditing(false); setQualityDraft(undefined); }, [row.id]);
  useEffect(() => { setQ(quickFrom(r)); setNote(r.note || ""); }, [r]);

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
  // 한눈에 보기 칸에서 바꾼 것만 저장
  const base = quickFrom(r);
  const changedKeys = QUICK_KEYS.filter((k) => String(q[k] ?? "").trim() !== String(base[k] ?? "").trim());
  async function saveQuick() {
    if (q.etd && q.eta && q.eta < q.etd && !confirm("ETA(도착)가 ETD(출항)보다 빠릅니다. 그래도 저장할까요?")) return;
    const patch: any = {};
    for (const k of changedKeys) {
      const v = String(q[k] ?? "").trim();
      patch[k] = k === "quantity" || k === "unit_price" ? (v === "" ? null : Number(v.replace(/,/g, ""))) : v || null;
    }
    if ("quantity" in patch || "unit_price" in patch) {
      const qq = "quantity" in patch ? patch.quantity : r.quantity;
      const pp = "unit_price" in patch ? patch.unit_price : r.unit_price;
      patch.total_price = qq != null && pp != null ? Number(qq) * Number(pp) : null;
    }
    await put(patch);
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
  const etd = q.etd, eta = q.eta;
  const dday = eta ? Math.round((new Date(eta).getTime() - todayMs) / 86400000) : null;
  const sail = etd && eta && eta >= etd ? Math.round((new Date(eta).getTime() - new Date(etd).getTime()) / 86400000) : null;
  const qQty = Number(String(q.quantity).replace(/,/g, "")), qPrice = Number(String(q.unit_price).replace(/,/g, ""));
  const qTotal = q.quantity !== "" && q.unit_price !== "" && Number.isFinite(qQty) && Number.isFinite(qPrice) ? qQty * qPrice : null;

  const info: [string, any][] = [
    ["계약일", md(r.contract_date)], ["구매자(Buyer)", r.lc_bank || "-"],
    ["단가", r.unit_price != null ? `${r.currency || "USD"} ${fmt(r.unit_price)}` : "-"], ["총액", total != null ? `${r.currency || "USD"} ${fmt(total)}` : "-"],
    ["Incoterms · 결제", [r.incoterms, r.payment_type].filter(Boolean).join(" · ") || "-"], ["선박명", r.vessel || "-"],
    ["BL번호", r.bl_no || "-"], ["LC번호", r.lc_no || "-"],
  ];
  const tabs: [Tab, string][] = [["info", "📋 거래 정보"], ["note", "📝 메모"], ["stage", "📊 진행상황"], ["quality", "🧪 품질규격"], ["price", "💰 원가계산"]];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary/40 p-4 backdrop-blur-sm sm:p-8" onClick={onClose}>
      <div className="card my-4 w-full max-w-5xl rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
              계약 {md(r.contract_date)}{r.vessel ? ` · 선박 ${r.vessel}` : ""}{r.lc_no ? ` · LC ${r.lc_no}` : ""}
            </div>
          </div>
          {list && (
            <button className="flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-30"
              disabled={!next} onClick={() => next && onNavigate?.(next)} title={next ? `${next.material_name} (→)` : ""}>
              다음 <Icon name="chevron_right" size={18} />
            </button>
          )}
          <button className={`ml-1 flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold ${editing ? "border-primary bg-primary text-white" : "border-outline-variant text-primary hover:bg-surface-container"}`}
            onClick={() => (editing ? setEditing(false) : startEdit())} title="품목명·수량·단가 등 정보 수정">
            <Icon name="edit" size={16} /> {editing ? "수정 중" : "정보 수정"}
          </button>
          <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-surface-container" onClick={onClose} title="닫기 (Esc)"><Icon name="close" size={18} /></button>
        </div>

        <div className="space-y-3 p-4">
          {/* 정보 수정 — 머리의 "정보 수정"을 누르면 맨 위에 열림 */}
          {editing && (
            <div className="rounded-lg border-2 border-primary/30 bg-primary-fixed/20 p-3">
              <div className="mb-2 text-xs font-bold text-primary">✏️ 정보 수정 <span className="font-normal text-on-surface-variant">— 고친 뒤 저장을 누르면 원료 수입현황에도 바로 반영돼요</span></div>
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
            </div>
          )}

          {/* 핵심 정보 — 한눈에 보고 바로 고치기 (바꾸면 저장 버튼이 나타남) */}
          <div className={`rounded-lg p-3 ${changedKeys.length ? "bg-amber-50 ring-1 ring-amber-300" : "bg-surface-container-low"}`}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4 lg:grid-cols-12">
              <QF label="공급사(Seller)" changed={changedKeys.includes("supplier")}>
                <input className={QIN} value={q.supplier} onChange={(e) => setQf("supplier", e.target.value)} />
              </QF>
              <QF label="구매자(Buyer)" changed={changedKeys.includes("lc_bank")}>
                <input className={QIN} value={q.lc_bank} onChange={(e) => setQf("lc_bank", e.target.value)} />
              </QF>
              <QF label="물량" changed={changedKeys.includes("quantity") || changedKeys.includes("unit")}>
                <div className="flex gap-1">
                  <input className={`${QBOX} min-w-0 flex-1 text-right`} inputMode="decimal" value={q.quantity} onChange={(e) => setQf("quantity", e.target.value)} />
                  <select className={`${QBOX} w-[60px] shrink-0 px-1`} value={q.unit} onChange={(e) => setQf("unit", e.target.value)}>
                    {["MT", "KG"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </QF>
              <QF label="단가" changed={changedKeys.includes("unit_price") || changedKeys.includes("currency")}>
                <div className="flex gap-1">
                  <select className={`${QBOX} w-[72px] shrink-0 px-1`} value={q.currency} onChange={(e) => setQf("currency", e.target.value)}>
                    {["USD", "KRW", "EUR", "CNY"].map((o) => <option key={o}>{o}</option>)}
                  </select>
                  <input className={`${QBOX} min-w-0 flex-1 text-right`} inputMode="decimal" value={q.unit_price} onChange={(e) => setQf("unit_price", e.target.value)} />
                </div>
              </QF>
              <QF label="총액">
                <div className="px-2 py-1 text-sm font-bold text-primary">{qTotal != null ? `${q.currency} ${fmt(qTotal)}` : "-"}</div>
              </QF>
              <QF label="Incoterms" span={1} changed={changedKeys.includes("incoterms")}>
                <select className={QIN} value={q.incoterms} onChange={(e) => setQf("incoterms", e.target.value)}>
                  {["", "FOB", "CFR", "CIF"].map((o) => <option key={o} value={o}>{o || "-"}</option>)}
                  {q.incoterms && !["FOB", "CFR", "CIF"].includes(q.incoterms) && <option value={q.incoterms}>{q.incoterms}</option>}
                </select>
              </QF>
              <QF label="결제" span={1} changed={changedKeys.includes("payment_type")}>
                <select className={QIN} value={q.payment_type} onChange={(e) => setQf("payment_type", e.target.value)}>
                  {["", "LC", "TT"].map((o) => <option key={o} value={o}>{o || "-"}</option>)}
                  {q.payment_type && !["LC", "TT"].includes(q.payment_type) && <option value={q.payment_type}>{q.payment_type}</option>}
                </select>
              </QF>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-outline-variant/70 pt-3 sm:grid-cols-4 lg:grid-cols-12">
              <QF label="ETD (출항)" changed={changedKeys.includes("etd")}>
                <input type="date" className={QIN} value={q.etd} onChange={(e) => setQf("etd", e.target.value)} />
              </QF>
              <QF label="ETA (도착)" changed={changedKeys.includes("eta")}>
                <input type="date" className={QIN} value={q.eta} onChange={(e) => setQf("eta", e.target.value)} />
              </QF>
              <QF label="BL번호" changed={changedKeys.includes("bl_no")} span={3}>
                <input className={QIN} placeholder="BL번호 입력" value={q.bl_no} onChange={(e) => setQf("bl_no", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && changedKeys.length) saveQuick(); }} />
              </QF>
              <QF label="항해 · 도착">
                <div className="px-2 py-1 text-sm">
                  {sail != null ? <span className="text-on-surface-variant">{sail}일 · </span> : null}
                  {dday != null ? <b className={dday >= 0 && dday <= 3 ? "text-amber-700" : "text-on-surface"}>{dday > 0 ? `D-${dday}` : dday === 0 ? "오늘" : `도착 후 ${-dday}일`}</b> : <span className="text-on-surface-variant">-</span>}
                </div>
              </QF>
              <div className="col-span-2 flex items-end justify-end gap-2 lg:col-span-3">
                {changedKeys.length > 0 ? (
                  <>
                    <span className="pb-1.5 text-xs text-amber-800">{changedKeys.length}개 바뀜</span>
                    <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setQ(quickFrom(r))}>되돌리기</button>
                    <button className="btn-primary px-4 py-1.5 text-xs" disabled={busy} onClick={saveQuick}>저장</button>
                  </>
                ) : (
                  <span className="pb-1.5 text-[11px] text-on-surface-variant">칸을 눌러 바로 고칠 수 있어요</span>
                )}
              </div>
            </div>
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

          {tab === "info" && !editing && (
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
                null
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
