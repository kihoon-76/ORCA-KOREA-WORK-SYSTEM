// 주간결산용 주(week) 계산 헬퍼 — 모두 로컬 시간 기준(한국 사용자)

function pad(n: number) { return String(n).padStart(2, "0"); }
export function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 주어진 날짜가 속한 주의 월요일 (월~일 주). 기본값: 오늘
export function mondayOf(date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();              // 0=일 ~ 6=토
  const diff = (dow + 6) % 7;          // 월요일까지 거슬러 갈 일수
  d.setDate(d.getDate() - diff);
  return fmtDate(d);
}

// 표시용 라벨: "2026-06-01 ~ 06-05" (월~금)
export function weekLabel(weekStart: string): string {
  const [y, m, day] = weekStart.split("-").map(Number);
  const mon = new Date(y, m - 1, day);
  const fri = new Date(y, m - 1, day + 4);
  return `${weekStart} ~ ${pad(fri.getMonth() + 1)}-${pad(fri.getDate())}`;
}
