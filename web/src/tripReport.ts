// 출장결과보고서: 구조화 필드 ↔ approvals.content 텍스트 변환 + 엑셀 출력
// 결재선은 대표이사 단독 승인이며, 재무차장은 출장비 정산을 위해 자동 열람한다.
import { downloadXlsx } from "./xlsx";

export interface TripReportFields {
  destination?: string;   // 출장지
  startDate?: string;     // 출장 시작일
  endDate?: string;       // 출장 종료일
  companions?: string;    // 동행자
  counterpart?: string;   // 방문처 / 면담자
  purpose?: string;       // 출장 목적
  activities?: string;    // 주요 활동 및 협의내용
  results?: string;       // 성과 및 결론
  followup?: string;      // 후속 조치사항
  amount?: string | number; // 출장비용
  currency?: string;
}

const HEADER = "[출장결과보고서]";
// `· 라벨: 값` 형태로 저장되는 한 줄짜리 항목
const LINE_FIELDS: [keyof TripReportFields, string][] = [
  ["destination", "출장지"],
  ["companions", "동행자"],
  ["counterpart", "방문처/면담자"],
];
// `[섹션명]` 아래 여러 줄로 저장되는 항목
const SECTION_FIELDS: [keyof TripReportFields, string][] = [
  ["purpose", "출장 목적"],
  ["activities", "주요 활동 및 협의내용"],
  ["results", "성과 및 결론"],
  ["followup", "후속 조치사항"],
];

export function tripPeriod(f: TripReportFields): string {
  if (!f.startDate && !f.endDate) return "";
  return `${f.startDate || "?"} ~ ${f.endDate || "?"}`;
}

function costText(f: TripReportFields): string {
  return f.amount ? `${f.currency || "KRW"} ${Number(f.amount).toLocaleString()}` : "";
}

export function buildTripReportContent(f: TripReportFields): string {
  const lines = [HEADER];
  const push = (k: string, v?: string) => { if (v) lines.push(`· ${k}: ${v}`); };
  push("출장지", f.destination);
  push("출장기간", tripPeriod(f));
  for (const [key, label] of LINE_FIELDS) {
    if (key === "destination") continue;
    push(label, f[key] as string);
  }
  push("출장비용", costText(f));
  for (const [key, label] of SECTION_FIELDS) {
    const v = (f[key] as string || "").trim();
    if (v) lines.push("", `[${label}]`, v);
  }
  return lines.join("\n");
}

export function parseTripReportContent(content: string): TripReportFields {
  const out: TripReportFields = {};
  const sections: Record<string, string[]> = {};
  const lineLabels = new Map<string, keyof TripReportFields>(LINE_FIELDS.map(([k, l]) => [l, k]));
  const sectionLabels = new Map<string, keyof TripReportFields>(SECTION_FIELDS.map(([k, l]) => [l, k]));
  let current: string | null = null;

  for (const line of (content || "").split("\n")) {
    const section = line.match(/^\[(.+)\]$/);
    if (section) { current = sectionLabels.has(section[1]) ? section[1] : null; continue; }
    if (current) { (sections[current] ||= []).push(line); continue; }
    if (!line.startsWith("· ")) continue;
    const idx = line.indexOf(": ");
    if (idx < 0) continue;
    const label = line.slice(2, idx), value = line.slice(idx + 2);
    if (label === "출장기간") {
      const [s, e] = value.split("~").map((v) => v.trim());
      if (s && s !== "?") out.startDate = s;
      if (e && e !== "?") out.endDate = e;
      continue;
    }
    const key = lineLabels.get(label);
    if (key) (out as any)[key] = value;
  }
  for (const [label, body] of Object.entries(sections)) {
    const key = sectionLabels.get(label);
    const text = body.join("\n").trim();
    if (key && text) (out as any)[key] = text;
  }
  return out;
}

const STATUS_TEXT: Record<string, string> = { pending: "결재중", approved: "승인", rejected: "반려", cancelled: "취소됨" };

// 출장결과보고 한 건 → 항목/내용 2열 표 (엑셀 저장용)
export function tripReportRows(d: TripReportFields & { title?: string; status?: string; requester?: string; createdAt?: string }): string[][] {
  const rows: [string, string][] = [
    ["제목", d.title || ""],
    ["출장지", d.destination || ""],
    ["출장기간", tripPeriod(d)],
    ["동행자", d.companions || ""],
    ["방문처/면담자", d.counterpart || ""],
    ["출장비용", costText(d)],
    ["출장 목적", d.purpose || ""],
    ["주요 활동 및 협의내용", d.activities || ""],
    ["성과 및 결론", d.results || ""],
    ["후속 조치사항", d.followup || ""],
  ];
  if (d.status) rows.push(["상태", STATUS_TEXT[d.status] || d.status]);
  if (d.requester) rows.push(["기안자", d.requester]);
  if (d.createdAt) rows.push(["기안일", d.createdAt]);
  return [["항목", "내용"], ...rows];
}

export function exportTripReportXlsx(title: string, d: TripReportFields & { title?: string; status?: string; requester?: string; createdAt?: string }) {
  const safe = (title || "보고서").replace(/[\\/:*?"<>|]/g, "_");
  downloadXlsx(`출장결과보고_${safe}.xlsx`, "출장결과보고", "출장결과보고서", tripReportRows({ ...d, title: d.title ?? title }));
}
