import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Spinner, Modal, Icon, PageHeader } from "../components/ui";
import { AttachmentPanel } from "./TradeModule";

// ───────────────────────────────────────────────────────────────
// 정산 관리 — 바이어(HFS·KP HANSUK·DASAN BIO 등)가 대신 LC/TT를 열어 준 수입 건을
// 원료 수입현황 건과 1:1로 묶어서, 바이어가 보낸 정산서 숫자를 대조하고 단계별로 체크한다.
// ───────────────────────────────────────────────────────────────

const STEPS = [
  { key: "statement", label: "정산서 수령" },
  { key: "amount", label: "금액 대조" },
  { key: "invoice", label: "계산서 수령" },
  { key: "paid", label: "입금 완료" },
  { key: "final", label: "최종 확인" },
] as const;
type StepKey = typeof STEPS[number]["key"];

const MARGIN_LABEL: Record<string, string> = { pct: "%", usd_per_mt: "$/MT", krw_per_kg: "원/kg" };
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

function normKey(s: string) {
  return (s || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function num(v: any): number | null {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function won(n: number | null | undefined) {
  return n == null ? "-" : `₩${Math.round(n).toLocaleString()}`;
}
function fmt(n: number | null | undefined, d = 2) {
  if (n == null) return "-";
  return Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function md(v?: string | null) {
  if (!v) return "-";
  const [y, m, d] = String(v).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return v;
  return `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}
function ruleText(rule: { type: string; value: number } | null) {
  if (!rule) return "규칙 없음";
  if (rule.type === "pct") return `물대의 ${fmt(rule.value)}%`;
  if (rule.type === "usd_per_mt") return `$${fmt(rule.value)}/MT`;
  return `${fmt(rule.value)}원/kg`;
}

// 대조 결과 계산 — 정산서 숫자가 수입현황·마진 규칙과 맞는지
interface Check { label: string; ok: boolean | null; detail: string }
function computeChecks(imp: any, st: any, rule: { type: string; value: number } | null) {
  const checks: Check[] = [];
  if (!st) return { checks, mismatches: 0, expectedMargin: null as number | null, billed: null as number | null, paidSum: 0, balance: null as number | null };
  const tol = (a: number, b: number, rel = 0.002, abs = 1000) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
  const qty = num(st.st_qty), unit = num(st.st_unit_price), fx = num(st.st_fx), goods = num(st.st_goods_krw);
  const fees = num(st.st_fees_krw) ?? 0, margin = num(st.st_margin_krw), total = num(st.st_total_krw), grand = num(st.st_grand_krw);
  const sell = num(st.st_sell_unit);
  const basis = st.st_unit_basis || (imp.currency === "KRW" ? "krw_kg" : "usd_mt");

  // 1) 단가 — 수입현황 계약 단가와
  if (unit != null && imp.unit_price != null) {
    const ok = Math.abs(unit - Number(imp.unit_price)) < 0.01;
    checks.push({ label: "단가", ok, detail: `정산서 ${fmt(unit)} / 수입현황 ${fmt(Number(imp.unit_price))}${basis === "usd_mt" ? " $/MT" : " 원/kg"}` });
  }
  // 2) 수량 — 수입현황 물량과 (BL 실제 수량이 조금 다를 수 있어 1%까지는 참고로만)
  if (qty != null && imp.quantity != null) {
    const diff = qty - Number(imp.quantity);
    const ok = Math.abs(diff) <= Number(imp.quantity) * 0.01 ? true : false;
    checks.push({ label: "수량", ok: Math.abs(diff) < 0.001 ? true : ok ? null : false, detail: `정산서 ${fmt(qty, 3)} MT / 수입현황 ${fmt(Number(imp.quantity), 3)} MT${Math.abs(diff) >= 0.001 ? ` (차이 ${diff > 0 ? "+" : ""}${fmt(diff, 3)})` : ""}` });
  }
  // 3) 물대 = 단가 × 수량 × 환율
  if (goods != null && unit != null && qty != null) {
    const calc = basis === "usd_mt" ? (fx != null ? unit * qty * fx : null) : unit * qty * 1000;
    if (calc != null) checks.push({ label: "물대 계산", ok: tol(goods, calc), detail: `정산서 ${won(goods)} / 계산 ${won(calc)}` });
  }
  // 4) 바이어 이익 — 규칙과
  let expectedMargin: number | null = null;
  if (rule && qty != null) {
    if (rule.type === "usd_per_mt") expectedMargin = fx != null ? rule.value * qty * fx : null;
    else if (rule.type === "krw_per_kg") expectedMargin = rule.value * qty * 1000;
    else if (rule.type === "pct" && goods != null) expectedMargin = goods * rule.value / 100;
  }
  const actualMargin = margin ?? (sell != null && unit != null && basis === "krw_kg" && qty != null ? (sell - unit) * qty * 1000 : null);
  if (actualMargin != null) {
    checks.push({
      label: "바이어 이익",
      ok: expectedMargin == null ? null : tol(actualMargin, expectedMargin, 0.005),
      detail: `정산서 ${won(actualMargin)}${expectedMargin != null ? ` / 규칙(${ruleText(rule)}) ${won(expectedMargin)}` : " · 규칙이 없어 비교 못 함"}`,
    });
  }
  // 5) 합계 = 물대 + 부대비용 + 이익
  if (total != null && goods != null && actualMargin != null) {
    const calc = goods + fees + actualMargin;
    checks.push({ label: "합계", ok: tol(total, calc), detail: `정산서 ${won(total)} / 물대+부대비용+이익 ${won(calc)}` });
  }
  const billed = grand ?? total;
  const paidSum = (st.payments || []).reduce((a: number, p: any) => a + (num(p.amount) || 0), 0);
  const balance = billed != null ? billed - paidSum : null;
  return { checks, mismatches: checks.filter((c) => c.ok === false).length, expectedMargin, billed, paidSum, balance };
}

// 엑셀 칸 → 글자. 날짜 서식이 특이하면 날짜가 숫자(엑셀 일련번호)로 나오므로 날짜일 수도 있다고 같이 적어준다.
function cellText(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= 40000 && v <= 55000) {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
      return `${v}(날짜라면 ${d})`;
    }
    return String(Math.round(v * 10000) / 10000);
  }
  return String(v);
}

// 파일 → 자동 읽기 요청 내용 (PDF·이미지는 그대로, 엑셀은 표를 글자로)
async function fileToExtractBody(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile, readSheetNames } = await import("read-excel-file");
    const sheets = await readSheetNames(file);
    let text = "";
    for (const sh of sheets) {
      const rows = await readXlsxFile(file, { sheet: sh });
      text += `### 시트: ${sh}\n`;
      for (const r of rows) {
        const cells = r.map((v: any) => cellText(v));
        if (cells.some((x) => x !== "")) text += cells.join("\t") + "\n";
      }
    }
    return { kind: "text", text, filename: file.name };
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) return { kind: "text", text: await file.text(), filename: file.name };
  const data: string = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return { kind: "pdf", data, filename: file.name };
  if (file.type.startsWith("image/")) return { kind: "image", data, media_type: file.type, filename: file.name };
  throw new Error("PDF, 이미지, 엑셀(.xlsx) 파일만 읽을 수 있어요");
}

// 자동 읽기 결과 1건 → 정산 저장용 필드
function itemToFields(it: any) {
  const fees = Array.isArray(it.fees) ? it.fees.filter((f: any) => f && f.name) : [];
  const feeDetail: Record<string, number> = {};
  for (const f of fees) feeDetail[f.name] = Number(f.amount) || 0;
  const feesTotal = it.fees_total_krw ?? (fees.length ? fees.reduce((a: number, f: any) => a + (Number(f.amount) || 0), 0) : null);
  const out: any = {
    st_unit_price: it.unit_price ?? null, st_unit_basis: it.unit_basis ?? null, st_qty: it.qty_mt ?? null, st_fx: it.fx_rate ?? null,
    st_goods_krw: it.goods_krw ?? null, st_fees_krw: feesTotal, st_fee_detail: fees.length ? feeDetail : null,
    st_margin_krw: it.margin_krw ?? null, st_sell_unit: it.sell_unit_krw_kg ?? null, st_total_krw: it.total_krw ?? null, st_grand_krw: it.grand_krw ?? null,
    invoice_date: it.invoice_date ?? null, due_date: it.due_date ?? null,
    remits: Array.isArray(it.remits) && it.remits.length ? it.remits : undefined,
    payments: Array.isArray(it.payments) && it.payments.length ? it.payments : undefined,
    extracted: it,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// 자동 읽기 결과를 어느 수입 건에 붙일지 추천 (BL번호 → 공급사+수량)
function suggestImport(it: any, rows: any[]) {
  const bl = normKey(it.bl_no || "");
  if (bl) {
    const hit = rows.find((r) => normKey(r.bl_no || "") === bl);
    if (hit) return hit.id;
  }
  const sup = normKey(it.supplier || "");
  const qty = Number(it.qty_mt) || 0;
  let best: any = null, bestScore = -1;
  for (const r of rows) {
    let score = 0;
    if (sup && normKey(r.supplier || "").includes(sup.split(" ")[0])) score += 2;
    if (qty && r.quantity && Math.abs(Number(r.quantity) - qty) <= Number(r.quantity) * 0.02) score += 2;
    if (it.material && normKey(r.material_name || "").includes(normKey(it.material).split(" ")[0])) score += 1;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 3 ? best.id : null;
}

// ───────────────────────── 페이지 ─────────────────────────
export default function Settlements() {
  const [imports, setImports] = useState<any[] | null>(null);
  const [settles, setSettles] = useState<Record<number, any>>({});
  const [buyers, setBuyers] = useState<any[]>([]);
  const [ai, setAi] = useState(false);
  const [buyerFilter, setBuyerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("todo");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  function load() {
    api.get("/trade/imports").then((r) => setImports(r.items || []));
    api.get("/settle").then((r) => {
      const m: Record<number, any> = {};
      for (const s of r.items || []) m[s.import_id] = s;
      setSettles(m);
      setBuyers(r.buyers || []);
      setAi(!!r.ai);
    });
  }
  useEffect(load, []);

  const buyerRuleMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const b of buyers) m.set(b.buyer_key || normKey(b.name), b);
    return m;
  }, [buyers]);
  function ruleFor(imp: any, st: any) {
    if (st?.margin_type && st.margin_value != null) return { type: st.margin_type, value: Number(st.margin_value) };
    const b = buyerRuleMap.get(normKey(st?.buyer || imp.lc_bank || ""));
    return b ? { type: b.margin_type, value: Number(b.margin_value) } : null;
  }

  // 바이어가 있는 수입 건만 정산 대상
  const rows = useMemo(() => (imports || [])
    .filter((r) => (r.lc_bank || "").trim())
    .map((imp) => {
      const st = settles[imp.id] || null;
      const rule = ruleFor(imp, st);
      const res = computeChecks(imp, st, rule);
      const steps = st?.steps || {};
      const hasStatement = !!st && (st.st_total_krw != null || st.st_grand_krw != null || st.st_goods_krw != null);
      const status = steps.final ? "done" : !hasStatement && !steps.statement ? "waiting" : res.mismatches > 0 ? "diff" : !steps.paid ? "unpaid" : "check";
      return { imp, st, rule, res, steps, status };
    })
    .sort((a, b) => String(b.imp.eta || b.imp.contract_date || "").localeCompare(String(a.imp.eta || a.imp.contract_date || ""))),
  [imports, settles, buyerRuleMap]);

  const buyerNames = useMemo(() => {
    const m = new Map<string, { name: string; open: number }>();
    for (const r of rows) {
      const k = normKey(r.imp.lc_bank);
      const e = m.get(k) || { name: r.imp.lc_bank.trim(), open: 0 };
      if (r.status !== "done") e.open++;
      m.set(k, e);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].open - a[1].open);
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (buyerFilter && normKey(r.imp.lc_bank) !== buyerFilter) return false;
    if (statusFilter === "todo" && r.status === "done") return false;
    if (statusFilter !== "todo" && statusFilter !== "all" && r.status !== statusFilter) return false;
    if (q) {
      const t = normKey(q);
      if (![r.imp.material_name, r.imp.supplier, r.imp.bl_no, r.imp.lc_bank].some((x) => normKey(x || "").includes(t))) return false;
    }
    return true;
  });

  const kpi = useMemo(() => {
    const scope = rows.filter((r) => !buyerFilter || normKey(r.imp.lc_bank) === buyerFilter);
    return {
      waiting: scope.filter((r) => r.status === "waiting").length,
      diff: scope.filter((r) => r.status === "diff").length,
      unpaidCount: scope.filter((r) => r.status !== "done" && r.res.balance != null && r.res.balance > 1000).length,
      unpaidSum: scope.filter((r) => r.status !== "done" && r.res.balance != null && r.res.balance > 1000).reduce((a, r) => a + (r.res.balance || 0), 0),
      finalWait: scope.filter((r) => r.status === "check" || r.status === "unpaid").length,
    };
  }, [rows, buyerFilter]);

  if (!imports) return <Spinner />;
  const openRow = rows.find((r) => r.imp.id === openId) || null;

  function patchSettle(item: any) {
    setSettles((p) => ({ ...p, [item.import_id]: item }));
  }

  return (
    <div className="space-y-5">
      <PageHeader title="정산 관리" subtitle="바이어 회사(HFS·KP HANSUK·DASAN BIO 등)가 보낸 정산서를 수입 건별로 대조하고, 단계별로 확인합니다"
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setRulesOpen(true)}>바이어 마진 규칙</button>
            <button className="btn-primary" onClick={() => setUploadOpen(true)}>📄 정산서 올리기 (자동 읽기)</button>
          </div>
        } />

      {/* 현황 숫자 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiBox label="정산서 대기" value={`${kpi.waiting}건`} onClick={() => setStatusFilter("waiting")} />
        <KpiBox label="금액 차이 있음" value={`${kpi.diff}건`} tone={kpi.diff ? "red" : undefined} onClick={() => setStatusFilter("diff")} />
        <KpiBox label="입금 남은 금액" value={won(kpi.unpaidSum)} sub={`${kpi.unpaidCount}건`} onClick={() => setStatusFilter("unpaid")} />
        <KpiBox label="최종 확인 대기" value={`${kpi.finalWait}건`} tone={kpi.finalWait ? "amber" : undefined} onClick={() => setStatusFilter("todo")} />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setBuyerFilter("")}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${!buyerFilter ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>전체 바이어</button>
        {buyerNames.map(([k, b]) => (
          <button key={k} onClick={() => setBuyerFilter(k)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${buyerFilter === k ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            {b.name}{b.open ? <span className={`ml-1 ${buyerFilter === k ? "text-white/80" : "text-amber-600"}`}>{b.open}</span> : null}
          </button>
        ))}
        <select className="input ml-auto w-auto py-1 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="todo">확인 필요 (최종 확인 전)</option>
          <option value="waiting">정산서 대기</option>
          <option value="diff">금액 차이 있음</option>
          <option value="unpaid">입금 대기</option>
          <option value="check">최종 확인 대기</option>
          <option value="done">확인 완료</option>
          <option value="all">전체</option>
        </select>
        <input className="input w-48 py-1 text-sm" placeholder="원료·공급사·BL 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* 목록 */}
      <div className="card overflow-x-auto">
        <table className="table-compact w-full min-w-[980px]">
          <thead className="border-b border-outline-variant bg-surface-container-low">
            <tr>
              <th className="th">ETA</th><th className="th">원료 · 공급사</th><th className="th text-right">물량</th><th className="th">바이어 · 마진</th>
              <th className="th text-right">청구액</th><th className="th">대조</th><th className="th text-right">입금 / 잔액</th><th className="th">진행</th><th className="th">최종 확인</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {filtered.map((r) => (
              <tr key={r.imp.id} className="cursor-pointer hover:bg-surface-container-low" onClick={() => setOpenId(r.imp.id)}>
                <td className="td whitespace-nowrap font-mono text-xs">{md(r.imp.eta)}</td>
                <td className="td">
                  <div className="font-bold">{r.imp.material_name}</div>
                  <div className="text-xs text-on-surface-variant">{r.imp.supplier || "-"}{r.imp.bl_no ? ` · BL ${r.imp.bl_no}` : ""}</div>
                </td>
                <td className="td whitespace-nowrap text-right">{r.imp.quantity != null ? `${fmt(Number(r.imp.quantity), 3)} ${r.imp.unit || "MT"}` : "-"}</td>
                <td className="td">
                  <div className="font-semibold">{r.imp.lc_bank}</div>
                  <div className="text-xs text-on-surface-variant">{r.imp.payment_type || ""} {ruleText(r.rule)}</div>
                </td>
                <td className="td whitespace-nowrap text-right">{r.res.billed != null ? won(r.res.billed) : <span className="text-xs text-on-surface-variant">정산서 없음</span>}</td>
                <td className="td whitespace-nowrap"><CheckSummary status={r.status} res={r.res} /></td>
                <td className="td whitespace-nowrap text-right text-xs">
                  {r.res.billed != null ? (
                    <>
                      <div>{won(r.res.paidSum)}</div>
                      <div className={r.res.balance != null && r.res.balance > 1000 ? "font-semibold text-amber-700" : "text-green-700"}>
                        {r.res.balance != null && r.res.balance > 1000 ? `잔액 ${won(r.res.balance)}` : "완납"}
                      </div>
                    </>
                  ) : "-"}
                </td>
                <td className="td"><StepDots steps={r.steps} /></td>
                <td className="td whitespace-nowrap text-xs">
                  {r.steps.final ? <span className="font-semibold text-green-700">✔ {r.steps.final.by}<br /><span className="font-normal text-on-surface-variant">{md(r.steps.final.at)}</span></span> : <span className="text-on-surface-variant">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="py-12 text-center text-sm text-on-surface-variant">조건에 맞는 정산 건이 없습니다</div>}
      </div>
      <p className="text-xs text-on-surface-variant">원료 수입현황에서 <b>구매자(Buyer)</b>가 입력된 건이 자동으로 여기에 나와요. 줄을 누르면 정산서 숫자 입력·대조·단계 체크를 할 수 있어요.</p>

      {openRow && (
        <SettleDetail row={openRow} buyers={buyers} ai={ai} onClose={() => setOpenId(null)} onSaved={patchSettle} />
      )}
      {rulesOpen && (
        <BuyerRules buyers={buyers} suggestions={buyerNames.map(([, b]) => b.name)} onClose={() => setRulesOpen(false)} onChanged={setBuyers} />
      )}
      {uploadOpen && (
        <BulkUpload ai={ai} rows={rows.map((r) => r.imp)} onClose={() => setUploadOpen(false)} onApplied={() => { setUploadOpen(false); load(); }} />
      )}
    </div>
  );
}

// ───────────────────────── 작은 조각들 ─────────────────────────
function KpiBox({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: "red" | "amber"; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="card p-3 text-left transition hover:shadow-md">
      <div className="text-xs text-on-surface-variant">{label}</div>
      <div className={`mt-0.5 text-xl font-bold ${tone === "red" ? "text-error" : tone === "amber" ? "text-amber-700" : "text-primary"}`}>{value}</div>
      {sub && <div className="text-[11px] text-on-surface-variant">{sub}</div>}
    </button>
  );
}

function CheckSummary({ status, res }: { status: string; res: any }) {
  if (status === "waiting") return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">정산서 대기</span>;
  if (res.mismatches > 0) return <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">⚠ 차이 {res.mismatches}개</span>;
  if (res.checks.length === 0) return <span className="text-xs text-on-surface-variant">대조할 숫자 없음</span>;
  return <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">✔ 일치</span>;
}

function StepDots({ steps }: { steps: any }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s) => {
        const done = !!steps?.[s.key];
        return (
          <span key={s.key} title={`${s.label}${done ? ` — ${steps[s.key].by} ${md(steps[s.key].at)}` : " — 아직"}`}
            className={`h-2.5 w-2.5 rounded-full ${done ? (s.key === "final" ? "bg-green-600" : "bg-secondary") : "border border-slate-300 bg-white"}`} />
        );
      })}
      <span className="ml-1 text-[11px] text-on-surface-variant">{STEPS.filter((s) => steps?.[s.key]).length}/5</span>
    </div>
  );
}

// ───────────────────────── 건별 상세 ─────────────────────────
function SettleDetail({ row, buyers, ai, onClose, onSaved }: { row: any; buyers: any[]; ai: boolean; onClose: () => void; onSaved: (item: any) => void }) {
  const { imp } = row;
  const st0 = row.st || {};
  const [f, setF] = useState<any>(() => ({
    st_unit_price: st0.st_unit_price ?? "", st_unit_basis: st0.st_unit_basis || (imp.currency === "KRW" ? "krw_kg" : "usd_mt"),
    st_qty: st0.st_qty ?? "", st_fx: st0.st_fx ?? "", st_goods_krw: st0.st_goods_krw ?? "",
    fees: Object.entries(st0.st_fee_detail || {}).map(([name, amount]) => ({ name, amount: String(amount) })),
    st_fees_krw: st0.st_fees_krw ?? "", st_margin_krw: st0.st_margin_krw ?? "", st_sell_unit: st0.st_sell_unit ?? "",
    st_total_krw: st0.st_total_krw ?? "", st_grand_krw: st0.st_grand_krw ?? "",
    invoice_date: st0.invoice_date || "", due_date: st0.due_date || "",
    remits: (st0.remits || []).map((x: any) => ({ date: x.date || "", amount: String(x.amount ?? ""), currency: x.currency || "USD" })),
    payments: (st0.payments || []).map((x: any) => ({ date: x.date || "", amount: String(x.amount ?? "") })),
    margin_type: st0.margin_type || "", margin_value: st0.margin_value ?? "",
    note: st0.note || "",
  }));
  const [steps, setSteps] = useState<any>(st0.steps || {});
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const set = (k: string, v: any) => { setF((p: any) => ({ ...p, [k]: v })); setDirty(true); };

  const feesSum = f.fees.length ? f.fees.reduce((a: number, x: any) => a + (num(x.amount) || 0), 0) : num(f.st_fees_krw);
  const draft = {
    ...st0,
    st_unit_price: num(f.st_unit_price), st_unit_basis: f.st_unit_basis, st_qty: num(f.st_qty), st_fx: num(f.st_fx),
    st_goods_krw: num(f.st_goods_krw), st_fees_krw: feesSum, st_margin_krw: num(f.st_margin_krw), st_sell_unit: num(f.st_sell_unit),
    st_total_krw: num(f.st_total_krw), st_grand_krw: num(f.st_grand_krw),
    payments: f.payments.filter((p: any) => num(p.amount) != null).map((p: any) => ({ date: p.date || null, amount: num(p.amount) })),
    margin_type: f.margin_type || null, margin_value: f.margin_type ? num(f.margin_value) : null,
  };
  const buyerRule = buyers.find((b) => (b.buyer_key || normKey(b.name)) === normKey(imp.lc_bank || ""));
  const rule = draft.margin_type && draft.margin_value != null ? { type: draft.margin_type, value: draft.margin_value } : buyerRule ? { type: buyerRule.margin_type, value: Number(buyerRule.margin_value) } : null;
  const res = computeChecks(imp, draft, rule);

  async function save() {
    setSaving(true);
    try {
      const feeDetail: Record<string, number> = {};
      for (const x of f.fees) if (x.name && num(x.amount) != null) feeDetail[x.name] = num(x.amount)!;
      const r = await api.put(`/settle/${imp.id}`, {
        buyer: imp.lc_bank,
        st_unit_price: draft.st_unit_price, st_unit_basis: f.st_unit_basis, st_qty: draft.st_qty, st_fx: draft.st_fx,
        st_goods_krw: draft.st_goods_krw, st_fees_krw: draft.st_fees_krw, st_fee_detail: Object.keys(feeDetail).length ? feeDetail : null,
        st_margin_krw: draft.st_margin_krw, st_sell_unit: draft.st_sell_unit, st_total_krw: draft.st_total_krw, st_grand_krw: draft.st_grand_krw,
        invoice_date: f.invoice_date || null, due_date: f.due_date || null,
        remits: f.remits.filter((x: any) => num(x.amount) != null).map((x: any) => ({ date: x.date || null, amount: num(x.amount), currency: x.currency || "USD" })),
        payments: draft.payments,
        margin_type: draft.margin_type, margin_value: draft.margin_value, note: f.note || null,
      });
      onSaved(r.item);
      setDirty(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStep(key: StepKey) {
    const done = !steps[key];
    if (key === "final" && done && res.mismatches > 0 && !confirm(`대조 결과 차이가 ${res.mismatches}개 있어요. 그래도 최종 확인할까요?`)) return;
    if (dirty && !confirm("저장하지 않은 수정 내용이 있어요. 단계만 체크하고 수정 내용은 나중에 저장할까요?")) return;
    try {
      const r = await api.post(`/settle/${imp.id}/step`, { step: key, done });
      setSteps(r.item.steps || {});
      onSaved({ ...r.item });
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function autoRead(file: File) {
    setReading(true);
    try {
      const body = await fileToExtractBody(file);
      const r = await api.post("/settle/extract", body);
      const items: any[] = r.result?.items || [];
      if (!items.length) { alert("정산서에서 거래 내용을 찾지 못했어요"); return; }
      const idx = items.length === 1 ? 0 : Math.max(0, items.findIndex((it) => suggestImport(it, [imp]) === imp.id));
      const fields = itemToFields(items[idx]);
      setF((p: any) => ({
        ...p,
        st_unit_price: fields.st_unit_price ?? p.st_unit_price, st_unit_basis: fields.st_unit_basis || p.st_unit_basis,
        st_qty: fields.st_qty ?? p.st_qty, st_fx: fields.st_fx ?? p.st_fx, st_goods_krw: fields.st_goods_krw ?? p.st_goods_krw,
        fees: fields.st_fee_detail ? Object.entries(fields.st_fee_detail).map(([name, amount]) => ({ name, amount: String(amount) })) : p.fees,
        st_fees_krw: fields.st_fees_krw ?? p.st_fees_krw, st_margin_krw: fields.st_margin_krw ?? p.st_margin_krw, st_sell_unit: fields.st_sell_unit ?? p.st_sell_unit,
        st_total_krw: fields.st_total_krw ?? p.st_total_krw, st_grand_krw: fields.st_grand_krw ?? p.st_grand_krw,
        invoice_date: fields.invoice_date || p.invoice_date, due_date: fields.due_date || p.due_date,
        remits: fields.remits ? fields.remits.map((x: any) => ({ date: x.date || "", amount: String(x.amount ?? ""), currency: x.currency || "USD" })) : p.remits,
        payments: fields.payments ? fields.payments.map((x: any) => ({ date: x.date || "", amount: String(x.amount ?? "") })) : p.payments,
      }));
      setDirty(true);
      // 원본 정산서는 이 건의 정산서류에 함께 보관
      await api.upload(file, "import", imp.id, "settlement", "정산서 (자동 읽기)").catch(() => {});
      if (items.length > 1) alert(`정산서에 ${items.length}건이 있어서, 이 건과 가장 비슷한 1건을 채웠어요. 여러 건을 한 번에 넣으려면 목록 화면의 "정산서 올리기"를 써 주세요.`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setReading(false);
    }
  }

  const input = "input py-1 text-sm";
  return (
    <Modal open onClose={() => { if (!dirty || confirm("저장하지 않은 내용이 있어요. 닫을까요?")) onClose(); }} title={`${imp.material_name} 정산`} wide="xl">
      <div className="-mt-1 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-on-surface-variant">
        <span>공급사 <b className="text-on-surface">{imp.supplier || "-"}</b></span>
        <span>바이어 <b className="text-on-surface">{imp.lc_bank}</b> {imp.payment_type || ""}</span>
        <span>물량 <b className="text-on-surface">{imp.quantity != null ? `${fmt(Number(imp.quantity), 3)} ${imp.unit || "MT"}` : "-"}</b></span>
        <span>계약 단가 <b className="text-on-surface">{imp.unit_price != null ? `${imp.currency || "USD"} ${fmt(Number(imp.unit_price))}` : "-"}</b></span>
        {imp.bl_no && <span>BL <b className="text-on-surface">{imp.bl_no}</b></span>}
        <span>ETD {md(imp.etd)} → ETA {md(imp.eta)}</span>
      </div>

      {/* 단계 체크 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-low p-3">
        {STEPS.map((s, i) => {
          const d = steps[s.key];
          return (
            <button key={s.key} onClick={() => toggleStep(s.key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition ${d ? (s.key === "final" ? "border-green-600 bg-green-50" : "border-secondary bg-secondary-fixed/50") : "border-slate-200 bg-white hover:bg-slate-50"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${d ? (s.key === "final" ? "bg-green-600 text-white" : "bg-secondary text-white") : "border border-slate-300 text-slate-400"}`}>{d ? "✔" : i + 1}</span>
              <span>
                <span className="block font-semibold text-on-surface">{s.label}</span>
                <span className="block text-[10px] text-on-surface-variant">{d ? `${d.by} · ${md(d.at)}` : "누르면 체크"}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 정산서 숫자 */}
        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold text-primary">바이어 정산서 내용</h4>
            <label className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-semibold ${ai ? "border-secondary text-secondary hover:bg-secondary-fixed/40" : "border-slate-200 text-slate-400"}`}
              title={ai ? "PDF·이미지·엑셀 정산서를 올리면 숫자를 자동으로 채워요" : "자동 읽기 키가 아직 설정되지 않았어요"}>
              {reading ? "읽는 중…" : "📄 정산서 파일로 자동 채우기"}
              <input type="file" className="hidden" accept=".pdf,.xlsx,.csv,image/*" disabled={!ai || reading}
                onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) autoRead(file); }} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-on-surface-variant">매입 단가
              <div className="mt-1 flex gap-1">
                <input className={`${input} min-w-0 flex-1`} value={f.st_unit_price} onChange={(e) => set("st_unit_price", e.target.value)} />
                <select className={`${input} w-[76px] px-1`} value={f.st_unit_basis} onChange={(e) => set("st_unit_basis", e.target.value)}>
                  <option value="usd_mt">$/MT</option><option value="krw_kg">원/kg</option>
                </select>
              </div>
            </label>
            <label className="text-xs text-on-surface-variant">수량 (MT)<input className={`${input} mt-1`} value={f.st_qty} onChange={(e) => set("st_qty", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">적용 환율<input className={`${input} mt-1`} value={f.st_fx} disabled={f.st_unit_basis === "krw_kg"} onChange={(e) => set("st_fx", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">물대 (원)<input className={`${input} mt-1`} value={f.st_goods_krw} onChange={(e) => set("st_goods_krw", e.target.value)} /></label>
          </div>

          <div className="mt-3 rounded-lg border border-outline-variant p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-on-surface">부대비용</span>
              <span className="text-on-surface-variant">합계 <b className="text-on-surface">{won(feesSum)}</b></span>
            </div>
            {f.fees.map((x: any, i: number) => (
              <div key={i} className="mb-1 flex items-center gap-2">
                <input className={`${input} flex-1`} placeholder="항목 (예: LC 개설수수료)" value={x.name}
                  onChange={(e) => set("fees", f.fees.map((y: any, j: number) => (j === i ? { ...y, name: e.target.value } : y)))} />
                <input className={`${input} w-36 text-right`} placeholder="금액" value={x.amount}
                  onChange={(e) => set("fees", f.fees.map((y: any, j: number) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                <button className="text-slate-400 hover:text-red-500" onClick={() => set("fees", f.fees.filter((_: any, j: number) => j !== i))}><Icon name="close" size={16} /></button>
              </div>
            ))}
            <button className="text-xs font-semibold text-secondary hover:underline" onClick={() => set("fees", [...f.fees, { name: "", amount: "" }])}>+ 항목 추가</button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="text-xs text-on-surface-variant">바이어 이익 (원)<input className={`${input} mt-1`} value={f.st_margin_krw} onChange={(e) => set("st_margin_krw", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">판매 단가 (원/kg)<input className={`${input} mt-1`} placeholder="국내 건만" value={f.st_sell_unit} onChange={(e) => set("st_sell_unit", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">합계 (VAT 별도)<input className={`${input} mt-1`} value={f.st_total_krw} onChange={(e) => set("st_total_krw", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">VAT 포함 청구액<input className={`${input} mt-1`} value={f.st_grand_krw} onChange={(e) => set("st_grand_krw", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">계산서 일자<input type="date" className={`${input} mt-1`} value={f.invoice_date} onChange={(e) => set("invoice_date", e.target.value)} /></label>
            <label className="text-xs text-on-surface-variant">결제 예정일<input type="date" className={`${input} mt-1`} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} /></label>
            <label className="col-span-2 text-xs text-on-surface-variant">이 건만 마진 규칙 바꾸기
              <div className="mt-1 flex gap-1">
                <select className={`${input} w-32`} value={f.margin_type} onChange={(e) => set("margin_type", e.target.value)}>
                  <option value="">바이어 기본값</option><option value="pct">% (물대 기준)</option><option value="usd_per_mt">$/MT</option><option value="krw_per_kg">원/kg</option>
                </select>
                {f.margin_type && <input className={`${input} w-24`} value={f.margin_value} onChange={(e) => set("margin_value", e.target.value)} />}
                {!f.margin_type && <span className="self-center text-[11px]">{buyerRule ? ruleText({ type: buyerRule.margin_type, value: Number(buyerRule.margin_value) }) : "규칙 없음"}</span>}
              </div>
            </label>
          </div>
        </div>

        {/* 대조 결과 + 송금·입금 */}
        <div className="space-y-3 lg:col-span-2">
          <div className="rounded-lg border border-outline-variant p-3">
            <h4 className="mb-2 text-sm font-bold text-primary">대조 결과</h4>
            {res.checks.length === 0 ? (
              <p className="text-xs text-on-surface-variant">정산서 숫자를 넣으면 수입현황·마진 규칙과 자동으로 비교해요.</p>
            ) : (
              <ul className="space-y-1.5">
                {res.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2 text-xs">
                    <span className={`mt-0.5 shrink-0 font-bold ${c.ok === true ? "text-green-600" : c.ok === false ? "text-red-600" : "text-amber-600"}`}>{c.ok === true ? "✔" : c.ok === false ? "✖" : "△"}</span>
                    <span><b className="text-on-surface">{c.label}</b> <span className="text-on-surface-variant">{c.detail}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <MoneyList title="바이어 → 공급사 송금" items={f.remits} withCurrency
            onChange={(v) => set("remits", v)} />
          <MoneyList title="오르카 → 바이어 입금" items={f.payments}
            onChange={(v) => set("payments", v)}
            footer={res.billed != null ? (
              <div className="mt-1.5 flex justify-between border-t border-outline-variant pt-1.5 text-xs">
                <span className="text-on-surface-variant">청구 {won(res.billed)} · 입금 {won(res.paidSum)}</span>
                <b className={res.balance != null && res.balance > 1000 ? "text-amber-700" : "text-green-700"}>{res.balance != null && res.balance > 1000 ? `잔액 ${won(res.balance)}` : "완납"}</b>
              </div>
            ) : null} />
        </div>
      </div>

      <label className="mt-4 block text-xs text-on-surface-variant">메모
        <textarea className="input mt-1 min-h-[56px] text-sm" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="예: 통관일 환율 적용, 선임료 별도 청구 예정" />
      </label>
      <div className="mt-3 flex items-center justify-end gap-2">
        {dirty && <span className="text-xs text-amber-700">저장하지 않은 수정 내용이 있어요</span>}
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "저장 중..." : "정산 내용 저장"}</button>
      </div>

      <div className="mt-5">
        <AttachmentPanel entityType="import" entityId={imp.id} category="settlement" label="💰 정산서류 (정산서·계산서·송금증 등)" />
      </div>
    </Modal>
  );
}

function MoneyList({ title, items, onChange, withCurrency, footer }: {
  title: string; items: any[]; onChange: (v: any[]) => void; withCurrency?: boolean; footer?: React.ReactNode;
}) {
  const input = "input py-1 text-sm";
  return (
    <div className="rounded-lg border border-outline-variant p-3">
      <h4 className="mb-1.5 text-xs font-bold text-on-surface">{title}</h4>
      {items.map((x, i) => (
        <div key={i} className="mb-1 flex items-center gap-1.5">
          <input type="date" className={`${input} w-[140px]`} value={x.date} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} />
          {withCurrency && (
            <select className={`${input} w-[68px] px-1`} value={x.currency || "USD"} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, currency: e.target.value } : y)))}>
              <option>USD</option><option>KRW</option>
            </select>
          )}
          <input className={`${input} min-w-0 flex-1 text-right`} placeholder="금액" value={x.amount} onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
          <button className="text-slate-400 hover:text-red-500" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
        </div>
      ))}
      <button className="text-xs font-semibold text-secondary hover:underline" onClick={() => onChange([...items, { date: "", amount: "", ...(withCurrency ? { currency: "USD" } : {}) }])}>+ 추가</button>
      {footer}
    </div>
  );
}

// ───────────────────────── 바이어 마진 규칙 ─────────────────────────
function BuyerRules({ buyers, suggestions, onClose, onChanged }: { buyers: any[]; suggestions: string[]; onClose: () => void; onChanged: (b: any[]) => void }) {
  const known = new Set(buyers.map((b) => b.buyer_key || normKey(b.name)));
  const missing = suggestions.filter((n) => !known.has(normKey(n)));
  const [edit, setEdit] = useState<any>(null);

  async function save() {
    try {
      const r = await api.put("/settle/buyers", edit);
      onChanged(r.buyers);
      setEdit(null);
    } catch (e: any) {
      alert(e.message);
    }
  }
  async function remove(b: any) {
    if (!confirm(`${b.name}의 기본 마진 규칙을 지울까요?`)) return;
    await api.del(`/settle/buyers/${b.id}`);
    onChanged(buyers.filter((x) => x.id !== b.id));
  }

  return (
    <Modal open onClose={onClose} title="바이어별 기본 마진 규칙" wide>
      <p className="mb-3 text-xs text-on-surface-variant">회사마다 한 번 정해두면, 그 회사가 바이어인 모든 건의 정산서 이익을 이 규칙으로 대조해요. 예외인 건은 정산 상세에서 따로 바꿀 수 있어요.</p>
      {edit ? (
        <div className="rounded-lg bg-surface-container-low p-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-on-surface-variant sm:col-span-2">회사<input className="input mt-1 text-sm" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="text-xs text-on-surface-variant">결제 방식
              <select className="input mt-1 text-sm" value={edit.payment || ""} onChange={(e) => setEdit({ ...edit, payment: e.target.value })}>
                <option value="">-</option><option>LC</option><option>TT</option>
              </select>
            </label>
            <div />
            <label className="text-xs text-on-surface-variant">마진 방식
              <select className="input mt-1 text-sm" value={edit.margin_type} onChange={(e) => setEdit({ ...edit, margin_type: e.target.value })}>
                <option value="pct">% (물대 기준)</option><option value="usd_per_mt">$/MT</option><option value="krw_per_kg">원/kg</option>
              </select>
            </label>
            <label className="text-xs text-on-surface-variant">값 ({MARGIN_LABEL[edit.margin_type]})<input className="input mt-1 text-sm" value={edit.margin_value} onChange={(e) => setEdit({ ...edit, margin_value: e.target.value })} /></label>
            <label className="text-xs text-on-surface-variant sm:col-span-2">메모<input className="input mt-1 text-sm" value={edit.note || ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setEdit(null)}>취소</button>
            <button className="btn-primary" onClick={save}>저장</button>
          </div>
        </div>
      ) : (
        <>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-outline-variant">
              {buyers.map((b) => (
                <tr key={b.id}>
                  <td className="py-2 font-semibold">{b.name}</td>
                  <td className="py-2 text-xs text-on-surface-variant">{b.payment || ""}</td>
                  <td className="py-2">{ruleText({ type: b.margin_type, value: Number(b.margin_value) })}</td>
                  <td className="py-2 text-xs text-on-surface-variant">{b.note || ""}</td>
                  <td className="whitespace-nowrap py-2 text-right text-xs">
                    <button className="font-semibold text-secondary hover:underline" onClick={() => setEdit({ ...b })}>수정</button>
                    <button className="ml-3 text-slate-400 hover:text-red-500" onClick={() => remove(b)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {missing.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-on-surface-variant">규칙이 없는 바이어:</span>
              {missing.map((n) => (
                <button key={n} className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-100"
                  onClick={() => setEdit({ name: n, margin_type: "pct", margin_value: "2", payment: "" })}>+ {n}</button>
              ))}
            </div>
          )}
          <button className="btn-secondary mt-3" onClick={() => setEdit({ name: "", margin_type: "pct", margin_value: "2", payment: "" })}>+ 바이어 추가</button>
        </>
      )}
    </Modal>
  );
}

// ───────────────────────── 정산서 올리기 (여러 건 한 번에) ─────────────────────────
function BulkUpload({ ai, rows, onClose, onApplied }: { ai: boolean; rows: any[]; onClose: () => void; onApplied: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [picks, setPicks] = useState<{ importId: number | null; on: boolean }[]>([]);
  const [attach, setAttach] = useState(true);
  const [markStatement, setMarkStatement] = useState(true);
  const [applying, setApplying] = useState(false);

  async function read(fl: File) {
    setFile(fl);
    setReading(true);
    setResult(null);
    try {
      const body = await fileToExtractBody(fl);
      const r = await api.post("/settle/extract", body);
      const items: any[] = r.result?.items || [];
      setResult(r.result);
      setPicks(items.map((it) => { const id = suggestImport(it, rows); return { importId: id, on: !!id }; }));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setReading(false);
    }
  }

  async function apply() {
    if (!result || !file) return;
    setApplying(true);
    let ok = 0;
    try {
      const items: any[] = result.items || [];
      for (let i = 0; i < items.length; i++) {
        const p = picks[i];
        if (!p?.on || !p.importId) continue;
        const imp = rows.find((r) => r.id === p.importId);
        await api.put(`/settle/${p.importId}`, { buyer: imp?.lc_bank || null, ...itemToFields(items[i]) });
        if (markStatement) await api.post(`/settle/${p.importId}/step`, { step: "statement", done: true });
        if (attach) await api.upload(file, "import", p.importId, "settlement", "정산서 (자동 읽기)").catch(() => {});
        ok++;
      }
      alert(`${ok}건에 정산서 내용을 넣었어요. 각 건을 열어 대조 결과를 확인해 주세요.`);
      onApplied();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setApplying(false);
    }
  }

  if (!ai) {
    return (
      <Modal open onClose={onClose} title="정산서 자동 읽기 설정 필요">
        <div className="space-y-2 text-sm text-on-surface-variant">
          <p>정산서를 자동으로 읽으려면 Anthropic API 키를 사이트에 한 번 넣어야 해요. 넣기 전에도 각 건을 열어 숫자를 직접 입력하는 건 바로 쓸 수 있어요.</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>console.anthropic.com 에서 API 키를 만들어요 (사용한 만큼 소액 과금).</li>
            <li>Cloudflare 대시보드 → Workers &amp; Pages → 이 사이트 → 설정 → 변수 및 비밀(Variables and Secrets)</li>
            <li><b>ANTHROPIC_API_KEY</b> 이름으로 키를 <b>비밀(Secret)</b>로 추가하고 다시 배포해요.</li>
          </ol>
        </div>
      </Modal>
    );
  }

  const items: any[] = result?.items || [];
  return (
    <Modal open onClose={onClose} title="정산서 올리기 (자동 읽기)" wide="xl">
      {!result && (
        <label className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center ${reading ? "border-secondary bg-secondary-fixed/20" : "border-slate-300 hover:bg-slate-50"}`}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const fl = e.dataTransfer.files?.[0]; if (fl && !reading) read(fl); }}>
          <Icon name="upload_file" size={36} className="text-secondary" />
          <span className="mt-2 font-semibold text-primary">{reading ? `"${file?.name}" 읽는 중… (10~30초 정도 걸려요)` : "바이어가 보낸 정산서를 끌어다 놓거나 눌러서 고르세요"}</span>
          <span className="mt-1 text-xs text-on-surface-variant">PDF · 이미지 · 엑셀(.xlsx) — 한 파일에 여러 건(BL)이 있어도 건별로 나눠서 읽어요</span>
          <input type="file" className="hidden" accept=".pdf,.xlsx,.csv,image/*" disabled={reading}
            onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ""; if (fl) read(fl); }} />
        </label>
      )}

      {result && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span><b>{file?.name}</b> · {result.issuer ? `${result.issuer} · ` : ""}{items.length}건 읽음</span>
            <button className="text-xs font-semibold text-secondary hover:underline" onClick={() => { setResult(null); setFile(null); }}>다른 파일</button>
          </div>
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[900px] text-sm">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr><th className="th">적용</th><th className="th">정산서 내용</th><th className="th text-right">수량</th><th className="th text-right">단가 · 환율</th><th className="th text-right">이익</th><th className="th text-right">청구액</th><th className="th">붙일 수입 건</th></tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {items.map((it, i) => (
                  <tr key={i} className={picks[i]?.on ? "" : "opacity-60"}>
                    <td className="td"><input type="checkbox" checked={!!picks[i]?.on} disabled={!picks[i]?.importId}
                      onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /></td>
                    <td className="td">
                      <div className="font-semibold">{it.material || "-"} <span className="font-normal text-on-surface-variant">{it.supplier || ""}</span></div>
                      <div className="text-xs text-on-surface-variant">{it.bl_no ? `BL ${it.bl_no}` : ""}{it.buyer ? ` · ${it.buyer}` : ""}{it.invoice_date ? ` · 계산서 ${it.invoice_date}` : ""}</div>
                    </td>
                    <td className="td whitespace-nowrap text-right">{it.qty_mt != null ? `${fmt(it.qty_mt, 3)} MT` : "-"}</td>
                    <td className="td whitespace-nowrap text-right text-xs">{it.unit_price != null ? `${fmt(it.unit_price)} ${it.unit_basis === "krw_kg" ? "원/kg" : "$/MT"}` : "-"}<br />{it.fx_rate ? `환율 ${fmt(it.fx_rate)}` : ""}</td>
                    <td className="td whitespace-nowrap text-right text-xs">{it.margin_krw != null ? won(it.margin_krw) : "-"}<br /><span className="text-on-surface-variant">{it.margin_note || ""}</span></td>
                    <td className="td whitespace-nowrap text-right">{won(it.grand_krw ?? it.total_krw)}</td>
                    <td className="td">
                      <select className="input w-64 py-1 text-xs" value={picks[i]?.importId ?? ""}
                        onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setPicks((p) => p.map((x, j) => (j === i ? { importId: v, on: !!v } : x))); }}>
                        <option value="">— 수입 건 선택 —</option>
                        {rows.map((r) => (
                          <option key={r.id} value={r.id}>{md(r.eta)} {r.material_name} · {r.supplier || "-"} · {r.quantity ?? "-"}MT · {r.lc_bank}{r.bl_no ? ` · ${r.bl_no}` : ""}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> 원본 파일을 각 건 정산서류에 첨부</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={markStatement} onChange={(e) => setMarkStatement(e.target.checked)} /> "정산서 수령" 단계 체크</label>
            <span className="text-on-surface-variant">BL번호나 공급사·수량이 맞는 건을 자동으로 골라 뒀어요. 틀리면 직접 바꿔 주세요.</span>
            <button className="btn-primary ml-auto" disabled={applying || !picks.some((p) => p.on && p.importId)} onClick={apply}>
              {applying ? "넣는 중..." : `선택한 ${picks.filter((p) => p.on && p.importId).length}건에 넣기`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
