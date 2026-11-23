import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, Icon } from "../components/ui";
import { BID_STATUS, CUSTOMERS, DEFAULT_FREIGHT, addMonths, customerOf, kgPrice, supplyPrice, won, ym } from "../planCalc";

// 입찰 · 납품계획 — 대표님이 받은 애경·대경 월별 납품 수량·가격을 미리 넣어 두고,
// 제주 남부·중부발전소 입찰 결과(누가 얼마에 몇 kL 낙찰)를 함께 기록한다.

const num = (v: any) => (v == null || v === "" ? null : Number(String(v).replace(/,/g, "")) || 0);
const f0 = (v: any) => (v == null || v === "" ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const STATUS_STYLE: Record<string, string> = {
  "낙찰": "bg-success-container text-success", "부분낙찰": "bg-success-container text-success",
  "예정가격초과": "bg-surface-container-highest text-on-surface-variant", "실격": "bg-error-container text-error",
  "미참가": "bg-surface-container-highest text-on-surface-variant",
};

export default function Plan() {
  const [data, setData] = useState<{ bids: any[]; plans: any[] } | null>(null);
  const [bidEdit, setBidEdit] = useState<any>(null);
  const [planEdit, setPlanEdit] = useState<any>(null);
  function load() { return api.get("/plan").then((r: any) => setData({ bids: r.bids || [], plans: r.plans || [] })); }
  useEffect(() => { load(); }, []);
  if (!data) return <Spinner />;

  const now = ym();
  const months = [-2, -1, 0, 1, 2, 3, 4, 5].map((n) => addMonths(now, n));
  const planMap = new Map<string, any>();
  for (const p of data.plans) planMap.set(`${p.ym}|${p.customer}`, p);

  return (
    <div className="space-y-8">
      <PageHeader title="입찰 · 납품계획" subtitle="애경·대경 월별 납품 수량·단가와 제주 남부·중부발전소 입찰 결과를 관리합니다. 원/L ÷ 0.92 = 원/kg, 여기서 운송비를 빼면 오르카 납품가예요."
        action={<div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setBidEdit({ plant: "중부", qty_unit: "kL", results: [{}, {}, {}] })}>+ 입찰 결과</button>
          <button className="btn-primary" onClick={() => setPlanEdit({ ym: now, customer: "애경", freight: DEFAULT_FREIGHT })}>+ 납품계획</button>
        </div>} />

      {/* 월별 납품계획 */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-primary"><Icon name="calendar_month" /> 월별 납품계획</h2>
        <div className="card overflow-x-auto">
          <table className="table-compact w-full min-w-[860px]">
            <thead><tr className="bg-surface-container-low">
              <th className="th">월</th>
              {CUSTOMERS.map((c) => <th key={c.key} className="th" colSpan={2}>{c.key}</th>)}
              <th className="th text-right">합계 (MT)</th>
            </tr>
            <tr className="bg-surface-container-low">
              <th className="th"></th>
              {CUSTOMERS.map((c) => [<th key={c.key + "q"} className="th text-right">수량 MT</th>, <th key={c.key + "p"} className="th">단가 (원/L → 원/kg → 납품가)</th>])}
              <th className="th"></th>
            </tr></thead>
            <tbody>
              {months.map((m) => {
                const total = CUSTOMERS.reduce((a, c) => a + (Number(planMap.get(`${m}|${c.key}`)?.qty_mt) || 0), 0);
                return (
                  <tr key={m} className={`border-t border-outline-variant ${m === now ? "bg-primary-fixed/30" : ""}`}>
                    <td className="td font-mono text-sm font-bold">{m.replace("-", ".")}{m === now && <span className="ml-1 text-xs font-normal text-primary">이번 달</span>}</td>
                    {CUSTOMERS.map((c) => {
                      const p = planMap.get(`${m}|${c.key}`);
                      if (!p) return [
                        <td key={c.key + "q"} className="td text-right" colSpan={2}>
                          <button className="text-xs text-primary hover:underline" onClick={() => setPlanEdit({ ym: m, customer: c.key, freight: DEFAULT_FREIGHT })}>+ 입력</button>
                        </td>,
                      ];
                      return [
                        <td key={c.key + "q"} className="td cursor-pointer text-right font-bold hover:underline" onClick={() => setPlanEdit(p)}>{f0(p.qty_mt)}</td>,
                        <td key={c.key + "p"} className="td cursor-pointer text-xs hover:underline" onClick={() => setPlanEdit(p)}>
                          {p.price_l ? <>{won(p.price_l)} → {won(kgPrice(p.price_l))} → <b className="text-primary">{won(supplyPrice(p.price_l, p.freight))}</b></> : <span className="text-on-surface-variant">단가 미정</span>}
                          {p.note ? <div className="text-on-surface-variant">{p.note}</div> : null}
                        </td>,
                      ];
                    })}
                    <td className="td text-right font-bold">{total ? f0(total) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 입찰 결과 */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-primary"><Icon name="gavel" /> 발전소 입찰 결과</h2>
        {data.bids.length === 0 ? <Empty text="입찰 결과가 없습니다" icon="gavel" /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {data.bids.map((b) => <BidCard key={b.id} b={b} onEdit={() => setBidEdit({ ...b, results: b.results.length ? b.results : [{}] })} />)}
          </div>
        )}
      </section>

      {bidEdit && <BidModal bid={bidEdit} onClose={() => setBidEdit(null)} onSaved={() => { setBidEdit(null); load(); }} />}
      {planEdit && <PlanModal plan={planEdit} bids={data.bids} onClose={() => setPlanEdit(null)} onSaved={() => { setPlanEdit(null); load(); }} />}
    </div>
  );
}

function BidCard({ b, onEdit }: { b: any; onEdit: () => void }) {
  const awarded = b.results.reduce((a: number, r: any) => a + (Number(r.awarded_qty) || 0), 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-4 py-3">
        <div>
          <div className="text-base font-bold text-primary">{b.plant}발전소 · {b.period_from ? `${b.period_from.slice(2).replace(/-/g, ".")} ~ ${(b.period_to || "").slice(2).replace(/-/g, ".")}` : "납품기간 미정"}</div>
          <div className="text-xs text-on-surface-variant">
            개찰 {b.open_date || "-"} · 총 {f0(b.total_qty)}{b.qty_unit || ""}{awarded ? ` (낙찰 ${f0(awarded)})` : ""}{b.est_price ? ` · 예정가격 ${won(b.est_price)}원/L` : ""}
          </div>
        </div>
        <button className="text-xs text-primary hover:underline" onClick={onEdit}>수정</button>
      </div>
      <table className="table-compact w-full">
        <thead><tr className="bg-surface-container-low">
          <th className="th">업체</th><th className="th text-right">원/L</th><th className="th text-right">원/kg</th><th className="th text-right">낙찰수량</th><th className="th">결과</th>
        </tr></thead>
        <tbody>
          {b.results.map((r: any) => {
            const ours = customerOf(r.company);
            return (
              <tr key={r.id} className={`border-t border-outline-variant ${ours ? "bg-secondary-fixed/30" : ""}`}>
                <td className="td text-sm">{r.company}{ours && <span className="ml-1 rounded bg-secondary px-1 text-[10px] font-bold text-on-secondary">우리 납품처</span>}</td>
                <td className="td text-right">{r.price_l ? won(r.price_l) : "-"}</td>
                <td className="td text-right text-xs text-on-surface-variant">{r.price_l ? won(kgPrice(r.price_l)) : "-"}</td>
                <td className="td text-right">{r.awarded_qty ? f0(r.awarded_qty) : "-"}{r.rounds ? <span className="text-xs text-on-surface-variant"> · {r.rounds}항차</span> : null}</td>
                <td className="td"><span className={`badge ${STATUS_STYLE[r.status] || "bg-surface-container-highest text-on-surface-variant"}`}>{r.status || "-"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {b.note && <p className="border-t border-outline-variant px-4 py-2 text-xs text-on-surface-variant">{b.note}</p>}
    </div>
  );
}

function BidModal({ bid, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({ ...bid });
  const [rows, setRows] = useState<any[]>(bid.results.map((r: any) => ({ ...r })));
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const setRow = (i: number, k: string, v: any) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, total_qty: num(f.total_qty), est_price: num(f.est_price),
        results: rows.map((r) => ({ ...r, price_l: num(r.price_l), bid_qty: num(r.bid_qty), awarded_qty: num(r.awarded_qty), rounds: num(r.rounds) })) };
      if (f.id) await api.put(`/plan/bids/${f.id}`, body); else await api.post("/plan/bids", body);
      onSaved();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function remove() { if (confirm("이 입찰 결과를 삭제할까요?")) { await api.del(`/plan/bids/${f.id}`); onSaved(); } }
  const cell = "w-full rounded border border-outline-variant bg-surface-container-lowest px-2 py-1 text-sm";
  return (
    <Modal open onClose={onClose} title={f.id ? "입찰 결과 수정" : "입찰 결과 등록"} wide="xl">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="발전소"><select className="input" value={f.plant} onChange={set("plant")}><option>남부</option><option>중부</option></select></Field>
          <Field label="개찰일"><input type="date" className="input" value={f.open_date || ""} onChange={set("open_date")} /></Field>
          <Field label="납품 시작"><input type="date" className="input" value={f.period_from || ""} onChange={set("period_from")} /></Field>
          <Field label="납품 끝"><input type="date" className="input" value={f.period_to || ""} onChange={set("period_to")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="총 입찰수량"><input className="input" value={f.total_qty ?? ""} onChange={set("total_qty")} /></Field>
          <Field label="단위"><select className="input" value={f.qty_unit || "kL"} onChange={set("qty_unit")}><option>kL</option><option>L</option><option>MT</option></select></Field>
          <Field label="예정가격 (원/L)"><input className="input" value={f.est_price ?? ""} onChange={set("est_price")} /></Field>
          <Field label="공고일"><input type="date" className="input" value={f.notice_date || ""} onChange={set("notice_date")} /></Field>
        </div>
        <div className="overflow-x-auto rounded-lg border border-outline-variant">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="bg-surface-container-low text-xs text-on-surface-variant">
              <th className="px-2 py-2 text-left">업체</th><th className="px-2 py-2 text-left">투찰단가 원/L</th><th className="px-2 py-2 text-left">투찰수량</th>
              <th className="px-2 py-2 text-left">낙찰수량</th><th className="px-2 py-2 text-left">결과</th><th className="px-2 py-2 text-left">항차</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-outline-variant">
                  <td className="p-1"><input className={cell} value={r.company || ""} onChange={(e) => setRow(i, "company", e.target.value)} /></td>
                  <td className="p-1"><input className={cell} value={r.price_l ?? ""} onChange={(e) => setRow(i, "price_l", e.target.value)} /></td>
                  <td className="p-1"><input className={cell} value={r.bid_qty ?? ""} onChange={(e) => setRow(i, "bid_qty", e.target.value)} /></td>
                  <td className="p-1"><input className={cell} value={r.awarded_qty ?? ""} onChange={(e) => setRow(i, "awarded_qty", e.target.value)} /></td>
                  <td className="p-1"><select className={cell} value={r.status || ""} onChange={(e) => setRow(i, "status", e.target.value)}><option value="">-</option>{BID_STATUS.map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td className="p-1"><input className={cell} value={r.rounds ?? ""} onChange={(e) => setRow(i, "rounds", e.target.value)} /></td>
                  <td className="p-1 text-center"><button className="text-xs text-error" onClick={() => setRows(rows.filter((_, j) => j !== i))}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="m-2 text-xs text-primary hover:underline" onClick={() => setRows([...rows, {}])}>+ 업체 추가</button>
        </div>
        <Field label="메모"><textarea className="input" rows={2} value={f.note || ""} onChange={set("note")} /></Field>
        <div className="flex justify-end gap-2">
          {f.id && <button className="btn-secondary mr-auto !text-error" onClick={remove}>삭제</button>}
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" disabled={busy} onClick={save}>저장</button>
        </div>
      </div>
    </Modal>
  );
}

function PlanModal({ plan, bids, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({ ...plan });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  // 이 납품처가 낙찰받은 입찰 결과 중 기간에 이 달이 들어가는 것
  const candidates = useMemo(() => {
    const out: { bid: any; r: any }[] = [];
    for (const b of bids) for (const r of b.results) {
      if (customerOf(r.company) !== f.customer || !r.price_l) continue;
      out.push({ bid: b, r });
    }
    const inPeriod = (b: any) => b.period_from && f.ym >= b.period_from.slice(0, 7) && f.ym <= (b.period_to || "9999").slice(0, 7);
    return out.sort((a, b) => Number(inPeriod(b.bid)) - Number(inPeriod(a.bid)));
  }, [bids, f.customer, f.ym]);
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, qty_mt: num(f.qty_mt), price_l: num(f.price_l), freight: num(f.freight) ?? DEFAULT_FREIGHT };
      if (f.id) await api.put(`/plan/plans/${f.id}`, body); else await api.post("/plan/plans", body);
      onSaved();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function remove() { if (confirm("이 납품계획을 삭제할까요?")) { await api.del(`/plan/plans/${f.id}`); onSaved(); } }
  const pl = num(f.price_l);
  return (
    <Modal open onClose={onClose} title={f.id ? "납품계획 수정" : "납품계획 입력"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="월"><input type="month" className="input" value={f.ym} onChange={set("ym")} /></Field>
          <Field label="납품처"><select className="input" value={f.customer} onChange={set("customer")}>{CUSTOMERS.map((c) => <option key={c.key}>{c.key}</option>)}</select></Field>
        </div>
        <Field label="납품 수량 (MT)"><input className="input" value={f.qty_mt ?? ""} onChange={set("qty_mt")} placeholder="예) 500" /></Field>
        {candidates.length > 0 && (
          <div className="rounded-lg bg-surface-container-low px-3 py-2 text-xs">
            <div className="mb-1 text-on-surface-variant">입찰 결과에서 단가 가져오기</div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map(({ bid, r }) => (
                <button key={r.id} className="rounded-full border border-outline-variant px-2 py-1 hover:bg-surface-container"
                  onClick={() => setF({ ...f, price_l: r.price_l, bid_id: bid.id })}>
                  {bid.plant} {bid.period_from?.slice(2, 7)} · {r.company} {won(r.price_l)}원/L · {r.status || ""}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="낙찰 단가 (원/L)"><input className="input" value={f.price_l ?? ""} onChange={set("price_l")} placeholder="예) 1444" /></Field>
          <Field label="운송비 (원/kg)"><input className="input" value={f.freight ?? ""} onChange={set("freight")} /></Field>
        </div>
        {pl ? <p className="rounded-lg bg-primary-fixed/40 px-3 py-2 text-sm">{won(pl)}원/L ÷ 0.92 = {won(kgPrice(pl))}원/kg − 운송비 {f.freight ?? DEFAULT_FREIGHT} = <b className="text-primary">{won(supplyPrice(pl, num(f.freight)))}원/kg</b></p> : null}
        <Field label="메모"><input className="input" value={f.note || ""} onChange={set("note")} /></Field>
        <div className="flex justify-end gap-2">
          {f.id && <button className="btn-secondary mr-auto !text-error" onClick={remove}>삭제</button>}
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" disabled={busy || !f.ym} onClick={save}>저장</button>
        </div>
      </div>
    </Modal>
  );
}
