import { useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, Badge, useList } from "../components/ui";

const TYPE_LABEL: Record<string, string> = { general: "일반", meeting: "회의", deadline: "마감", shipment: "선적" };

export default function Calendar() {
  const { items, loading, reload } = useList<any>("/work/events");
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<any>(null);

  function openNew() { setEv({ event_type: "general", all_day: 1, start_date: new Date().toISOString().slice(0, 10) }); setOpen(true); }
  async function save() {
    const body = { title: ev.title, description: ev.description, event_type: ev.event_type, start_date: ev.start_date, end_date: ev.end_date || null, all_day: 1 };
    if (ev.id) await api.put(`/work/events/${ev.id}`, body); else await api.post("/work/events", body);
    setOpen(false); reload();
  }
  async function remove(id: number) { if (confirm("삭제하시겠습니까?")) { await api.del(`/work/events/${id}`); reload(); } }

  // 날짜별 그룹
  const grouped = items.reduce((acc: Record<string, any[]>, e) => {
    (acc[e.start_date] ||= []).push(e); return acc;
  }, {});
  const dates = Object.keys(grouped).sort();

  return (
    <div>
      <PageHeader title="일정 / 캘린더" subtitle="회의·마감·선적 등 팀 일정을 공유합니다"
        action={<button className="btn-primary" onClick={openNew}>+ 일정 등록</button>} />
      {loading ? <Spinner /> : dates.length === 0 ? <Empty text="등록된 일정이 없습니다" /> : (
        <div className="space-y-4">
          {dates.map((d) => (
            <div key={d} className="card p-4">
              <div className="mb-2 text-sm font-semibold text-slate-700">{d} ({new Date(d).toLocaleDateString("ko-KR", { weekday: "short" })})</div>
              <ul className="space-y-2">
                {grouped[d].map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-brand-100 text-brand-700">{TYPE_LABEL[e.event_type] || e.event_type}</span>
                      <span className="font-medium">{e.title}</span>
                      {e.description && <span className="text-xs text-slate-400">{e.description}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => { setEv({ ...e }); setOpen(true); }}>수정</button>
                      <button className="text-xs text-red-500 hover:underline" onClick={() => remove(e.id)}>삭제</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={ev?.id ? "일정 수정" : "일정 등록"}>
        {ev && (
          <div className="space-y-3">
            <Field label="제목"><input className="input" value={ev.title || ""} onChange={(e) => setEv({ ...ev, title: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="유형">
                <select className="input" value={ev.event_type} onChange={(e) => setEv({ ...ev, event_type: e.target.value })}>
                  <option value="general">일반</option><option value="meeting">회의</option><option value="deadline">마감</option><option value="shipment">선적</option>
                </select>
              </Field>
              <Field label="날짜"><input type="date" className="input" value={ev.start_date || ""} onChange={(e) => setEv({ ...ev, start_date: e.target.value })} /></Field>
            </div>
            <Field label="설명"><textarea className="input" rows={2} value={ev.description || ""} onChange={(e) => setEv({ ...ev, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
              <button className="btn-primary" onClick={save} disabled={!ev.title || !ev.start_date}>저장</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
