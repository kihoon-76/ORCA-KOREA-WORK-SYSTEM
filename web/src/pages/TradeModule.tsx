import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, useList } from "../components/ui";

interface Config {
  kind: "import" | "export";
  title: string;
  subtitle: string;
  endpoint: string;       // /trade/imports | /trade/exports
  entityType: string;     // import | export
  partnerKey: "supplier" | "buyer";
  partnerLabel: string;
}

// 진행상황 공용 파이프라인 (수입/수출 동일)
const STAGES = [
  { v: "contracted", l: "계약" },
  { v: "shipped", l: "선적" },
  { v: "customs", l: "통관" },
  { v: "stored", l: "입고" },
  { v: "released", l: "출고" },
  { v: "settled", l: "정산완료" },
];
// 예전 상태값(도착/통관입고/멜팅/완료 등)도 파이프라인 어딘가에 매칭되도록
const LEGACY_STAGE: Record<string, number> = { arrived: 1, cleared: 3, melt_in: 2, melt_out: 3, delivered: 5, done: 5 };
function stageIdx(status: string) {
  const i = STAGES.findIndex((s) => s.v === status);
  return i >= 0 ? i : (LEGACY_STAGE[status] ?? 0);
}

const FILTER_COLS: { key: string; label: string }[] = [
  { key: "material_name", label: "원료명" },
  { key: "lc_bank", label: "LC개설" },
  { key: "vessel", label: "선박명" },
];

function uniqueOptions(items: any[], key: string) {
  const m = new Map<string, number>();
  for (const r of items) {
    const k = (r[key] || "").toString().trim();
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "ko"));
}

// 테이블 셀 바로 수정용 인라인 입력 (바깥 클릭으로 인한 행 펼치기 토글 방지 포함)
function EditableCell({ value, onCommit, type = "text", placeholder, className = "" }:
  { value: any; onCommit: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input
      type={type}
      placeholder={placeholder}
      className={`w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-slate-700 hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-400 ${className}`}
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (String(v) !== String(value ?? "")) onCommit(v); }}
    />
  );
}

function StagePipeline({ status, onSelect }: { status: string; onSelect: (v: string) => void }) {
  const cur = stageIdx(status);
  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      {STAGES.map((s, i) => (
        <div key={s.v} className="flex items-center">
          <button
            type="button"
            title={s.l}
            onClick={() => onSelect(s.v)}
            className={`whitespace-nowrap rounded-full px-2 py-1 text-[10.5px] font-bold transition ${
              i < cur ? "bg-brand-100 text-brand-700 hover:bg-brand-200"
              : i === cur ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-400 hover:bg-slate-200"
            }`}
          >
            {s.l}
          </button>
          {i < STAGES.length - 1 && <div className={`h-0.5 w-2 ${i < cur ? "bg-brand-300" : "bg-slate-200"}`} />}
        </div>
      ))}
    </div>
  );
}

function AttachmentPanel({ entityType, entityId, category, label }:
  { entityType: string; entityId: number; category: string; label: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState("");

  function load() {
    api.get(`/files/list?entity_type=${entityType}&entity_id=${entityId}&category=${category}`)
      .then((r) => setFiles(r.items || []));
  }
  useEffect(load, [entityType, entityId, category]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(list)) await api.upload(file, entityType, entityId, category, desc);
      setDesc("");
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  async function updateDesc(id: number, d: string) {
    try { await api.put(`/files/${id}`, { description: d }); load(); } catch (err: any) { alert(err.message); }
  }
  async function remove(id: number) {
    if (!confirm("삭제하시겠습니까? (파일함에 백업된 사본은 유지됩니다)")) return;
    await api.del(`/files/${id}`);
    load();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-semibold text-slate-600">{label}</div>
      <div className="mb-2 flex gap-2">
        <input className="input flex-1 text-xs" placeholder="파일 설명 (예: 선하증권 원본)"
          value={desc} onChange={(e) => setDesc(e.target.value)} />
        <label className="btn-secondary cursor-pointer whitespace-nowrap px-2.5 py-1.5 text-xs">
          {busy ? "업로드중..." : "파일 추가 (여러개 가능)"}
          <input type="file" multiple className="hidden" onChange={onUpload} disabled={busy} />
        </label>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-slate-400">첨부된 파일이 없습니다</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1.5 text-xs">
              <button className="shrink-0 max-w-[40%] truncate text-brand-600 hover:underline" onClick={() => api.download(f.id, f.file_name)} title={f.file_name}>
                {f.file_name}
              </button>
              <input
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-500 hover:border-slate-200 focus:border-brand-400 focus:bg-white focus:outline-none"
                defaultValue={f.description || ""}
                placeholder="이 파일에 대한 설명 추가"
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { if (e.target.value !== (f.description || "")) updateDesc(f.id, e.target.value); }}
              />
              <button className="shrink-0 text-slate-400 hover:text-red-500" onClick={() => remove(f.id)}>삭제</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TradeModule({ config }: { config: Config }) {
  const { items, loading, reload, setItems } = useList<any>(config.endpoint);
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<any>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [etaSort, setEtaSort] = useState<"asc" | "desc" | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const partnerFilterCols = [{ key: config.partnerKey, label: config.partnerLabel }, ...FILTER_COLS];

  let filtered = items.filter((r: any) => {
    for (const f of partnerFilterCols) {
      const sel = filters[f.key];
      if (sel && (r[f.key] || "").toString().trim() !== sel) return false;
    }
    if (filters.status && r.status !== filters.status) return false;
    return true;
  });
  if (etaSort) {
    filtered = [...filtered].sort((a, b) => {
      const av = a.eta || "", bv = b.eta || "";
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return etaSort === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function openNew() { setRow({ unit: "MT", currency: "USD" }); setOpen(true); }

  async function save() {
    const body: any = {
      ref_no: row.ref_no, material_name: row.material_name, lc_bank: row.lc_bank, lc_no: row.lc_no,
      quantity: num(row.quantity), unit: row.unit, unit_price: num(row.unit_price), currency: row.currency,
      vessel: row.vessel, etd: row.etd, eta: row.eta, note: row.note,
    };
    body[config.partnerKey] = row[config.partnerKey];
    await api.post(config.endpoint, body);
    setOpen(false);
    reload();
  }
  async function remove(r: any) {
    if (!confirm("삭제하시겠습니까?")) return;
    await api.del(`${config.endpoint}/${r.id}`);
    reload();
  }

  async function commitField(r: any, field: string, value: any) {
    let body: any;
    if (field === "quantity" || field === "unit_price") {
      body = {
        quantity: field === "quantity" ? num(value) : num(r.quantity),
        unit_price: field === "unit_price" ? num(value) : num(r.unit_price),
      };
    } else {
      body = { [field]: value === "" ? null : value };
    }
    try {
      const res = await api.put(`${config.endpoint}/${r.id}`, body);
      setItems((prev: any[]) => prev.map((x) => (x.id === r.id ? res.item : x)));
    } catch (e: any) {
      alert(e.message);
      reload();
    }
  }

  async function setStage(r: any, stageValue: string) {
    if (config.kind === "import" && stageValue === "stored" && r.status !== "stored") {
      if (!confirm(`${r.material_name} ${r.quantity ?? ""}${r.unit || ""} 을(를) 재고에 입고 처리할까요?`)) return;
      await api.post(`${config.endpoint}/${r.id}/receive`, {});
      reload();
    } else {
      await commitField(r, "status", stageValue);
    }
  }

  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle}
        action={<button className="btn-primary" onClick={openNew}>+ 신규 등록</button>} />
      {loading ? <Spinner /> : items.length === 0 ? <Empty /> : (
        <div className="card">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
            {partnerFilterCols.map((f) => {
              const opts = uniqueOptions(items, f.key);
              if (opts.length === 0) return null;
              return (
                <select key={f.key} className="input max-w-[11rem] text-xs"
                  value={filters[f.key] || ""} onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))}>
                  <option value="">{f.label} (전체)</option>
                  {opts.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
                </select>
              );
            })}
            <select className="input max-w-[9rem] text-xs" value={filters.status || ""}
              onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
              <option value="">진행상황 (전체)</option>
              {STAGES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
            {activeFilterCount > 0 && (
              <button className="text-xs text-brand-600 hover:underline" onClick={() => setFilters({})}>필터 초기화</button>
            )}
            <span className="ml-auto text-xs text-slate-400">{filtered.length}건 표시 (전체 {items.length}건)</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead><tr className="bg-slate-50">
              <th className="th">관리번호</th><th className="th">원료명</th><th className="th">{config.partnerLabel}</th>
              <th className="th">LC개설</th><th className="th">물량</th><th className="th">단가/총액</th>
              <th className="th">선박명</th><th className="th">ETD</th>
              <th className="th cursor-pointer select-none" onClick={() => setEtaSort((s) => s === "asc" ? "desc" : s === "desc" ? null : "asc")}>
                ETA {etaSort === "asc" ? "▲" : etaSort === "desc" ? "▼" : ""}
              </th>
              <th className="th">진행상황</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td className="td text-center text-slate-400" colSpan={11}>조건에 맞는 데이터가 없습니다</td></tr>
              ) : filtered.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                    <td className="td"><EditableCell value={r.ref_no} onCommit={(v) => commitField(r, "ref_no", v)} /></td>
                    <td className="td"><EditableCell value={r.material_name} onCommit={(v) => commitField(r, "material_name", v)} className="font-medium" /></td>
                    <td className="td"><EditableCell value={r[config.partnerKey]} onCommit={(v) => commitField(r, config.partnerKey, v)} /></td>
                    <td className="td">
                      <EditableCell value={r.lc_bank} onCommit={(v) => commitField(r, "lc_bank", v)} />
                      <EditableCell value={r.lc_no} placeholder="LC번호" onCommit={(v) => commitField(r, "lc_no", v)} className="text-xs text-slate-400" />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <EditableCell type="number" value={r.quantity} onCommit={(v) => commitField(r, "quantity", v)} className="w-16" />
                        <EditableCell value={r.unit} onCommit={(v) => commitField(r, "unit", v)} className="w-12" />
                      </div>
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-1">
                        <EditableCell value={r.currency} onCommit={(v) => commitField(r, "currency", v)} className="w-12" />
                        <EditableCell type="number" value={r.unit_price} onCommit={(v) => commitField(r, "unit_price", v)} className="w-16" />
                      </div>
                      <div className="px-1.5 text-xs text-slate-400">{r.total_price ? `총 ${r.currency} ${fmt(r.total_price)}` : ""}</div>
                    </td>
                    <td className="td"><EditableCell value={r.vessel} onCommit={(v) => commitField(r, "vessel", v)} /></td>
                    <td className="td"><EditableCell type="date" value={r.etd} onCommit={(v) => commitField(r, "etd", v)} /></td>
                    <td className="td"><EditableCell type="date" value={r.eta} onCommit={(v) => commitField(r, "eta", v)} /></td>
                    <td className="td"><StagePipeline status={r.status} onSelect={(v) => setStage(r, v)} /></td>
                    <td className="td text-right whitespace-nowrap">
                      <button className="text-xs text-red-500 hover:underline" onClick={(e) => { e.stopPropagation(); remove(r); }}>삭제</button>
                    </td>
                  </tr>
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={11} className="border-b border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <AttachmentPanel entityType={config.entityType} entityId={r.id} category="contract" label="📄 계약서" />
                          <AttachmentPanel entityType={config.entityType} entityId={r.id} category="shipping_docs" label="🚢 선적서류" />
                        </div>
                        {r.note && <p className="mt-3 text-xs text-slate-500">비고: {r.note}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="신규 등록" wide>
        {row && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="관리번호"><input className="input" value={row.ref_no || ""} onChange={(e) => setRow({ ...row, ref_no: e.target.value })} /></Field>
              <Field label="원료명"><input className="input" value={row.material_name || ""} onChange={(e) => setRow({ ...row, material_name: e.target.value })} /></Field>
              <Field label={config.partnerLabel}><input className="input" value={row[config.partnerKey] || ""} onChange={(e) => setRow({ ...row, [config.partnerKey]: e.target.value })} /></Field>
              <Field label="LC개설회사/은행"><input className="input" value={row.lc_bank || ""} onChange={(e) => setRow({ ...row, lc_bank: e.target.value })} /></Field>
              <Field label="LC번호"><input className="input" value={row.lc_no || ""} onChange={(e) => setRow({ ...row, lc_no: e.target.value })} /></Field>
              <Field label="물량"><input type="number" className="input" value={row.quantity ?? ""} onChange={(e) => setRow({ ...row, quantity: e.target.value })} /></Field>
              <Field label="단위"><input className="input" value={row.unit || ""} onChange={(e) => setRow({ ...row, unit: e.target.value })} /></Field>
              <Field label="통화"><input className="input" value={row.currency || ""} onChange={(e) => setRow({ ...row, currency: e.target.value })} /></Field>
              <Field label="단가"><input type="number" className="input" value={row.unit_price ?? ""} onChange={(e) => setRow({ ...row, unit_price: e.target.value })} /></Field>
              <Field label="선박명"><input className="input" value={row.vessel || ""} onChange={(e) => setRow({ ...row, vessel: e.target.value })} /></Field>
              <Field label="ETD (출항)"><input type="date" className="input" value={row.etd || ""} onChange={(e) => setRow({ ...row, etd: e.target.value })} /></Field>
              <Field label="ETA (도착)"><input type="date" className="input" value={row.eta || ""} onChange={(e) => setRow({ ...row, eta: e.target.value })} /></Field>
            </div>
            <Field label="비고"><textarea className="input" rows={2} value={row.note || ""} onChange={(e) => setRow({ ...row, note: e.target.value })} /></Field>
            <p className="text-xs text-slate-400">등록 후 목록에서 행을 클릭하면 계약서·선적서류를 바로 첨부할 수 있어요.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
              <button className="btn-primary" onClick={save} disabled={!row.material_name}>등록</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function num(v: any) { return v === "" || v == null ? null : Number(v); }
function fmt(v: number) { return Number(v).toLocaleString(); }
