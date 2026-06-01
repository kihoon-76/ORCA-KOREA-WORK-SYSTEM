import { useState } from "react";
import { api } from "../api";
import { ROLE_LABEL } from "../auth";
import { PageHeader, Spinner, Empty, Modal, Field, useList } from "../components/ui";

export default function Users() {
  const { items, loading, reload } = useList<any>("/users");
  const [open, setOpen] = useState(false);
  const [u, setU] = useState<any>(null);
  const [err, setErr] = useState("");

  function openNew() { setU({ role: "staff", active: 1 }); setErr(""); setOpen(true); }
  function openEdit(x: any) { setU({ ...x, password: "" }); setErr(""); setOpen(true); }

  async function save() {
    setErr("");
    try {
      if (u.id) {
        await api.put(`/users/${u.id}`, { name: u.name, role: u.role, department: u.department, position: u.position, active: u.active, password: u.password || undefined });
      } else {
        await api.post("/users", { email: u.email, name: u.name, password: u.password, role: u.role, department: u.department, position: u.position });
      }
      setOpen(false); reload();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div>
      <PageHeader title="직원관리" subtitle="계정 등록 및 권한을 관리합니다 (관리자 전용)"
        action={<button className="btn-primary" onClick={openNew}>+ 직원 등록</button>} />
      {loading ? <Spinner /> : items.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr className="bg-slate-50">
              <th className="th">이름</th><th className="th">이메일</th><th className="th">권한</th>
              <th className="th">부서</th><th className="th">직위</th><th className="th">상태</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id}>
                  <td className="td font-medium">{x.name}</td>
                  <td className="td">{x.email}</td>
                  <td className="td">{ROLE_LABEL[x.role] || x.role}</td>
                  <td className="td">{x.department || "-"}</td>
                  <td className="td">{x.position || "-"}</td>
                  <td className="td">{x.active ? <span className="badge bg-green-100 text-green-700">활성</span> : <span className="badge bg-slate-100 text-slate-500">비활성</span>}</td>
                  <td className="td text-right"><button className="text-xs text-brand-600 hover:underline" onClick={() => openEdit(x)}>수정</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={u?.id ? "직원 정보 수정" : "직원 등록"}>
        {u && (
          <div className="space-y-3">
            <Field label="이름"><input className="input" value={u.name || ""} onChange={(e) => setU({ ...u, name: e.target.value })} /></Field>
            <Field label="이메일">
              <input className="input" type="email" value={u.email || ""} disabled={!!u.id} onChange={(e) => setU({ ...u, email: e.target.value })} />
            </Field>
            <Field label={u.id ? "비밀번호 (변경 시에만 입력)" : "비밀번호"}>
              <input className="input" type="password" value={u.password || ""} onChange={(e) => setU({ ...u, password: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="권한">
                <select className="input" value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}>
                  <option value="staff">직원</option><option value="finance">재무차장</option><option value="director">이사</option><option value="ceo">대표이사</option><option value="admin">관리자</option>
                </select>
              </Field>
              <Field label="상태">
                <select className="input" value={u.active} onChange={(e) => setU({ ...u, active: Number(e.target.value) })}>
                  <option value={1}>활성</option><option value={0}>비활성</option>
                </select>
              </Field>
              <Field label="부서"><input className="input" value={u.department || ""} onChange={(e) => setU({ ...u, department: e.target.value })} /></Field>
              <Field label="직위"><input className="input" value={u.position || ""} onChange={(e) => setU({ ...u, position: e.target.value })} /></Field>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
              <button className="btn-primary" onClick={save} disabled={!u.name || (!u.id && (!u.email || !u.password))}>저장</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
