import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { mondayOf, fmtDate } from "../week";
import { Icon } from "./ui";

type Kind = "reminder" | "warning" | "ceo";
const POLL_MS = 120_000; // 2분마다 상태 점검 / 재알림

// 주간결산 보고 관련 팝업을 전역에서 띄우는 컴포넌트 (레이아웃에 상시 마운트)
export default function WeeklyReminder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [popup, setPopup] = useState<{ kind: Kind; count?: number } | null>(null);
  const openRef = useRef(false);
  openRef.current = popup !== null;

  useEffect(() => {
    if (!user) return;
    let stop = false;

    async function check() {
      if (stop || openRef.current) return; // 이미 팝업이 떠 있으면 중복 방지
      const now = new Date();
      const day = now.getDay();   // 5 = 금요일
      const hour = now.getHours();
      const weekStart = mondayOf(now);

      let status: any;
      try { status = await api.get(`/weekly/status?week_start=${weekStart}`); }
      catch { return; }
      if (stop || openRef.current) return;

      // 대표이사: 미결재 주간결산이 남아 있으면 계속 확인 요청
      if (user!.role === "ceo") {
        if (status.ceo_pending > 0) setPopup({ kind: "ceo", count: status.ceo_pending });
        return;
      }

      // 담당자: 이번 주 보고 미상신 시 알림/경고
      if (status.is_reporter && !status.submitted && day === 5) {
        if (hour >= 17) {
          // 금요일 17:00 경과 → 미이행 경고 (계속 반복)
          setPopup({ kind: "warning" });
        } else if (hour >= 11) {
          // 금요일 11:00 → 보고일 안내 (하루 1회)
          const key = `orca_weekly_reminder_${fmtDate(now)}`;
          if (!localStorage.getItem(key)) setPopup({ kind: "reminder" });
        }
      }
    }

    check();
    const t = setInterval(check, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [user]);

  if (!popup) return null;

  function dismiss() {
    if (popup!.kind === "reminder") {
      localStorage.setItem(`orca_weekly_reminder_${fmtDate(new Date())}`, "1");
    }
    setPopup(null);
  }
  function goWeekly() { dismiss(); navigate("/weekly"); }
  function goApprovals() { dismiss(); navigate("/approvals"); }

  const C = {
    reminder: {
      icon: "event_available", color: "text-brand-600", bg: "bg-brand-50",
      title: "주간결산 보고일",
      body: "오늘은 주간결산 보고일입니다.\n금요일 17:00까지 진행사항·완료사항을 작성하여 대표이사에게 결재 상신해 주세요.",
      action: <button className="btn-primary" onClick={goWeekly}>작성하러 가기</button>,
    },
    warning: {
      icon: "warning", color: "text-error", bg: "bg-error-container",
      title: "주간결산 미이행",
      body: "금요일 17:00이 지났습니다.\n아직 주간결산 결재 상신이 완료되지 않았습니다. 지금 즉시 작성하여 상신해 주세요.",
      action: <button className="btn-primary" onClick={goWeekly}>지금 작성하기</button>,
    },
    ceo: {
      icon: "approval", color: "text-amber-600", bg: "bg-amber-50",
      title: "주간결산 결재 확인",
      body: `결재 대기 중인 주간결산 보고가 ${popup.count ?? 0}건 있습니다.\n모든 결재가 완료될 때까지 계속 주간결산 보고를 확인해 주십시오.`,
      action: <button className="btn-primary" onClick={goApprovals}>결재 확인하기</button>,
    },
  }[popup.kind];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-md rounded-2xl p-6 shadow-2xl">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${C.bg}`}>
          <Icon name={C.icon} size={32} className={C.color} />
        </div>
        <h2 className={`text-center text-xl font-bold ${C.color}`}>{C.title}</h2>
        <p className="mt-3 whitespace-pre-line text-center text-sm text-slate-600">{C.body}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn-secondary" onClick={dismiss}>닫기</button>
          {C.action}
        </div>
      </div>
    </div>
  );
}
