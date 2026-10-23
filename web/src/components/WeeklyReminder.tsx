import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { mondayOf, fmtDate } from "../week";
import { Icon } from "./ui";

// 주간결산 보고 — 화면을 막는 경고 대신, 오른쪽 아래에 작게 뜨는 안내 카드와
// 왼쪽 메뉴의 작은 점으로 부드럽게 작성을 권한다. (하루 한 번, "오늘은 그만 보기" 가능)

const POLL_MS = 5 * 60_000;

// 이번 주 주간결산 상태 (왼쪽 메뉴 점 표시와 안내 카드가 같이 쓴다)
export function useWeeklyStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<any>(null);
  useEffect(() => {
    if (!user) return;
    let stop = false;
    const load = () => api.get(`/weekly/status?week_start=${mondayOf(new Date())}`).then((s) => { if (!stop) setStatus(s); }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [user]);
  return status;
}

// 왼쪽 메뉴 "주간결산 보고" 옆에 점을 찍을지 (목·금·주말에 아직 안 올린 담당자)
export function weeklyNeedsDot(status: any) {
  if (!status?.is_reporter || status.submitted) return false;
  const day = new Date().getDay();
  return day === 4 || day === 5 || day === 6 || day === 0;
}

type Nudge = "friday" | "late" | "ceo";

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } }

export default function WeeklyReminder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const status = useWeeklyStatus();
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [tick, setTick] = useState(0);

  // 시간이 지나면서(예: 오후 5시) 안내 내용이 바뀌도록 가끔 다시 판단
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user || !status) return;
    const now = new Date();
    const today = fmtDate(now);
    const day = now.getDay(), hour = now.getHours();
    let next: Nudge | null = null;
    if (user.role === "ceo") {
      if (status.ceo_pending > 0) next = "ceo";
    } else if (status.is_reporter && !status.submitted && day === 5) {
      if (hour >= 17) next = "late";
      else if (hour >= 10) next = "friday";
    }
    // 같은 안내는 하루 한 번만
    if (next && safeGet(`orca_weekly_nudge_${next}_${today}`)) next = null;
    // "나중에"를 누르면 2시간 뒤에 다시
    if (next && Number(safeGet(`orca_weekly_snooze_${next}`) || 0) > Date.now()) next = null;
    setNudge(next);
  }, [user, status, tick]);

  if (!nudge) return null;

  function close() {
    safeSet(`orca_weekly_nudge_${nudge}_${fmtDate(new Date())}`, "1");
    setNudge(null);
  }
  function later() {
    safeSet(`orca_weekly_snooze_${nudge}`, String(Date.now() + 2 * 60 * 60 * 1000));
    setNudge(null);
  }
  function go(path: string) { close(); navigate(path); }

  const C = {
    friday: {
      icon: "edit_note", title: "이번 주도 수고 많으셨어요",
      body: "금요일이라 주간결산을 정리할 시간이에요. 진행사항·완료사항 몇 줄이면 충분해요.",
      action: "지금 정리하기", path: "/weekly",
    },
    late: {
      icon: "schedule", title: "주간결산이 아직 남아 있어요",
      body: "바쁜 한 주였죠. 퇴근 전에 짧게라도 정리해 두면 다음 주가 훨씬 가벼워요.",
      action: "짧게 정리하기", path: "/weekly",
    },
    ceo: {
      icon: "approval", title: "확인할 주간결산이 있어요",
      body: `결재를 기다리는 주간결산 보고가 ${status?.ceo_pending ?? 0}건 있어요.`,
      action: "보러 가기", path: "/approvals",
    },
  }[nudge];

  return (
    <div className="fixed bottom-5 right-5 z-[55] w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl" role="status">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-secondary">
          <Icon name={C.icon} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-primary">{C.title}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{C.body}</p>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn-primary whitespace-nowrap px-3 py-1.5 text-xs" onClick={() => go(C.path)}>{C.action}</button>
            <button className="whitespace-nowrap px-2 py-1.5 text-xs text-on-surface-variant hover:underline" onClick={later}>나중에</button>
            <button className="whitespace-nowrap px-1 py-1.5 text-xs text-on-surface-variant/70 hover:underline" onClick={close}>오늘은 그만 보기</button>
          </div>
        </div>
        <button className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container" onClick={later} title="닫기 (2시간 뒤 다시 알려드려요)">
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}
