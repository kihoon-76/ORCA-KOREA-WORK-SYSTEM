import { useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, Badge, useList } from "../components/ui";

export default function Inventory() {
  const stock = useList<any>("/inventory");
  const txns = useList<any>("/inventory/txns");
  const materials = useList<any>("/materials");
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<any>(null);

  function openNew() { setRow({ txn_type: "in", unit: "MT", txn_date: new Date().toISOString().slice(0, 10) }); setOpen(true); }
  async function save() {
    await api.post("/inventory/txns", {
      material_name: row.material_name, material_id: row.material_id || null, txn_type: row.txn_type,
      quantity: Number(row.quantity), unit: row.unit, warehouse: row.warehouse, txn_date: row.txn_date, note: row.note,
    });
    setOpen(false); stock.reload(); txns.reload();
  }
  async function removeTxn(id: number) { if (confirm("이 입출고 기록을 삭제할까요?")) { await api.del(`/inventory/txns/${id}`); stock.reload(); txns.reload(); } }

  return (
    <div>
      <PageHeader title="재고관리" subtitle="수입물량·입출고·재고물량을 관리합니다"
        action={<button className="btn-primary" onClick={openNew}>+ 입출고 등록</button>} />

      <h2 className="mb-2 text-sm font-semibold text-slate-600">📊 원료별 재고 현황</h2>
      {stock.loading ? <Spinner /> : stock.items.length === 0 ? <Empty text="재고 데이터가 없습니다" /> : (
        <div className="card mb-6 overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead><tr className="bg-slate-50">
              <th className="th">원료명</th><th className="th text-right">수입물량</th><th className="th text-right">총 입고</th>
              <th className="th text-right">총 출고</th><th className="th text-right">현재 재고</th><th className="th">단위</th>
            </tr></thead>
            <tbody>
              {stock.items.map((s, i) => (
                <tr key={i}>
                  <td className="td font-medium">{s.material_name}</td>
                  <td className="td text-right">{fmt(s.import_qty)}</td>
                  <td className="td text-right text-blue-600">{fmt(s.in_qty)}</td>
                  <td className="td text-right text-orange-600">{fmt(s.out_qty)}</td>
                  <td className="td text-right font-bold">{fmt(s.stock_qty)}</td>
                  <td className="td">{s.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-600">📥 입출고 내역</h2>
      {txns.loading ? <Spinner /> : txns.items.length === 0 ? <Empty text="입출고 내역이 없습니다" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr className="bg-slate-50">
              <th className="th">일자</th><th className="th">구분</th><th className="th">원료명</th>
              <th className="th text-right">수량</th><th className="th">출처</th><th className="th">창고</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {txns.items.map((t) => (
                <tr key={t.id}>
                  <td className="td">{t.txn_date}</td>
                  <td className="td"><span className={`badge ${t.txn_type === "in" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>{t.txn_type === "in" ? "입고" : "출고"}</span></td>
                  <td className="td font-medium">{t.material_name}</td>
                  <td className="td text-right">{fmt(t.quantity)} {t.unit}</td>
                  <td className="td text-xs text-slate-500">{t.source === "import" ? "수입연동" : t.source === "manual" ? "수동" : t.source}</td>
                  <td className="td">{t.warehouse || "-"}</td>
                  <td className="td text-right"><button className="text-xs text-red-500 hover:underline" onClick={() => removeTxn(t.id)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="입출고 등록">
        {row && (
          <div className="space-y-3">
            <Field label="구분">
              <select className="input" value={row.txn_type} onChange={(e) => setRow({ ...row, txn_type: e.target.value })}>
                <option value="in">입고</option><option value="out">출고</option>
              </select>
            </Field>
            <Field label="원료명">
              <input className="input" list="mat-list" value={row.material_name || ""} onChange={(e) => setRow({ ...row, material_name: e.target.value })} />
              <datalist id="mat-list">{materials.items.map((m) => <option key={m.id} value={m.name} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="수량"><input type="number" className="input" value={row.quantity ?? ""} onChange={(e) => setRow({ ...row, quantity: e.target.value })} /></Field>
              <Field label="단위"><input className="input" value={row.unit} onChange={(e) => setRow({ ...row, unit: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="일자"><input type="date" className="input" value={row.txn_date} onChange={(e) => setRow({ ...row, txn_date: e.target.value })} /></Field>
              <Field label="창고/위치"><input className="input" value={row.warehouse || ""} onChange={(e) => setRow({ ...row, warehouse: e.target.value })} /></Field>
            </div>
            <Field label="비고"><input className="input" value={row.note || ""} onChange={(e) => setRow({ ...row, note: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
              <button className="btn-primary" onClick={save} disabled={!row.material_name || !row.quantity}>저장</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function fmt(v: any) { return v == null ? "0" : Number(v).toLocaleString(); }
