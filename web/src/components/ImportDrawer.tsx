import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon, Modal } from "./ui";
import { AttachmentPanel, QualityPanel, PriceCalcPanel } from "../pages/TradeModule";

// 수입 건 상세 — 화면을 가리지 않는 작은 패널.
//  · inline: 대시보드 선박 일정 오른쪽 칸 안에 들어가서 캘린더와 같이 보인다
//  · floating: 화면 오른쪽에 떠 있는 카드 (뒤 화면도 그대로 쓸 수 있음)
// 서류를 맨 위에 두고, 진행상황·거래 정보·메모 등은 접어 두었다가 필요할 때 펼친다.

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

// 접었다 펼치는 칸
function Fold({ title, summary, open, onToggle, children }: { title: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={onToggle}>
        <Icon name={open ? "expand_less" : "expand_more"} size={18} className="text-on-surface-variant" />
        <span className="text-xs font-bold text-primary">{title}</span>
        {!open && summary != null && <span className="ml-auto truncate text-[11px] text-on-surface-variant">{summary}</span>}
      </button>
      {open && <div className="border-t border-outline-variant px-3 py-2.5">{children}</div>}
    </div>
  );
}

export default function ImportDrawer({ row, onClose, onUpdated, onLocate, variant = "floating" }: {
  row: any; onClose: () => void; onUpdated: (item: any) => void; onLocate?: () => void; variant?: "inline" | "floating";
}) {
  const [r, setR] = useState<any>(row);
  useEffect(() => setR(row), [row]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((p) => ({ ...p, [k]: !p[k] }));
  const [big, setBig] = useState<"" | "quality" | "price">("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [etd, setEtd] = useState(d10(row.etd));
  const [eta, setEta] = useState(d10(row.eta));
  const [note, setNote] = useState(row.note || "");
  const [busy, setBusy] = useState(false);
  const [qualityDraft, setQualityDraft] = useState<Record<string, string> | undefined>(undefined);

  // 다른 건을 누르면 펼침 상태 초기화
  useEffect(() => { setEditing(false); setOpen({}); setQualityDraft(undefined); }, [row.id]);
  useEffect(() => { setEtd(d10(r.etd)); setEta(d10(r.eta)); setNote(r.note || ""); }, [r.id, r.etd, r.eta, r.note]);

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
  const datesChanged = etd !== d10(r.etd) || eta !== d10(r.eta);

  const info: [string, any][] = [
    ["계약일", md(r.contract_date)], ["구매자(Buyer)", r.lc_bank || "-"],
    ["단가", r.unit_price != null ? `${r.currency || "USD"} ${fmt(r.unit_price)}` : "-"], ["총액", total != null ? `${r.currency || "USD"} ${fmt(total)}` : "-"],
    ["Incoterms · 결제", [r.incoterms, r.payment_type].filter(Boolean).join(" · ") || "-"], ["선박명", r.vessel || "-"],
    ["BL번호", r.bl_no || "-"], ["LC번호", r.lc_no || "-"],
  ];

  const shell = variant === "floating"
    ? "fixed bottom-4 right-4 top-20 z-40 flex w-[440px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-outline-variant bg-background shadow-2xl"
    : "flex h-full flex-col";

  return (
    <div className={shell}>
      {/* 머리 — 품목·물량·진행상황 한눈에 */}
      <div className="flex items-start gap-2 border-b border-outline-variant bg-surface-container-lowest px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-secondary-fixed px-2 py-0.5 text-[11px] font-bold text-on-secondary-container">{STAGES[si]?.l || r.status}</span>
            <h3 className="truncate text-base font-bold text-primary" title={r.material_name}>{r.material_name}</h3>
          </div>
          <div className="mt-0.5 truncate text-xs text-on-surface-variant">
            {r.supplier || "-"} · {r.quantity != null ? `${fmt(r.quantity)} ${r.unit || "MT"}` : "-"}{r.lc_bank ? ` · ${r.lc_bank}` : ""}
          </div>
        </div>
        <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-surface-container" onClick={onClose} title="닫기"><Icon name="close" size={18} /></button>
      </div>

      <div className="main-scroll flex-1 space-y-2.5 overflow-y-auto p-3">
        {/* 일정 — 한 줄 */}
        <div className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2">
          <div className="flex items-center gap-1.5">
            <input type="date" title="ETD (출항)" className="input min-w-0 flex-1 px-1.5 py-1 text-xs" value={etd} onChange={(e) => setEtd(e.target.value)} />
            <span className="text-xs text-on-surface-variant">→</span>
            <input type="date" title="ETA (도착)" className="input min-w-0 flex-1 px-1.5 py-1 text-xs" value={eta} onChange={(e) => setEta(e.target.value)} />
            {datesChanged && <button className="btn-primary shrink-0 px-2 py-1 text-xs" disabled={busy} onClick={saveDates}>저장</button>}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-on-surface-variant">
            <span>출항(ETD) → 도착(ETA)</span>
            {dday != null && <span className={dday >= 0 && dday <= 3 ? "font-semibold text-amber-700" : ""}>{dday > 0 ? `D-${dday}` : dday === 0 ? "오늘 도착" : `도착 후 ${-dday}일`}</span>}
          </div>
        </div>

        {/* 서류 — 맨 위에 바로 */}
        <AttachmentPanel entityType="import" entityId={r.id} category="contract" label="📄 계약서" />
        <AttachmentPanel entityType="import" entityId={r.id} category="shipping_docs" label="🚢 선적서류" />
        <AttachmentPanel entityType="import" entityId={r.id} category="settlement" label="💰 정산서류" />

        {/* 나머지는 접어 두기 */}
        <Fold title="📊 진행상황" summary={STAGES[si]?.l} open={!!open.stage} onToggle={() => toggle("stage")}>
          <div className="flex flex-wrap items-center gap-1">
            {STAGES.map((s, i) => (
              <Fragment key={s.v}>
                <button disabled={busy} onClick={() => setStage(s.v)}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${i === si ? "bg-primary text-white" : i < si ? "bg-secondary-fixed text-on-secondary-container" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"}`}>{s.l}</button>
                {i < STAGES.length - 1 && <span className={`h-0.5 w-2 ${i < si ? "bg-secondary-fixed-dim" : "bg-outline-variant"}`} />}
              </Fragment>
            ))}
          </div>
        </Fold>

        <Fold title="📋 거래 정보" summary={`${r.unit_price != null ? `${r.currency || "USD"} ${fmt(r.unit_price)}` : ""}${r.bl_no ? ` · BL ${r.bl_no}` : ""}`} open={!!open.info} onToggle={() => toggle("info")}>
          {!editing ? (
            <>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {info.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[11px] text-on-surface-variant">{label}</div>
                    <div className="truncate text-xs font-semibold text-on-surface" title={String(value)}>{value}</div>
                  </div>
                ))}
              </div>
              <button className="mt-2 text-xs font-semibold text-secondary hover:underline" onClick={startEdit}>✏️ 수정</button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {EDIT_FIELDS.map((x) => (
                  <label key={x.k} className="text-[11px] text-on-surface-variant">{x.l}
                    {x.opts ? (
                      <select className="input mt-0.5 py-1 text-xs" value={form[x.k] ?? ""} onChange={(e) => setForm({ ...form, [x.k]: e.target.value })}>
                        {x.opts.map((o) => <option key={o} value={o}>{o || "-"}</option>)}
                        {form[x.k] && !x.opts.includes(form[x.k]) && <option value={form[x.k]}>{form[x.k]}</option>}
                      </select>
                    ) : (
                      <input type={x.type === "date" ? "date" : "text"} inputMode={x.type === "number" ? "decimal" : undefined}
                        className="input mt-0.5 py-1 text-xs" value={form[x.k] ?? ""} onChange={(e) => setForm({ ...form, [x.k]: e.target.value })} />
                    )}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setEditing(false)}>취소</button>
                <button className="btn-primary px-2.5 py-1 text-xs" disabled={busy} onClick={saveEdit}>저장</button>
              </div>
            </>
          )}
        </Fold>

        <Fold title="📝 메모" summary={r.note ? String(r.note).slice(0, 24) : "없음"} open={!!open.note} onToggle={() => toggle("note")}>
          <textarea className="input min-h-[60px] text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder="이 건에 대한 메모" />
          {note !== (r.note || "") && <div className="mt-1.5 text-right"><button className="btn-primary px-2.5 py-1 text-xs" disabled={busy} onClick={() => put({ note: note || null })}>메모 저장</button></div>}
        </Fold>

        <div className="grid grid-cols-2 gap-2">
          <button className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-xs font-bold text-primary hover:bg-surface-container-low" onClick={() => setBig("quality")}>🧪 품질규격 열기</button>
          <button className="rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-left text-xs font-bold text-primary hover:bg-surface-container-low" onClick={() => setBig("price")}>💰 원가계산 열기</button>
        </div>
        <div className="flex items-center justify-between px-1 pb-1 text-xs">
          {onLocate ? <button className="font-semibold text-secondary hover:underline" onClick={onLocate}>📍 지도에서 보기</button> : <span />}
          <Link to="/imports" className="font-semibold text-secondary hover:underline">원료 수입현황 열기 →</Link>
        </div>
      </div>

      {/* 품질규격·원가계산은 넓은 화면이 필요해서 큰 창으로 */}
      {big && (
        <Modal open onClose={() => setBig("")} title={`${r.material_name} · ${big === "quality" ? "품질규격 비교" : "원가계산"}`} wide="xl">
          {big === "quality"
            ? <QualityPanel entityType="import" entityId={r.id} draft={qualityDraft} onDraftChange={setQualityDraft} />
            : <PriceCalcPanel entityType="import" entityId={r.id} defaultProduct={r.material_name} defaultQuantity={r.quantity}
                defaultShipper={r.supplier} defaultIncoterms={r.incoterms} defaultContractPrice={r.unit_price} qualityDraft={qualityDraft} />}
        </Modal>
      )}
    </div>
  );
}
