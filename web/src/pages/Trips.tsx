import { useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, Badge, useList, FileManager } from "../components/ui";

export default function Trips() {
  const { items, loading, reload } = useList<any>("/trips");
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<any>(null);

  function openNew() { setRow({ status: "planned" }); setOpen(true); }
  async function save() {
    const body = { title: row.title, destination: row.destination, purpose: row.purpose, start_date: row.start_date, end_date: row.end_date, status: row.status, note: row.note };
    let saved = row;
    if (row.id) { const r = await api.put(`/trips/${row.id}`, body); saved = r.item; }
    else { const r = await api.post("/trips", body); saved = r.item; }
    setRow(saved); reload();
  }
  async function remove(id: number) { if (confirm("삭제하시겠습니까?")) { await api.del(`/trips/${id}`); reload(); } }

  return (
    <div>
      <PageHeader title="출장관리" subtitle="출장계획서를 등록하고 첨부합니다"
        action={<button className="btn-primary" onClick={openNew}>+ 출장 등록</button>} />
      {loading ? <Spinner /> : items.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr className="bg-slate-50">
              <th className="th">제목</th><th className="th">출장자</th><th className="th">목적지</th>
              <th className="th">기간</th><th className="th">상태</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.title}</td>
                  <td className="td">{r.user_name}</td>
                  <td className="td">{r.destination || "-"}</td>
                  <td className="td">{r.start_date || "?"} ~ {r.end_date || "?"}</td>
                  <td className="td"><Badge value={r.status} /></td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => { setRow({ ...r }); setOpen(true); }}>상세/계획서</button>
                    <button className="ml-2 text-xs text-red-500 hover:underline" onClick={() => remove(r.id)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); reload(); }} title={row?.id ? "출장 상세" : "출장 등록"}>
        {row && (
          <div className="space-y-3">
            <Field label="제목"><input className="input" value={row.title || ""} onChange={(e) => setRow({ ...row, title: e.target.value })} /></Field>
            <Field label="목적지"><input className="input" value={row.destination || ""} onChange={(e) => setRow({ ...row, destination: e.target.value })} /></Field>
            <Field label="목적"><textarea className="input" rows={2} value={row.purpose || ""} onChange={(e) => setRow({ ...row, purpose: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="시작일"><input type="date" className="input" value={row.start_date || ""} onChange={(e) => setRow({ ...row, start_date: e.target.value })} /></Field>
              <Field label="종료일"><input type="date" className="input" value={row.end_date || ""} onChange={(e) => setRow({ ...row, end_date: e.target.value })} /></Field>
            </div>
            <Field label="상태">
              <select className="input" value={row.status} onChange={(e) => setRow({ ...row, status: e.target.value })}>
                <option value="planned">예정</option><option value="approved">승인</option><option value="completed">완료</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setOpen(false); reload(); }}>닫기</button>
              <button className="btn-primary" onClick={save} disabled={!row.title}>{row.id ? "변경 저장" : "등록"}</button>
            </div>
            {row.id ? (
              <div className="border-t border-slate-200 pt-3">
                <FileManager entityType="trip" entityId={row.id} category="trip_plan" label="📄 출장계획서" />
              </div>
            ) : <p className="border-t border-slate-200 pt-3 text-xs text-slate-400">등록 후 출장계획서를 업로드할 수 있습니다.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
