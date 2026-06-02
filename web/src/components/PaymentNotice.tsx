import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon } from "./ui";

const POLL_MS = 60_000; // 1분마다 내 상신 결재 상태 확인
const ackKey = (id: number) => `orca_pay_done_${id}`;

// 내가 상신한 자금결제가 승인(결제완료)되면 팝업으로 통지한다 (재무차장 등 상신자 대상).
// 순수 클라이언트 폴링 방식 — 별도 DB/서버 없이 동작한다.
export default function PaymentNotice() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<{ id: number; title: string } | null>(null);
  const openRef = useRef(false);
  openRef.current = notice !== null;

  useEffect(() => {
    if (!user) return;
    let stop = false;

    async function check() {
      if (stop || openRef.current) return; // 팝업이 떠 있으면 중복 방지
      let res: any;
      try { res = await api.get("/approvals?mine=1"); }
      catch { return; }
      if (stop || openRef.current) return;

      // 승인된 자금결제 중 아직 통지하지 않은 가장 최근 건
      const done = (res.items || []).find(
        (a: any) => a.doc_type === "payment" && a.status === "approved" && !localStorage.getItem(ackKey(a.id))
      );
      if (done) setNotice({ id: done.id, title: done.title });
    }

    check();
    const t = setInterval(check, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [user]);

  if (!notice) return null;

  function dismiss() {
    localStorage.setItem(ackKey(notice!.id), "1");
    setNotice(null);
  }
  function goApprovals() { dismiss(); navigate("/approvals"); }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success-container">
          <Icon name="task_alt" size={32} className="text-success" />
        </div>
        <h2 className="text-center text-xl font-bold text-success">결제완료 통지</h2>
        <p className="mt-3 whitespace-pre-line text-center text-sm text-slate-600">
          {`「${notice.title}」 자금결제 건이\n대표이사 승인으로 결제 완료되었습니다.`}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn-secondary" onClick={dismiss}>닫기</button>
          <button className="btn-primary" onClick={goApprovals}>문서 확인하기</button>
        </div>
      </div>
    </div>
  );
}
