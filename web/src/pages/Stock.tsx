import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, Icon } from "../components/ui";
import { downloadXlsx } from "../xlsx";

// 입출고·재고 — 부장님 입출고 대장(엑셀)을 대신한다.
// 입고(DO 받은 시점) → 공장투입(예정/진행/완료) → 재고 = 입고 − 투입(진행+완료), 출고는 납품업체·상차지별로 기록.

const PROCESSES = ["탈검", "탈수", "블렌딩", "멜팅", "멜팅후탈검", "멜팅후탈수", "직납", "판매", "기타"];
const PLANTS = ["월드", "다산", "대원", "로지오", "멜팅샵", "태영", "TKS", "KG"];
const CUSTOMERS = ["AK", "대경", "씨드", "GKF", "형제", "로지오", "KG", "YG"];
const ST_LABEL: Record<string, string> = { plan: "예정", doing: "진행", done: "완료" };
const ST_STYLE: Record<string, string> = {
  plan: "bg-surface-container-highest text-on-surface-variant",
  doing: "bg-tertiary-fixed text-on-tertiary-container",
  done: "bg-success-container text-success",
};

const today = () => new Date().toLocaleDateString("sv-SE");
const num = (v: any) => (v == null || v === "" ? 0 : Number(v) || 0);
const f2 = (v: any) => (v == null || v === "" ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const md = (d?: string) => (d ? d.slice(5).replace("-", "/") : "-");
function dday(d: string) {
  const diff = Math.round((new Date(d + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);
  return diff === 0 ? "오늘" : diff > 0 ? `D-${diff}` : `${-diff}일 지남`;
}

type Lot = any;
type Move = any;

function statsOf(lot: Lot, moves: Move[]) {
  const ins = moves.filter((m) => m.kind === "input" && m.lot_id === lot.id);
  const sum = (st: string) => ins.filter((m) => m.status === st).reduce((a, m) => a + num(m.qty), 0);
  const done = sum("done"), doing = sum("doing"), plan = sum("plan");
  const remain = Math.max(0, Math.round((num(lot.qty) - done - doing) * 1000) / 1000);
  return { ins, done, doing, plan, remain };
}

export default function Stock() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"stock" | "in" | "out" | "plan" | "contract">("stock");
  const [plant, setPlant] = useState("");
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [lotEdit, setLotEdit] = useState<Lot | null>(null);
  const [inputFor, setInputFor] = useState<Lot | null>(null);
  const [outEdit, setOutEdit] = useState<Move | null>(null);

  function load() {
    return Promise.all([api.get("/stock"), api.get("/trade/imports")]).then(([s, i]: any) => {
      setLots(s.lots || []); setMoves(s.moves || []); setImports(i.items || []);
    }).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const m = new Map<number, ReturnType<typeof statsOf>>();
    for (const l of lots) m.set(l.id, statsOf(l, moves));
    return m;
  }, [lots, moves]);
  const outs = useMemo(() => moves.filter((m) => m.kind === "out"), [moves]);
  const importById = useMemo(() => new Map(imports.map((i) => [i.id, i])), [imports]);

  const ym = today().slice(0, 7);
  const openLots = lots.filter((l) => { const s = stats.get(l.id)!; return s.remain > 0.001 || s.doing > 0 || s.plan > 0; });
  const kpi = {
    stock: openLots.reduce((a, l) => a + stats.get(l.id)!.remain, 0),
    doing: openLots.reduce((a, l) => a + stats.get(l.id)!.doing, 0),
    inMonth: lots.filter((l) => (l.in_date || "").startsWith(ym)).reduce((a, l) => a + num(l.qty), 0),
    outMonth: outs.filter((o) => o.status === "done" && (o.move_date || "").startsWith(ym)).reduce((a, o) => a + num(o.qty), 0),
  };

  const textMatch = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const lotText = (l: Lot) => [l.material, l.supplier, l.buyer, l.plant, l.process, l.process_note, l.note].join(" ");

  function exportExcel() {
    // 부장님 엑셀과 같은 순서 + 업체·LC개설처·단가·재고 열 추가
    const rows: string[][] = [["일자", "입고품명", "업체", "LC개설처", "단가", "입고량(mt)", "공정", "가공처", "재고(mt)", "출고품명", "출고량(mt)", "납품업체", "상차지"]];
    const ev: { d: string; r: string[] }[] = [];
    for (const l of lots) {
      const s = stats.get(l.id)!;
      ev.push({ d: l.in_date, r: [l.in_date, l.material, l.supplier || "", l.buyer || "", l.unit_price ? `${l.currency || ""} ${l.unit_price}` : "", String(l.qty), l.process || l.process_note || "", l.plant || "", String(s.remain), "", "", "", ""] });
    }
    for (const o of outs) ev.push({ d: o.move_date, r: [o.move_date, "", "", "", "", "", "", "", "", o.product || "", String(o.qty), o.customer || "", o.load_site || ""] });
    ev.sort((a, b) => a.d.localeCompare(b.d));
    downloadXlsx(`입출고현황_${today()}.xlsx`, "입출고", "입출고 현황", [...rows, ...ev.map((e) => e.r)]);
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="입출고 · 재고" subtitle="입고(DO) → 공장투입(진행/완료) → 재고 · 출고, 계약 건(업체·LC개설처·단가)과 연결해 관리합니다"
        action={<div className="flex gap-2">
          <button className="btn-secondary" onClick={exportExcel}><Icon name="download" size={18} /> 엑셀</button>
          <button className="btn-secondary" onClick={() => setOutEdit({ kind: "out", move_date: today(), status: "done" })}>+ 출고</button>
          <button className="btn-primary" onClick={() => setLotEdit({ in_date: today(), currency: "USD" })}>+ 입고</button>
        </div>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="현재 재고 (공장 미투입)" value={kpi.stock} unit="MT" strong />
        <Kpi label="공장투입 진행중" value={kpi.doing} unit="MT" />
        <Kpi label={`${Number(ym.slice(5))}월 입고`} value={kpi.inMonth} unit="MT" />
        <Kpi label={`${Number(ym.slice(5))}월 출고`} value={kpi.outMonth} unit="MT" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex w-fit gap-1 rounded-lg bg-surface-container p-1 text-sm">
          {([["stock", "재고 현황"], ["in", "입고 기록"], ["out", "출고 기록"], ["plan", "일정"], ["contract", "계약별 입고"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 font-medium ${tab === k ? "bg-surface-container-lowest text-primary shadow" : "text-on-surface-variant"}`}>{l}</button>
          ))}
        </div>
        {(tab === "in" || tab === "out" || tab === "stock") && (
          <input className="input !w-56" placeholder="품명·업체·가공처 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        {(tab === "in" || tab === "out") && (
          <select className="input !w-36" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">전체 기간</option>
            {[...new Set([...lots.map((l) => (l.in_date || "").slice(0, 7)), ...outs.map((o) => (o.move_date || "").slice(0, 7))])]
              .filter(Boolean).sort().reverse().map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}
      </div>

      {tab === "stock" && (
        <StockTab lots={openLots.filter((l) => (!plant || l.plant === plant) && textMatch(lotText(l)))} allOpen={openLots}
          stats={stats} plant={plant} setPlant={setPlant}
          onInput={setInputFor} onEdit={setLotEdit} />
      )}
      {tab === "in" && (
        <InTab lots={lots.filter((l) => (!month || (l.in_date || "").startsWith(month)) && textMatch(lotText(l)))}
          stats={stats} importById={importById} onInput={setInputFor} onEdit={setLotEdit} />
      )}
      {tab === "out" && (
        <OutTab outs={outs.filter((o) => (!month || (o.move_date || "").startsWith(month)) && textMatch([o.product, o.customer, o.load_site, o.note].join(" ")))}
          onEdit={setOutEdit} />
      )}
      {tab === "plan" && <PlanTab lots={lots} moves={moves} imports={imports} stats={stats} onInput={setInputFor} onOut={setOutEdit} />}
      {tab === "contract" && <ContractTab imports={imports} lots={lots} onPick={(imp: any) => setLotEdit({ in_date: today(), ...fromImport(imp) })} />}

      {lotEdit && <LotModal lot={lotEdit} imports={imports} lots={lots} onClose={() => setLotEdit(null)} onSaved={() => { setLotEdit(null); load(); }} />}
      {inputFor && <InputModal lot={lots.find((l) => l.id === inputFor.id) || inputFor} stats={statsOf(lots.find((l) => l.id === inputFor.id) || inputFor, moves)}
        onClose={() => setInputFor(null)} onChanged={load} />}
      {outEdit && <OutModal mv={outEdit} onClose={() => setOutEdit(null)} onSaved={() => { setOutEdit(null); load(); }} />}
    </div>
  );
}

function Kpi({ label, value, unit, strong }: { label: string; value: number; unit: string; strong?: boolean }) {
  return (
    <div className={`card px-4 py-3 ${strong ? "border-primary" : ""}`}>
      <div className="mono-label text-on-surface-variant">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${strong ? "text-primary" : "text-on-surface"}`}>
        {f2(value)} <span className="text-sm font-medium text-on-surface-variant">{unit}</span>
      </div>
    </div>
  );
}

function fromImport(imp: any) {
  return {
    import_id: imp.id, material: imp.material_name, supplier: imp.supplier, buyer: imp.lc_bank,
    unit_price: imp.unit_price, currency: imp.currency || "USD",
  };
}

function Stage({ s, qty }: { s: ReturnType<typeof statsOf>; qty: number }) {
  const pct = (v: number) => `${Math.min(100, (v / (qty || 1)) * 100)}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
      <div className="bg-success" style={{ width: pct(s.done) }} />
      <div className="bg-tertiary" style={{ width: pct(s.doing) }} />
    </div>
  );
}

// ---------- 재고 현황 ----------
function StockTab({ lots, allOpen, stats, plant, setPlant, onInput, onEdit }: any) {
  const byPlant = new Map<string, number>();
  for (const l of allOpen) byPlant.set(l.plant || "미지정", (byPlant.get(l.plant || "미지정") || 0) + stats.get(l.id).remain);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setPlant("")} className={`rounded-full border px-3 py-1 text-sm ${!plant ? "border-primary bg-primary text-on-primary" : "border-outline-variant"}`}>전체</button>
        {[...byPlant.entries()].sort((a, b) => b[1] - a[1]).map(([p, v]) => (
          <button key={p} onClick={() => setPlant(p === "미지정" ? "" : p)}
            className={`rounded-full border px-3 py-1 text-sm ${plant === p ? "border-primary bg-primary text-on-primary" : "border-outline-variant"}`}>
            {p} <b>{f2(v)}</b>
          </button>
        ))}
      </div>
      {lots.length === 0 ? <Empty text="남은 재고가 없습니다" icon="inventory_2" /> : (
        <div className="card overflow-x-auto">
          <table className="table-compact w-full min-w-[980px]">
            <thead><tr className="bg-surface-container-low">
              <th className="th">입고일</th><th className="th">품명 · 업체</th><th className="th">LC개설처 · 단가</th>
              <th className="th text-right">입고</th><th className="th text-right">투입완료</th><th className="th text-right">진행</th>
              <th className="th text-right">재고</th><th className="th">가공처 · 공정</th><th className="th">프리타임</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {lots.map((l: Lot) => {
                const s = stats.get(l.id);
                return (
                  <tr key={l.id} className="border-t border-outline-variant">
                    <td className="td font-mono text-xs">{l.in_date}</td>
                    <td className="td"><div className="font-medium">{l.material}</div><div className="text-xs text-on-surface-variant">{l.supplier || "-"}</div></td>
                    <td className="td text-xs">{l.buyer ? <b>{l.buyer}</b> : <span className="text-on-surface-variant">계약 미연결</span>}
                      {l.unit_price ? <div className="text-on-surface-variant">{l.currency} {f2(l.unit_price)}</div> : null}</td>
                    <td className="td text-right">{f2(l.qty)}</td>
                    <td className="td text-right text-success">{s.done ? f2(s.done) : "-"}</td>
                    <td className="td text-right text-tertiary">{s.doing ? f2(s.doing) : "-"}</td>
                    <td className="td w-28 text-right"><div className="font-bold text-primary">{f2(s.remain)}</div><Stage s={s} qty={num(l.qty)} /></td>
                    <td className="td text-xs">{l.plant || "-"} · {l.process || l.process_note || "-"}
                      {s.plan > 0 && <div className="text-on-surface-variant">투입 예정 {f2(s.plan)}</div>}</td>
                    <td className="td text-xs">{l.free_until ? <span className={dday(l.free_until).includes("지남") || dday(l.free_until) === "오늘" ? "font-bold text-error" : ""}>{md(l.free_until)} ({dday(l.free_until)})</span> : "-"}</td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn-primary !px-2 !py-1 text-xs" onClick={() => onInput(l)}>공장투입</button>
                      <button className="ml-1 text-xs text-primary hover:underline" onClick={() => onEdit(l)}>수정</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-on-surface-variant">재고 = 입고량 − 공장투입(진행 + 완료). 막대: <span className="text-success">■ 완료</span> <span className="text-tertiary">■ 진행</span></p>
    </>
  );
}

// ---------- 입고 기록 ----------
function InTab({ lots, stats, importById, onInput, onEdit }: any) {
  if (!lots.length) return <Empty text="입고 기록이 없습니다" icon="inventory_2" />;
  const total = lots.reduce((a: number, l: Lot) => a + num(l.qty), 0);
  return (
    <div className="card overflow-x-auto">
      <table className="table-compact w-full min-w-[980px]">
        <thead><tr className="bg-surface-container-low">
          <th className="th">입고일</th><th className="th">품명</th><th className="th">업체</th><th className="th">LC개설처</th><th className="th text-right">단가</th>
          <th className="th text-right">입고량</th><th className="th">공정</th><th className="th">계약 연결</th><th className="th text-right">재고</th><th className="th"></th>
        </tr></thead>
        <tbody>
          {lots.map((l: Lot) => {
            const imp = l.import_id ? importById.get(l.import_id) : null;
            const s = stats.get(l.id);
            return (
              <tr key={l.id} className="border-t border-outline-variant">
                <td className="td font-mono text-xs">{l.in_date}</td>
                <td className="td font-medium">{l.material}</td>
                <td className="td text-xs">{l.supplier || "-"}</td>
                <td className="td text-xs">{l.buyer || "-"}</td>
                <td className="td text-right text-xs">{l.unit_price ? `${l.currency || ""} ${f2(l.unit_price)}` : "-"}</td>
                <td className="td text-right">{f2(l.qty)}</td>
                <td className="td text-xs">{[l.plant, l.process].filter(Boolean).join(" · ") || l.process_note || "-"}</td>
                <td className="td text-xs">{imp ? <span className="text-success">✓ {imp.contract_date || ""} {imp.material_name}</span>
                  : <button className="text-primary hover:underline" onClick={() => onEdit(l)}>연결하기</button>}</td>
                <td className="td text-right">{s.remain > 0.001 ? <b className="text-primary">{f2(s.remain)}</b> : <span className="text-on-surface-variant">소진</span>}</td>
                <td className="td whitespace-nowrap text-right">
                  <button className="text-xs text-primary hover:underline" onClick={() => onInput(l)}>투입</button>
                  <button className="ml-2 text-xs text-primary hover:underline" onClick={() => onEdit(l)}>수정</button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr className="border-t-2 border-outline-variant bg-surface-container-low">
          <td className="td font-bold" colSpan={5}>합계 ({lots.length}건)</td><td className="td text-right font-bold">{f2(total)}</td><td className="td" colSpan={4}></td>
        </tr></tfoot>
      </table>
    </div>
  );
}

// ---------- 출고 기록 ----------
function OutTab({ outs, onEdit }: any) {
  if (!outs.length) return <Empty text="출고 기록이 없습니다" icon="local_shipping" />;
  const total = outs.filter((o: Move) => o.status === "done").reduce((a: number, o: Move) => a + num(o.qty), 0);
  return (
    <div className="card overflow-x-auto">
      <table className="table-compact w-full min-w-[760px]">
        <thead><tr className="bg-surface-container-low">
          <th className="th">출고일</th><th className="th">출고품명</th><th className="th text-right">출고량</th><th className="th">납품업체</th>
          <th className="th">상차지</th><th className="th">상태</th><th className="th">메모</th><th className="th"></th>
        </tr></thead>
        <tbody>
          {outs.map((o: Move) => (
            <tr key={o.id} className="border-t border-outline-variant">
              <td className="td font-mono text-xs">{o.move_date}</td>
              <td className="td">{o.product || "-"}</td>
              <td className="td text-right font-medium">{f2(o.qty)}</td>
              <td className="td">{o.customer || "-"}</td>
              <td className="td">{o.load_site || "-"}</td>
              <td className="td"><span className={`badge ${ST_STYLE[o.status]}`}>{ST_LABEL[o.status] || o.status}</span></td>
              <td className="td max-w-[220px] truncate text-xs text-on-surface-variant">{o.note || ""}</td>
              <td className="td text-right"><button className="text-xs text-primary hover:underline" onClick={() => onEdit(o)}>수정</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t-2 border-outline-variant bg-surface-container-low">
          <td className="td font-bold" colSpan={2}>출고 완료 합계</td><td className="td text-right font-bold">{f2(total)}</td><td className="td" colSpan={5}></td>
        </tr></tfoot>
      </table>
    </div>
  );
}

// ---------- 일정 ----------
function PlanTab({ lots, moves, imports, stats, onInput, onOut }: any) {
  const t = today();
  const limit = new Date(Date.now() + 45 * 86400000).toLocaleDateString("sv-SE");
  const linked = new Set(lots.map((l: Lot) => l.import_id).filter(Boolean));
  type Ev = { date: string; kind: string; color: string; title: string; sub?: string; act?: () => void };
  const ev: Ev[] = [];
  for (const i of imports) {
    if (!i.eta || linked.has(i.id) || ["stored", "done", "delivered"].includes(i.status)) continue;
    if (i.eta < new Date(Date.now() - 14 * 86400000).toLocaleDateString("sv-SE") || i.eta > limit) continue;
    ev.push({ date: i.eta, kind: "입항 예정", color: "bg-primary text-on-primary", title: `${i.material_name} ${f2(i.quantity)}${i.unit || "MT"}`,
      sub: [i.supplier, i.lc_bank, i.bl_no ? `BL ${i.bl_no}` : ""].filter(Boolean).join(" · ") });
  }
  for (const l of lots) {
    if (!l.free_until || l.free_until > limit || stats.get(l.id).remain <= 0.001) continue;
    ev.push({ date: l.free_until, kind: "프리타임 만료", color: "bg-error text-on-error", title: `${l.material} 잔여 ${f2(stats.get(l.id).remain)}MT`,
      sub: [l.supplier, l.plant].filter(Boolean).join(" · "), act: () => onInput(l) });
  }
  for (const m of moves) {
    if (m.status === "done") continue;
    const lot = lots.find((l: Lot) => l.id === m.lot_id);
    if (m.kind === "input") ev.push({ date: m.move_date, kind: m.status === "doing" ? "투입 진행" : "투입 예정", color: "bg-tertiary text-on-tertiary",
      title: `${lot?.material || "입고 건"} ${f2(m.qty)}MT → ${m.plant || ""} ${m.process || ""}`, sub: m.note, act: () => lot && onInput(lot) });
    else ev.push({ date: m.move_date, kind: "출고 예정", color: "bg-secondary text-on-secondary",
      title: `${m.product || "출고"} ${f2(m.qty)}MT → ${m.customer || ""}`, sub: [m.load_site && `상차지 ${m.load_site}`, m.note].filter(Boolean).join(" · "), act: () => onOut(m) });
  }
  ev.sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map<string, Ev[]>();
  for (const e of ev) groups.set(e.date, [...(groups.get(e.date) || []), e]);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">앞으로 45일: 입항 예정(입고 전 계약 건) · 프리타임 만료 · 공장투입 예정/진행 · 출고 예정</p>
        <button className="btn-secondary" onClick={() => onOut({ kind: "out", move_date: t, status: "plan" })}>+ 출고 예정 추가</button>
      </div>
      {!ev.length ? <Empty text="예정된 일정이 없습니다" icon="event" /> : (
        <div className="space-y-3">
          {[...groups.entries()].map(([d, list]) => (
            <div key={d} className="card flex gap-4 px-4 py-3">
              <div className="w-24 shrink-0">
                <div className="font-mono text-sm font-bold">{d.slice(5).replace("-", "/")}</div>
                <div className={`text-xs ${d < t ? "text-error" : "text-on-surface-variant"}`}>{dday(d)}</div>
              </div>
              <div className="flex-1 space-y-1.5">
                {list.map((e, i) => (
                  <div key={i} className={`flex items-center gap-2 text-sm ${e.act ? "cursor-pointer hover:underline" : ""}`} onClick={e.act}>
                    <span className={`badge shrink-0 ${e.color}`}>{e.kind}</span>
                    <span className="font-medium">{e.title}</span>
                    {e.sub && <span className="truncate text-xs text-on-surface-variant">{e.sub}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 계약별 입고 ----------
function ContractTab({ imports, lots, onPick }: any) {
  const recv = new Map<number, number>();
  for (const l of lots) if (l.import_id) recv.set(l.import_id, (recv.get(l.import_id) || 0) + num(l.qty));
  const list = [...imports].sort((a, b) => (b.contract_date || b.eta || "").localeCompare(a.contract_date || a.eta || ""));
  return (
    <div className="card overflow-x-auto">
      <table className="table-compact w-full min-w-[900px]">
        <thead><tr className="bg-surface-container-low">
          <th className="th">계약일</th><th className="th">품명</th><th className="th">공급사</th><th className="th">LC개설처</th><th className="th text-right">단가</th>
          <th className="th text-right">계약량</th><th className="th text-right">입고 누계</th><th className="th text-right">잔량</th><th className="th">ETA</th><th className="th"></th>
        </tr></thead>
        <tbody>
          {list.map((i: any) => {
            const r = recv.get(i.id) || 0;
            const left = num(i.quantity) - r;
            return (
              <tr key={i.id} className="border-t border-outline-variant">
                <td className="td font-mono text-xs">{i.contract_date || "-"}</td>
                <td className="td font-medium">{i.material_name}</td>
                <td className="td text-xs">{i.supplier || "-"}</td>
                <td className="td text-xs font-medium">{i.lc_bank || "-"}</td>
                <td className="td text-right text-xs">{i.unit_price ? `${i.currency || ""} ${f2(i.unit_price)}` : "-"}</td>
                <td className="td text-right">{f2(i.quantity)}</td>
                <td className="td text-right">{r ? f2(r) : "-"}</td>
                <td className={`td text-right font-bold ${r && left <= 0.5 ? "text-success" : "text-primary"}`}>{r && left <= 0.5 ? "완료" : f2(left)}</td>
                <td className="td font-mono text-xs">{i.eta || "-"}</td>
                <td className="td text-right"><button className="text-xs text-primary hover:underline" onClick={() => onPick(i)}>+ 입고</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 입고 등록/수정 ----------
function tokens(s: string) {
  return (s || "").toLowerCase().split(/[^0-9a-z가-힣]+/).filter((w) => w.length >= 2);
}
function LotModal({ lot, imports, lots, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({ ...lot });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const recv = (id: number) => lots.filter((l: Lot) => l.import_id === id && l.id !== f.id).reduce((a: number, l: Lot) => a + num(l.qty), 0);

  // 품명·업체 글자와 날짜가 가까운 계약을 먼저 추천
  const ranked = useMemo(() => {
    const tk = new Set(tokens([f.material, f.supplier, f.buyer, f.note, f.process_note].join(" ")));
    const base = f.in_date ? new Date(f.in_date).getTime() : Date.now();
    return [...imports].map((i: any) => {
      const it = tokens([i.material_name, i.supplier, i.lc_bank].join(" "));
      let score = it.filter((w) => [...tk].some((t) => t.includes(w) || w.includes(t))).length * 10;
      const d = i.eta || i.contract_date;
      if (d) score -= Math.min(30, Math.abs(new Date(d).getTime() - base) / 86400000 / 10);
      return { i, score };
    }).sort((a, b) => b.score - a.score);
  }, [imports, f.material, f.supplier, f.in_date]);
  const sel = f.import_id ? imports.find((i: any) => i.id === Number(f.import_id)) : null;

  function pickImport(id: string) {
    if (!id) { setF({ ...f, import_id: null }); return; }
    const imp = imports.find((i: any) => i.id === Number(id));
    setF({ ...f, ...fromImport(imp), material: f.material || imp.material_name });
  }
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, qty: num(f.qty), unit_price: f.unit_price === "" || f.unit_price == null ? null : num(f.unit_price), import_id: f.import_id ? Number(f.import_id) : null };
      if (f.id) await api.put(`/stock/lots/${f.id}`, body); else await api.post("/stock/lots", body);
      onSaved();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("이 입고 기록과 연결된 공장투입 기록을 함께 삭제할까요?")) return;
    await api.del(`/stock/lots/${f.id}`); onSaved();
  }

  return (
    <Modal open onClose={onClose} title={f.id ? "입고 수정" : "입고 등록"} wide>
      <div className="space-y-3">
        <Field label="계약 건 연결 (선택하면 업체·LC개설처·단가가 채워집니다)">
          <select className="input" value={f.import_id || ""} onChange={(e) => pickImport(e.target.value)}>
            <option value="">— 연결 안 함 —</option>
            {ranked.map(({ i }, n) => (
              <option key={i.id} value={i.id}>{n < 5 && !f.import_id ? "★ " : ""}{i.contract_date || "날짜없음"} · {i.material_name} · {i.supplier || "-"} · {i.lc_bank || "-"} · {f2(i.quantity)}MT</option>
            ))}
          </select>
          {sel && <p className="mt-1 text-xs text-on-surface-variant">계약 {f2(sel.quantity)}MT · 이미 입고 {f2(recv(sel.id))}MT · <b className="text-primary">잔량 {f2(num(sel.quantity) - recv(sel.id))}MT</b>{sel.eta ? ` · ETA ${sel.eta}` : ""}</p>}
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="입고일 (DO)"><input type="date" className="input" value={f.in_date || ""} onChange={set("in_date")} /></Field>
          <div className="col-span-2"><Field label="품명"><input className="input" value={f.material || ""} onChange={set("material")} placeholder="예) BP-N" /></Field></div>
          <Field label="입고량 (MT)"><input className="input" inputMode="decimal" value={f.qty ?? ""} onChange={set("qty")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="공급업체"><input className="input" value={f.supplier || ""} onChange={set("supplier")} /></Field>
          <Field label="LC/TT 개설처"><input className="input" value={f.buyer || ""} onChange={set("buyer")} placeholder="HFS, KSL…" /></Field>
          <Field label="단가"><input className="input" inputMode="decimal" value={f.unit_price ?? ""} onChange={set("unit_price")} /></Field>
          <Field label="통화"><select className="input" value={f.currency || "USD"} onChange={set("currency")}><option>USD</option><option>KRW</option><option>EUR</option></select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="가공처 / 보관"><input className="input" list="plants" value={f.plant || ""} onChange={set("plant")} /></Field>
          <Field label="공정"><input className="input" list="procs" value={f.process || ""} onChange={set("process")} /></Field>
          <Field label="프리타임 만료일"><input type="date" className="input" value={f.free_until || ""} onChange={set("free_until")} /></Field>
          <Field label="컨테이너/차량"><input className="input" value={f.container_info || ""} onChange={set("container_info")} placeholder="대수, 번호 등" /></Field>
        </div>
        {f.process_note && <p className="text-xs text-on-surface-variant">엑셀 원래 공정 표기: {f.process_note}</p>}
        <Field label="메모"><textarea className="input" rows={2} value={f.note || ""} onChange={set("note")} /></Field>
        <datalist id="plants">{PLANTS.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="procs">{PROCESSES.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="flex justify-end gap-2 pt-1">
          {f.id && <button className="btn-secondary mr-auto !text-error" onClick={remove}>삭제</button>}
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" disabled={busy || !f.in_date || !f.material || !(num(f.qty) > 0)} onClick={save}>저장</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- 공장투입 ----------
function InputModal({ lot, stats, onClose, onChanged }: any) {
  const [f, setF] = useState<any>({ move_date: today(), qty: stats.remain || "", plant: lot.plant || "", process: lot.process || "", status: "doing" });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function add() {
    setBusy(true);
    try {
      await api.post("/stock/moves", { ...f, kind: "input", lot_id: lot.id, qty: num(f.qty), loss_pct: f.loss_pct === "" || f.loss_pct == null ? null : num(f.loss_pct) });
      setF({ ...f, qty: "" }); await onChanged();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function setStatus(m: Move, status: string) { await api.put(`/stock/moves/${m.id}`, { status }); onChanged(); }
  async function del(m: Move) { if (confirm("이 투입 기록을 삭제할까요?")) { await api.del(`/stock/moves/${m.id}`); onChanged(); } }

  return (
    <Modal open onClose={onClose} title="공장투입" wide>
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-container-low px-4 py-3 text-sm">
          <div className="font-medium">{lot.in_date} · {lot.material} <span className="text-on-surface-variant">{lot.supplier ? `· ${lot.supplier}` : ""}{lot.buyer ? ` · ${lot.buyer}` : ""}</span></div>
          <div className="mt-1 flex flex-wrap gap-4">
            <span>입고 <b>{f2(lot.qty)}</b></span><span className="text-success">투입완료 <b>{f2(stats.done)}</b></span>
            <span className="text-tertiary">진행 <b>{f2(stats.doing)}</b></span><span className="text-primary">재고 <b>{f2(stats.remain)}</b> MT</span>
            {stats.plan > 0 && <span className="text-on-surface-variant">예정 {f2(stats.plan)}</span>}
          </div>
        </div>

        {stats.ins.length > 0 && (
          <table className="table-compact w-full">
            <thead><tr className="bg-surface-container-low"><th className="th">일자</th><th className="th text-right">수량</th><th className="th">가공처 · 공정</th><th className="th">로스</th><th className="th">상태</th><th className="th"></th></tr></thead>
            <tbody>
              {stats.ins.map((m: Move) => (
                <tr key={m.id} className="border-t border-outline-variant">
                  <td className="td font-mono text-xs">{m.move_date}</td>
                  <td className="td text-right">{f2(m.qty)}</td>
                  <td className="td text-xs">{[m.plant, m.process].filter(Boolean).join(" · ") || "-"}{m.note ? <div className="text-on-surface-variant">{m.note}</div> : null}</td>
                  <td className="td text-xs">{m.loss_pct != null ? `${m.loss_pct}%` : "-"}</td>
                  <td className="td">
                    <div className="flex gap-1">{["plan", "doing", "done"].map((s) => (
                      <button key={s} onClick={() => setStatus(m, s)} className={`badge ${m.status === s ? ST_STYLE[s] : "border border-outline-variant bg-transparent text-on-surface-variant"}`}>{ST_LABEL[s]}</button>
                    ))}</div>
                  </td>
                  <td className="td text-right"><button className="text-xs text-error hover:underline" onClick={() => del(m)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="rounded-lg border border-outline-variant p-3">
          <div className="mb-2 text-sm font-medium">+ 투입 추가</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Field label="일자"><input type="date" className="input" value={f.move_date} onChange={set("move_date")} /></Field>
            <Field label="수량 (MT)"><input className="input" inputMode="decimal" value={f.qty} onChange={set("qty")} /></Field>
            <Field label="가공처"><input className="input" list="plants2" value={f.plant} onChange={set("plant")} /></Field>
            <Field label="공정"><input className="input" list="procs2" value={f.process} onChange={set("process")} /></Field>
            <Field label="로스 %"><input className="input" inputMode="decimal" value={f.loss_pct ?? ""} onChange={set("loss_pct")} placeholder="예) 3" /></Field>
            <Field label="상태"><select className="input" value={f.status} onChange={set("status")}>{["plan", "doing", "done"].map((s) => <option key={s} value={s}>{ST_LABEL[s]}</option>)}</select></Field>
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input flex-1" placeholder="메모 (탱크, 배치 등)" value={f.note || ""} onChange={set("note")} />
            <button className="btn-primary" disabled={busy || !(num(f.qty) > 0)} onClick={add}>추가</button>
          </div>
          <datalist id="plants2">{PLANTS.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="procs2">{PROCESSES.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div className="flex justify-end"><button className="btn-secondary" onClick={onClose}>닫기</button></div>
      </div>
    </Modal>
  );
}

// ---------- 출고 ----------
function OutModal({ mv, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({ ...mv });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true);
    try {
      const body = { ...f, kind: "out", qty: num(f.qty) };
      if (f.id) await api.put(`/stock/moves/${f.id}`, body); else await api.post("/stock/moves", body);
      onSaved();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  }
  async function remove() { if (confirm("이 출고 기록을 삭제할까요?")) { await api.del(`/stock/moves/${f.id}`); onSaved(); } }
  return (
    <Modal open onClose={onClose} title={f.id ? "출고 수정" : "출고 등록"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="출고일"><input type="date" className="input" value={f.move_date || ""} onChange={set("move_date")} /></Field>
          <Field label="상태"><select className="input" value={f.status || "done"} onChange={set("status")}><option value="plan">예정</option><option value="done">완료</option></select></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="출고품명"><input className="input" value={f.product || ""} onChange={set("product")} placeholder="예) 정제지방산" /></Field>
          <Field label="출고량 (MT)"><input className="input" inputMode="decimal" value={f.qty ?? ""} onChange={set("qty")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="납품업체"><input className="input" list="custs" value={f.customer || ""} onChange={set("customer")} /></Field>
          <Field label="상차지"><input className="input" list="plants3" value={f.load_site || ""} onChange={set("load_site")} /></Field>
        </div>
        <Field label="메모"><textarea className="input" rows={2} value={f.note || ""} onChange={set("note")} /></Field>
        <datalist id="custs">{CUSTOMERS.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="plants3">{PLANTS.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="flex justify-end gap-2">
          {f.id && <button className="btn-secondary mr-auto !text-error" onClick={remove}>삭제</button>}
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" disabled={busy || !f.move_date || !(num(f.qty) > 0)} onClick={save}>저장</button>
        </div>
      </div>
    </Modal>
  );
}
