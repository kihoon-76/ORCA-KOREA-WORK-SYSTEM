import { useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Badge, Empty, Modal, Field, useList, FileManager } from "../components/ui";

interface Config {
  kind: "import" | "export";
  title: string;
  subtitle: string;
  endpoint: string;       // /trade/imports | /trade/exports
  entityType: string;     // import | export
  partnerKey: "supplier" | "buyer";
  partnerLabel: string;
}

const STATUS_OPTIONS = [
  { v: "contracted", l: "계약" }, { v: "shipped", l: "선적" }, { v: "arrived", l: "도착" },
  { v: "cleared", l: "통관/입고" }, { v: "done", l: "완료" },
];

export default function TradeModule({ config }: { config: Config }) {
  const { items, loading, reload } = useList<any>(config.endpoint);
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<any>(null);

  function openNew() { setRow({ status: "contracted", unit: "MT", currency: "USD" }); setOpen(true); }
  function openEdit(r: any) { setRow({ ...r }); setOpen(true); }

  async function save() {
    const body: any = {
      ref_no: row.ref_no, material_name: row.material_name, lc_bank: row.lc_bank, lc_no: row.lc_no,
      quantity: num(row.quantity), unit: row.unit, unit_price: num(row.unit_price), currency: row.currency,
      vessel: row.vessel, etd: row.etd, eta: row.eta, status: row.status, note: row.note,
    };
    body[config.partnerKey] = row[config.partnerKey];
    let saved = row;
    if (row.id) { const r = await api.put(`${config.endpoint}/${row.id}`, body); saved = r.item; }
    else { const r = await api.post(config.endpoint, body); saved = r.item; }
    setRow(saved); // 저장 후 같은 모달 유지 -> 파일 첨부 가능
    reload();
  }
  async function remove(r: any) { if (confirm("삭제하시겠습니까?")) { await api.del(`${config.endpoint}/${r.id}`); reload(); } }
  async function receive(r: any) {
    if (!confirm(`${r.material_name} ${r.quantity}${r.unit} 을(를) 재고에 입고 처리할까요?`)) return;
    await api.post(`${config.endpoint}/${r.id}/receive`, {}); reload();
  }

  return (
    <div>
      <PageHeader title={config.title} subtitle={config.subtitle}
        action={<button className="btn-primary" onClick={openNew}>+ 신규 등록</button>} />
      {loading ? <Spinner /> : items.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr className="bg-slate-50">
              <th className="th">관리번호</th><th className="th">원료명</th><th className="th">{config.partnerLabel}</th>
              <th className="th">LC개설</th><th className="th">물량</th><th className="th">단가/총액</th>
              <th className="th">선박/ETD·ETA</th><th className="th">상태</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="td">{r.ref_no || "-"}</td>
                  <td className="td font-medium">{r.material_name}</td>
                  <td className="td">{r[config.partnerKey] || "-"}</td>
                  <td className="td">{r.lc_bank || "-"}<div className="text-xs text-slate-400">{r.lc_no}</div></td>
                  <td className="td">{r.quantity ? `${r.quantity} ${r.unit}` : "-"}</td>
                  <td className="td">{r.unit_price ? `${r.currency} ${fmt(r.unit_price)}` : "-"}<div className="text-xs text-slate-400">{r.total_price ? `${r.currency} ${fmt(r.total_price)}` : ""}</div></td>
                  <td className="td">{r.vessel || "-"}<div className="text-xs text-slate-400">{r.etd || "?"} → {r.eta || "?"}</div></td>
                  <td className="td"><Badge value={r.status} /></td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => openEdit(r)}>상세/수정</button>
                    {config.kind === "import" && r.status !== "cleared" && r.status !== "done" && (
                      <button className="ml-2 text-xs text-teal-600 hover:underline" onClick={() => receive(r)}>입고</button>
                    )}
                    <button className="ml-2 text-xs text-red-500 hover:underline" onClick={() => remove(r)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); reload(); }} title={row?.id ? "거래 상세" : "신규 등록"} wide>
        {row && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="관리번호"><input className="input" value={row.ref_no || ""} onChange={(e) => setRow({ ...row, ref_no: e.target.value })} /></Field>
              <Field label="원료명"><input className="input" value={row.material_name || ""} onChange={(e) => setRow({ ...row, material_name: e.target.value })} /></Field>
              <Field label={config.partnerLabel}><input className="input" value={row[config.partnerKey] || ""} onChange={(e) => setRow({ ...row, [config.partnerKey]: e.target.value })} /></Field>
              <Field label="LC개설회사/은행"><input className="input" value={row.lc_bank || ""} onChange={(e) => setRow({ ...row, lc_bank: e.target.value })} /></Field>
              <Field label="LC번호"><input className="input" value={row.lc_no || ""} onChange={(e) => setRow({ ...row, lc_no: e.target.value })} /></Field>
              <Field label="상태">
                <select className="input" value={row.status} onChange={(e) => setRow({ ...row, status: e.target.value })}>
                  {STATUS_OPTIONS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </Field>
              <Field label="물량"><input type="number" className="input" value={row.quantity ?? ""} onChange={(e) => setRow({ ...row, quantity: e.target.value })} /></Field>
              <Field label="단위"><input className="input" value={row.unit || ""} onChange={(e) => setRow({ ...row, unit: e.target.value })} /></Field>
              <Field label="통화"><input className="input" value={row.currency || ""} onChange={(e) => setRow({ ...row, currency: e.target.value })} /></Field>
              <Field label="단가"><input type="number" className="input" value={row.unit_price ?? ""} onChange={(e) => setRow({ ...row, unit_price: e.target.value })} /></Field>
              <Field label="선박명"><input className="input" value={row.vessel || ""} onChange={(e) => setRow({ ...row, vessel: e.target.value })} /></Field>
              <div />
              <Field label="ETD (출항)"><input type="date" className="input" value={row.etd || ""} onChange={(e) => setRow({ ...row, etd: e.target.value })} /></Field>
              <Field label="ETA (도착)"><input type="date" className="input" value={row.eta || ""} onChange={(e) => setRow({ ...row, eta: e.target.value })} /></Field>
            </div>
            <Field label="비고"><textarea className="input" rows={2} value={row.note || ""} onChange={(e) => setRow({ ...row, note: e.target.value })} /></Field>

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setOpen(false); reload(); }}>닫기</button>
              <button className="btn-primary" onClick={save} disabled={!row.material_name}>{row.id ? "변경 저장" : "등록"}</button>
            </div>

            {row.id ? (
              <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
                <FileManager entityType={config.entityType} entityId={row.id} category="contract" label="📄 계약서" />
                <FileManager entityType={config.entityType} entityId={row.id} category="shipping_docs" label="🚢 선적서류" />
              </div>
            ) : (
              <p className="border-t border-slate-200 pt-4 text-xs text-slate-400">먼저 등록하면 계약서·선적서류를 첨부할 수 있습니다.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function num(v: any) { return v === "" || v == null ? null : Number(v); }
function fmt(v: number) { return Number(v).toLocaleString(); }
