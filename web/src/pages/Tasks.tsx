import { useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Badge, Empty, Modal, Field, useList } from "../components/ui";

export default function Tasks() {
  const { items, loading, reload } = useList<any>("/work/tasks");
  const users = useList<any>("/users");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  function openNew() { setEditing({ status: "todo", priority: "normal" }); setOpen(true); }
  function openEdit(t: any) { setEditing({ ...t }); setOpen(true); }

  async function save() {
    const body = {
      title: editing.title, description: editing.description, status: editing.status,
      priority: editing.priority, assignee_id: editing.assignee_id || null, due_date: editing.due_date || null,
    };
    if (editing.id) await api.put(`/work/tasks/${editing.id}`, body);
    else await api.post("/work/tasks", body);
    setOpen(false); reload();
  }
  async function quickStatus(t: any, status: string) { await api.put(`/work/tasks/${t.id}`, { status }); reload(); }
  async function remove(t: any) { if (confirm("삭제하시겠습니까?")) { await api.del(`/work/tasks/${t.id}`); reload(); } }

  return (
    <div>
      <PageHeader title="업무 / 할일" subtitle="팀 업무를 등록하고 진행상황을 관리합니다"
        action={<button className="btn-primary" onClick={openNew}>+ 업무 등록</button>} />
      {loading ? <Spinner /> : items.length === 0 ? <Empty /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-slate-50">
              <th className="th">제목</th><th className="th">담당자</th><th className="th">우선순위</th>
              <th className="th">마감일</th><th className="th">상태</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td className="td">
                    <div className="font-medium">{t.title}</div>
                    {t.description && <div className="text-xs text-slate-400 truncate max-w-xs">{t.description}</div>}
                  </td>
                  <td className="td">{t.assignee_name || "-"}</td>
                  <td className="td"><Badge value={t.priority} /></td>
                  <td className="td">{t.due_date || "-"}</td>
                  <td className="td">
                    <select className="rounded border border-slate-200 text-xs px-1 py-0.5" value={t.status} onChange={(e) => quickStatus(t, e.target.value)}>
                      <option value="todo">대기</option><option value="in_progress">진행중</option><option value="done">완료</option>
                    </select>
                  </td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => openEdit(t)}>수정</button>
                    <button className="ml-2 text-xs text-red-500 hover:underline" onClick={() => remove(t)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing?.id ? "업무 수정" : "업무 등록"}>
        {editing && (
          <div className="space-y-3">
            <Field label="제목"><input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label="내용"><textarea className="input" rows={3} value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="담당자">
                <select className="input" value={editing.assignee_id || ""} onChange={(e) => setEditing({ ...editing, assignee_id: e.target.value })}>
                  <option value="">미지정</option>
                  {users.items.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="우선순위">
                <select className="input" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                  <option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option><option value="urgent">긴급</option>
                </select>
              </Field>
            </div>
            <Field label="마감일"><input type="date" className="input" value={editing.due_date || ""} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
              <button className="btn-primary" onClick={save} disabled={!editing.title}>저장</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
