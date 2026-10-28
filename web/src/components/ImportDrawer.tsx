import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon } from "./ui";
import { AttachmentPanel, QualityPanel, PriceCalcPanel } from "../pages/TradeModule";

// 수입 건 상세 — 오른쪽에서 크게 열리는 패널.
// 원료 수입현황 펼침과 같은 내용(진행상황·거래 정보·BL·메모·품질규격·원가계산·서류)을 한 곳에서 보고 바로 고칠 수 있다.

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
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}
function fmt(n: any) {
  if (n == null || n === "") return "-";
  const v = Number(n);
  return Number.isFinite(v) ? (Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : String(n);
}

const EDIT_FIELDS: { k: string; l: string; type?: string; opts?: string[]; span?: number }[] = [
  { k: "contract_date", l: "계약일", type: "date" },
  { k: "supplier", l: "공급사(Seller)" },
  { k: "lc_bank", l: "구매자(Buyer)" },
  { k: "material_name", l: "원료명" },
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

export default function ImportDrawer({ row, onClose, onUpdated, onLocate }: {
  row: any; onClose: () => void; onUpdated: (item: any) => void; onLocate?: () => void;
}) {
  const [r, setR] = useState<any>(row);
  useEffect(() => setR(row), [row]);
  const [tab, setTab] = useState<"docs" | "quality" | "price">("docs");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [etd, setEtd] = useState(d10(row.etd));
  const [eta, setEta] = useState(d10(row.eta));
  const [note, setNote] = useState(row.note || "");
  const [busy, setBusy] = useState(false);
  const [qualityDraft, setQualityDraft] = useState<Record<string, string> | undefined>(undefined);

  useEffect(() => { setEtd(d10(r.etd)); setEta(d10(r.eta)); setNote(r.note || ""); }, [r.id, r.etd, r.eta, r.note]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    // 물량·단가가 바뀌면 총액도 다시 계산되도록
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
  const sail = etd && eta && eta >= etd ? Math.round((new Date(eta).getTime() - new Date(etd).getTime()) / 86400000) : null;
  const todayMs = new Date(new Date().toDateString()).getTime();
  const dday = eta ? Math.round((new Date(eta).getTime() - todayMs) / 86400000) : null;
  const datesChanged = etd !== d10(r.etd) || eta !== d10(r.eta);

  const info: [string, any][] = [
    ["계약일", md(r.contract_date)],
    ["공급사(Seller)", r.supplier || "-"],
    ["구매자(Buyer)", r.lc_bank || "-"],
    ["물량", r.quantity != null ? `${fmt(r.quantity)} ${r.unit || "MT"}` : "-"],
    ["단가", r.unit_price != null ? `${r.currency || "USD"} ${fmt(r.unit_price)}` : "-"],
    ["총액", total != null ? `${r.currency || "USD"} ${fmt(total)}` : "-"],
    ["Incoterms · 결제", [r.incoterms, r.payment_type].filter(Boolean).join(" · ") || "-"],
    ["선박명", r.vessel || "-"],
    ["BL번호", r.bl_no || "-"],
    ["LC번호", r.lc_no || "-"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-primary/30 backdrop-blur-[2px]" onClick={onClose}>
      <div className="main-scroll flex h-full w-full max-w-[1000px] flex-col overflow-y-auto bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 머리 */}
        <div className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container-lowest px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs text-on-surface-variant">원료 수입 건</div>
              <h2 className="headline truncate text-2xl font-bold text-primary">{r.material_name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant">
                <span><b className="text-on-surface">{r.supplier || "-"}</b> → <b className="text-on-surface">{r.lc_bank || "오르카"}</b></span>
                <span>{r.quantity != null ? `${fmt(r.quantity)} ${r.unit || "MT"}` : ""}</span>
                {total != null && <span>{r.currency || "USD"} {fmt(total)}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {onLocate && <button className="btn-secondary px-3 py-1.5 text-xs" onClick={onLocate}>📍 지도에서 보기</button>}
              <Link to="/imports" className="btn-secondary px-3 py-1.5 text-xs">원료 수입현황 열기</Link>
              <button className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-container" onClick={onClose} title="닫기 (Esc)"><Icon name="close" /></button>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* 진행상황 — 눌러서 바로 변경 */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-primary">📊 진행상황</h3>
              <span className="text-xs text-on-surface-variant">단계를 누르면 바로 바뀌어요</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {STAGES.map((s, i) => (
                <Fragment key={s.v}>
                  <button disabled={busy} onClick={() => setStage(s.v)}
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${i === si ? "bg-primary text-white" : i < si ? "bg-secondary-fixed text-on-secondary-container hover:bg-secondary-fixed-dim" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}`}>
                    {s.l}
                  </button>
                  {i < STAGES.length - 1 && <span className={`h-0.5 w-4 ${i < si ? "bg-secondary-fixed-dim" : "bg-outline-variant"}`} />}
                </Fragment>
              ))}
            </div>
          </section>

          {/* 선박 일정 */}
          <section className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-primary">🚢 선박 일정</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-on-surface-variant">ETD (출항)
                <input type="date" className="input mt-1 w-44" value={etd} onChange={(e) => setEtd(e.target.value)} />
              </label>
              <span className="pb-2 text-on-surface-variant">→</span>
              <label className="text-xs text-on-surface-variant">ETA (도착)
                <input type="date" className="input mt-1 w-44" value={eta} onChange={(e) => setEta(e.target.value)} />
              </label>
              <button className="btn-primary" disabled={!datesChanged || busy} onClick={saveDates}>날짜 저장</button>
              <div className="flex gap-4 pb-2 text-sm">
                {sail != null && <span className="text-on-surface-variant">항해 <b className="text-on-surface">{sail}일</b></span>}
                {dday != null && (
                  <span className={dday >= 0 && dday <= 3 ? "font-semibold text-amber-700" : "text-on-surface-variant"}>
                    {dday > 0 ? `도착까지 D-${dday}` : dday === 0 ? "오늘 도착" : `도착 후 ${-dday}일`}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* 거래 정보 */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-primary">📋 거래 정보</h3>
              {!editing
                ? <button className="text-xs font-semibold text-secondary hover:underline" onClick={startEdit}>✏️ 수정</button>
                : <span className="flex gap-2">
                    <button className="btn-secondary px-3 py-1 text-xs" onClick={() => setEditing(false)}>취소</button>
                    <button className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={saveEdit}>저장</button>
                  </span>}
            </div>
            {!editing ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
                {info.map(([label, value]) => (
                  <div key={label}>
                    <div className="text-xs text-on-surface-variant">{label}</div>
                    <div className="mt-0.5 font-semibold text-on-surface">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {EDIT_FIELDS.map((x) => (
                  <label key={x.k} className="text-xs text-on-surface-variant">{x.l}
                    {x.opts ? (
                      <select className="input mt-1 py-1.5 text-sm" value={form[x.k] ?? ""} onChange={(e) => setForm({ ...form, [x.k]: e.target.value })}>
                        {x.opts.map((o) => <option key={o} value={o}>{o || "-"}</option>)}
                        {form[x.k] && !x.opts.includes(form[x.k]) && <option value={form[x.k]}>{form[x.k]}</option>}
                      </select>
                    ) : (
                      <input type={x.type === "date" ? "date" : "text"} inputMode={x.type === "number" ? "decimal" : undefined}
                        className="input mt-1 py-1.5 text-sm" value={form[x.k] ?? ""} onChange={(e) => setForm({ ...form, [x.k]: e.target.value })} />
                    )}
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* 메모 */}
          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-primary">📝 메모</h3>
              {note !== (r.note || "") && <button className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => put({ note: note || null })}>메모 저장</button>}
            </div>
            <textarea className="input min-h-[64px] text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="이 건에 대한 메모" />
          </section>

          {/* 서류 · 품질규격 · 원가계산 */}
          <section>
            <div className="mb-3 flex gap-1 border-b border-outline-variant">
              {([["docs", "📎 서류"], ["quality", "🧪 품질규격"], ["price", "💰 원가계산"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-primary"}`}>{l}</button>
              ))}
            </div>
            {tab === "docs" && (
              <div className="grid gap-3 md:grid-cols-3">
                <AttachmentPanel entityType="import" entityId={r.id} category="contract" label="📄 계약서" />
                <AttachmentPanel entityType="import" entityId={r.id} category="shipping_docs" label="🚢 선적서류" />
                <AttachmentPanel entityType="import" entityId={r.id} category="settlement" label="💰 정산서류" />
              </div>
            )}
            {tab === "quality" && <QualityPanel entityType="import" entityId={r.id} draft={qualityDraft} onDraftChange={setQualityDraft} />}
            {tab === "price" && (
              <PriceCalcPanel entityType="import" entityId={r.id} defaultProduct={r.material_name} defaultQuantity={r.quantity}
                defaultShipper={r.supplier} defaultIncoterms={r.incoterms} defaultContractPrice={r.unit_price} qualityDraft={qualityDraft} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
