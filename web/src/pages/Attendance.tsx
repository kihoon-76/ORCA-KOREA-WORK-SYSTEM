import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, Badge, useList } from "../components/ui";

export default function Attendance() {
  const month = new Date().toISOString().slice(0, 7);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<any>(null);
  const leaves = useList<any>("/work/leaves");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [lv, setLv] = useState<any>({ leave_type: "annual" });

  const todayStr = new Date().toISOString().slice(0, 10);

  function load() {
    setLoading(true);
    api.get(`/work/attendance?month=${month}`).then((r) => {
      setRecords(r.items || []);
      setToday((r.items || []).find((x: any) => x.work_date === todayStr) || null);
    }).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function checkIn() { const r = await api.post("/work/attendance/check-in"); setToday(r.item); load(); }
  async function checkOut() { const r = await api.post("/work/attendance/check-out"); setToday(r.item); load(); }
  async function saveLeave() {
    await api.post("/work/leaves", { leave_type: lv.leave_type, start_date: lv.start_date, end_date: lv.end_date, reason: lv.reason });
    setLeaveOpen(false); setLv({ leave_type: "annual" }); leaves.reload();
  }
  const t = (s?: string) => s ? new Date(s).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-";

  return (
    <div>
      <PageHeader title="근태 / 출퇴근" subtitle="출퇴근 체크와 휴가 신청을 관리합니다" />

      <div className="card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500">{todayStr}</div>
            <div className="mt-1 flex gap-6">
              <div><span className="text-xs text-slate-400">출근</span><div className="font-bold text-blue-600">{t(today?.check_in)}</div></div>
              <div><span className="text-xs text-slate-400">퇴근</span><div className="font-bold text-orange-600">{t(today?.check_out)}</div></div>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={checkIn} disabled={!!today?.check_in}>출근</button>
            <button className="btn-secondary" onClick={checkOut} disabled={!today?.check_in}>퇴근</button>
            <button className="btn-secondary" onClick={() => setLeaveOpen(true)}>휴가신청</button>
          </div>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-600">📅 {month} 출퇴근 기록</h2>
      {loading ? <Spinner /> : records.length === 0 ? <Empty text="기록이 없습니다" /> : (
        <div className="card mb-6 overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-slate-50"><th className="th">일자</th><th className="th">출근</th><th className="th">퇴근</th></tr></thead>
            <tbody>{records.map((r) => (<tr key={r.id}><td className="td">{r.work_date}</td><td className="td">{t(r.check_in)}</td><td className="td">{t(r.check_out)}</td></tr>))}</tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-600">🏖️ 휴가 신청 내역</h2>
      {leaves.loading ? <Spinner /> : leaves.items.length === 0 ? <Empty text="신청 내역이 없습니다" /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr className="bg-slate-50"><th className="th">신청자</th><th className="th">유형</th><th className="th">기간</th><th className="th">사유</th><th className="th">상태</th></tr></thead>
            <tbody>{leaves.items.map((l) => (
              <tr key={l.id}><td className="td">{l.user_name}</td><td className="td"><Badge value={l.leave_type} /></td>
                <td className="td">{l.start_date} ~ {l.end_date}</td><td className="td">{l.reason || "-"}</td><td className="td"><Badge value={l.status} /></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="휴가 신청">
        <div className="space-y-3">
          <Field label="유형">
            <select className="input" value={lv.leave_type} onChange={(e) => setLv({ ...lv, leave_type: e.target.value })}>
              <option value="annual">연차</option><option value="sick">병가</option><option value="etc">기타</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="시작일"><input type="date" className="input" value={lv.start_date || ""} onChange={(e) => setLv({ ...lv, start_date: e.target.value })} /></Field>
            <Field label="종료일"><input type="date" className="input" value={lv.end_date || ""} onChange={(e) => setLv({ ...lv, end_date: e.target.value })} /></Field>
          </div>
          <Field label="사유"><input className="input" value={lv.reason || ""} onChange={(e) => setLv({ ...lv, reason: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={() => setLeaveOpen(false)}>취소</button>
            <button className="btn-primary" onClick={saveLeave} disabled={!lv.start_date || !lv.end_date}>신청</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
