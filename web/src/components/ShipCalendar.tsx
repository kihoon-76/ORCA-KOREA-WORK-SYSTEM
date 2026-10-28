import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon, Modal, Badge } from "./ui";
import ImportDrawer from "./ImportDrawer";

// 선박 일정 캘린더 — 원료 수입 건의 ETD(출항)·ETA(도착)를 달력에 표시하고,
// 일정을 끌어서 다른 날짜에 놓거나 클릭해서 바로 날짜를 고칠 수 있다.

type Field = "etd" | "eta";
interface CalEvent { row: any; field: Field; date: string }

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const md = (v?: string | null) => {
  if (!v) return "-";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return v;
  return `${pad(m)}-${pad(d)}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
};
const MAX_PER_DAY = 3;

export default function ShipCalendar({ imports, onUpdated }: { imports: any[]; onUpdated: (item: any) => void }) {
  const today = ymd(new Date());
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [editing, setEditing] = useState<any>(null);
  const [dayList, setDayList] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // 날짜별 일정 (출항·도착)
  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const r of imports) {
      for (const field of ["etd", "eta"] as Field[]) {
        const v = r[field] ? String(r[field]).slice(0, 10) : "";
        if (!v) continue;
        const list = m.get(v) || [];
        list.push({ row: r, field, date: v });
        m.set(v, list);
      }
    }
    // 도착(ETA)을 먼저, 그다음 출항
    for (const list of m.values()) list.sort((a, b) => (a.field === b.field ? 0 : a.field === "eta" ? -1 : 1));
    return m;
  }, [imports]);

  // 이번 달 달력 칸 (앞뒤 달 날짜 포함, 6주)
  const cells = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - start.getDay());
    const list: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      list.push(d);
    }
    // 마지막 주가 전부 다음 달이면 5주만
    return list.slice(35).every((d) => d.getMonth() !== month.getMonth()) ? list.slice(0, 35) : list;
  }, [month]);

  const monthEvents = useMemo(() => {
    const prefix = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
    let etd = 0, eta = 0, etaQty = 0;
    for (const [d, list] of byDate) {
      if (!d.startsWith(prefix)) continue;
      for (const e of list) {
        if (e.field === "etd") etd++;
        else { eta++; etaQty += Number(e.row.quantity) || 0; }
      }
    }
    return { etd, eta, etaQty };
  }, [byDate, month]);

  async function saveDates(row: any, patch: Partial<Record<Field, string | null>>) {
    const etd = patch.etd !== undefined ? patch.etd : row.etd;
    const eta = patch.eta !== undefined ? patch.eta : row.eta;
    if (etd && eta && String(eta).slice(0, 10) < String(etd).slice(0, 10)) {
      if (!confirm("ETA(도착)가 ETD(출항)보다 빠릅니다. 그래도 저장할까요?")) return false;
    }
    try {
      const res = await api.put(`/trade/imports/${row.id}`, patch);
      onUpdated(res.item);
      return true;
    } catch (e: any) {
      alert(e.message);
      return false;
    }
  }

  async function onDrop(date: string, data: string) {
    setDragOver(null);
    try {
      const { id, field } = JSON.parse(data) as { id: number; field: Field };
      const row = imports.find((r) => r.id === id);
      if (!row || String(row[field] || "").slice(0, 10) === date) return;
      const label = field === "etd" ? "ETD(출항)" : "ETA(도착)";
      if (!confirm(`${row.material_name}\n${label}을(를) ${md(row[field])} → ${md(date)}(으)로 바꿀까요?`)) return;
      await saveDates(row, { [field]: date });
    } catch { /* 일정이 아닌 것을 끌어다 놓은 경우 무시 */ }
  }

  const chip = (e: CalEvent) => {
    const isEta = e.field === "eta";
    const qty = e.row.quantity != null ? `${Number(e.row.quantity).toLocaleString()}${e.row.unit || "MT"}` : "";
    return (
      <div key={`${e.row.id}-${e.field}`} draggable
        onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", JSON.stringify({ id: e.row.id, field: e.field })); ev.dataTransfer.effectAllowed = "move"; }}
        onClick={(ev) => { ev.stopPropagation(); setEditing(e.row); }}
        title={`${isEta ? "도착(ETA)" : "출항(ETD)"} · ${e.row.material_name} ${qty}\n${e.row.supplier || ""}\nETD ${md(e.row.etd)} → ETA ${md(e.row.eta)}\n\n클릭: 날짜 수정·서류 보기 / 끌어서 다른 날짜에 놓기: 날짜 변경`}
        className={`mb-0.5 flex cursor-grab items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] leading-tight active:cursor-grabbing ${editing?.id === e.row.id ? "ring-2 ring-amber-400 ring-offset-1 " : ""}${
          isEta ? "bg-primary text-white hover:bg-primary-container" : "border border-secondary-fixed-dim bg-secondary-fixed/60 text-on-secondary-container hover:bg-secondary-fixed"}`}>
        <span className="shrink-0 font-bold">{isEta ? "도착" : "출항"}</span>
        <span className="truncate">{e.row.material_name}</span>
      </div>
    );
  };

  const dayEvents = dayList ? byDate.get(dayList) || [] : [];
  // 팝업의 이전/다음 순서: 도착일(ETA, 없으면 출항일) 순
  const navList = useMemo(() => imports
    .filter((r) => r.eta || r.etd)
    .sort((a, b) => String(a.eta || a.etd).localeCompare(String(b.eta || b.etd))), [imports]);

  return (
    <div>
      {/* 머리: 월 이동 + 요약 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-6 py-4">
        <div className="flex items-center gap-3">
          <h3 className="headline flex items-center gap-2 text-lg font-bold text-primary"><Icon name="sailing" className="text-secondary" /> 선박 일정</h3>
          <div className="flex items-center gap-1">
            <button className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container" title="이전 달"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}><Icon name="chevron_left" /></button>
            <span className="min-w-[96px] text-center font-bold text-primary">{month.getFullYear()}년 {month.getMonth() + 1}월</span>
            <button className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container" title="다음 달"
              onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}><Icon name="chevron_right" /></button>
            <button className="ml-1 rounded-md border border-outline-variant px-2 py-0.5 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
              onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>오늘</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-on-surface-variant">
          <span>이번 달 도착 <b className="text-primary">{monthEvents.eta}건 · {monthEvents.etaQty.toLocaleString()} MT</b> · 출항 <b className="text-primary">{monthEvents.etd}건</b></span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-primary" /> 도착(ETA)</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-secondary-fixed-dim bg-secondary-fixed/60" /> 출항(ETD)</span>
          <Link to="/imports" className="font-semibold text-secondary hover:underline">원료 수입현황</Link>
        </div>
      </div>

      {/* 달력(왼쪽) + 다가오는 선박 일정 목록(오른쪽) */}
      <div className="flex flex-col xl:flex-row">
        <div className="min-w-0 flex-1">
        {/* 달력 */}
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-container-low text-center text-xs font-semibold">
              {WEEK.map((w, i) => <div key={w} className={`py-1.5 ${i === 0 ? "text-error" : i === 6 ? "text-secondary" : "text-on-surface-variant"}`}>{w}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((d) => {
                const key = ymd(d);
                const inMonth = d.getMonth() === month.getMonth();
                const events = byDate.get(key) || [];
                const isToday = key === today;
                return (
                  <div key={key}
                    onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; if (dragOver !== key) setDragOver(key); }}
                    onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
                    onDrop={(ev) => { ev.preventDefault(); onDrop(key, ev.dataTransfer.getData("text/plain")); }}
                    className={`min-h-[104px] border-b border-r border-outline-variant p-1 transition-colors ${inMonth ? "bg-surface-container-lowest" : "bg-surface-container-low/60"} ${dragOver === key ? "!bg-secondary-fixed/50 ring-2 ring-inset ring-secondary" : ""}`}>
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-secondary font-bold text-white" : inMonth ? (d.getDay() === 0 ? "text-error" : "text-on-surface") : "text-on-surface-variant/50"}`}>
                        {d.getDate()}
                      </span>
                    </div>
                    {events.slice(0, MAX_PER_DAY).map(chip)}
                    {events.length > MAX_PER_DAY && (
                      <button className="w-full rounded px-1 text-left text-[11px] font-semibold text-secondary hover:bg-surface-container" onClick={() => setDayList(key)}>
                        +{events.length - MAX_PER_DAY}건 더보기
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <p className="px-6 py-2 text-[11px] text-on-surface-variant">일정을 클릭하면 날짜를 고치거나 서류를 볼 수 있고, 끌어서 다른 날짜에 놓으면 그 날짜로 바뀌어요.</p>
        </div>
        <UpcomingList imports={imports} today={today} onOpen={setEditing} />
      </div>

      {/* 일정 상세 팝업 — 이전/다음으로 날짜순 넘겨 보기 */}
      {editing && (
        <ImportDrawer row={imports.find((r) => r.id === editing.id) || editing} list={navList}
          onNavigate={setEditing} onClose={() => setEditing(null)} onUpdated={onUpdated} />
      )}

      {/* 하루 일정 전체 */}
      {dayList && (
        <Modal open onClose={() => setDayList(null)} title={`${md(dayList)} 선박 일정`}>
          <div className="space-y-1">
            {dayEvents.map((e) => (
              <button key={`${e.row.id}-${e.field}`} className="flex w-full items-center gap-2 rounded-lg border border-outline-variant px-3 py-2 text-left text-sm hover:bg-surface-container-low"
                onClick={() => { setDayList(null); setEditing(e.row); }}>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${e.field === "eta" ? "bg-primary text-white" : "bg-secondary-fixed text-on-secondary-container"}`}>{e.field === "eta" ? "도착" : "출항"}</span>
                <span className="flex-1 font-semibold">{e.row.material_name}</span>
                <span className="text-xs text-on-surface-variant">{e.row.supplier}</span>
                <span className="text-xs">{e.row.quantity != null ? `${Number(e.row.quantity).toLocaleString()} ${e.row.unit || "MT"}` : ""}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

    </div>
  );
}

// 다가오는 선박 일정 — 도착(ETA)이 오늘 이후인 건을 가까운 순서로 간단히
function UpcomingList({ imports, today, onOpen }: { imports: any[]; today: string; onOpen: (r: any) => void }) {
  const list = imports
    .filter((r) => r.eta && String(r.eta).slice(0, 10) >= today)
    .sort((a, b) => String(a.eta).localeCompare(String(b.eta)));
  const t0 = new Date(today).getTime();
  return (
    <div className="flex flex-col border-t border-outline-variant xl:w-[320px] xl:border-l xl:border-t-0">
      <div className="flex items-baseline justify-between px-4 py-3">
        <span className="text-sm font-bold text-primary">다가오는 선박 일정</span>
        <span className="text-xs text-on-surface-variant">{list.length}건</span>
      </div>
      {list.length === 0 && <p className="px-4 py-8 text-center text-xs text-on-surface-variant">예정된 도착 일정이 없습니다</p>}
      <div className="max-h-[560px] flex-1 overflow-y-auto">
        {list.map((r) => {
          const days = Math.round((new Date(String(r.eta).slice(0, 10)).getTime() - t0) / 86400000);
          return (
            <button key={r.id} onClick={() => onOpen(r)} title="클릭: 날짜 수정·서류 보기"
              className="flex w-full items-center gap-3 border-t border-outline-variant/60 px-4 py-2 text-left hover:bg-surface-container-low">
              <div className="w-[52px] shrink-0 text-center">
                <div className="font-mono text-xs font-bold text-primary">{md(r.eta).slice(0, 5)}</div>
                <div className={`text-[11px] font-semibold ${days <= 3 ? "text-amber-700" : "text-on-surface-variant"}`}>{days === 0 ? "오늘" : `D-${days}`}</div>
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-semibold text-on-surface">{r.material_name}</div>
                <div className="truncate text-[11px] text-on-surface-variant">{r.supplier || "-"}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-semibold text-on-surface">{r.quantity != null ? `${Number(r.quantity).toLocaleString()} ${r.unit || "MT"}` : "-"}</div>
                <div className="text-[11px] text-on-surface-variant">{STATUS_TEXT[r.status] || r.status || ""}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  contracted: "계약", shipped: "선적", customs: "통관", stored: "입고", processed: "가공", released: "출고", settled: "정산",
  arrived: "도착", cleared: "통관완료", delivered: "출고", done: "완료",
};
