import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "./ui";

// 대시보드 환율 카드 — 원/달러를 크게, 최근 30일 흐름(작은 선 그래프)과 EUR·CNY·JPY를 함께.
// 원가계산에 쓰는 기준정보 환율과 비교하고, 버튼 하나로 오늘 환율을 기준정보에 적용할 수 있다.
export default function FxCard() {
  const [fx, setFx] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [baseRate, setBaseRate] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  function load(refresh = false) {
    setErr(null);
    api.get(`/fx${refresh ? "?refresh=1" : ""}`).then((r) => setFx(r.item)).catch((e) => setErr(e.message));
    api.get("/calc/settings").then((r) => setBaseRate(Number(r.item?.exchangeRate) || null)).catch(() => {});
  }
  useEffect(() => load(), []);

  async function applyToSettings() {
    if (!fx) return;
    const rate = Math.round(fx.usdkrw * 100) / 100;
    if (!confirm(`원가계산 기준환율을 ${baseRate?.toLocaleString() ?? "-"} → ${rate.toLocaleString()} 원으로 바꿀까요?\n(이미 저장된 계산 기록은 바뀌지 않아요)`)) return;
    setApplying(true);
    try {
      await api.put("/calc/settings", { exchangeRate: rate });
      setBaseRate(rate);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setApplying(false);
    }
  }

  const series: { date: string; krw: number }[] = fx?.series || [];
  const W = 220, H = 44;
  const min = Math.min(...series.map((s) => s.krw)), max = Math.max(...series.map((s) => s.krw));
  const x = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : W / 2);
  const y = (v: number) => (max > min ? H - 4 - ((v - min) / (max - min)) * (H - 8) : H / 2);
  const path = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.krw).toFixed(1)}`).join(" ");
  const up = fx?.change != null && fx.change > 0;
  const down = fx?.change != null && fx.change < 0;
  const hv = hover != null ? series[hover] : null;
  const fmt = (n: number | null | undefined, d = 2) => (n == null ? "-" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));

  return (
    // 가로 한 줄: [원/달러 + 변동] [최근 30일 흐름] [EUR·CNY·JPY] [원가계산 기준환율]
    <div className="card flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary"><Icon name="currency_exchange" /></div>
        <div>
          <p className="mono-label text-on-surface-variant">원/달러 환율</p>
          {err && !fx ? (
            <p className="text-sm text-on-surface-variant">환율을 불러오지 못했어요</p>
          ) : !fx ? (
            <p className="text-sm text-on-surface-variant">불러오는 중…</p>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="headline text-2xl font-bold text-primary">{fmt(fx.usdkrw)}</span>
              {fx.change != null && (
                <span className={`text-xs font-semibold ${up ? "text-error" : down ? "text-secondary" : "text-on-surface-variant"}`}>
                  {up ? "▲" : down ? "▼" : "–"} {fmt(Math.abs(fx.change))}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {fx && series.length > 1 && (
        <div className="w-[240px]">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full overflow-visible" preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const i = Math.round(((e.clientX - rect.left) / rect.width) * (series.length - 1));
              setHover(Math.max(0, Math.min(series.length - 1, i)));
            }}>
            <path d={path} fill="none" stroke="#4059aa" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            {hv && <circle cx={x(hover!)} cy={y(hv.krw)} r={3} fill="#4059aa" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="flex justify-between text-[10px] text-on-surface-variant">
            <span>{hv ? `${hv.date.slice(5)} · ${fmt(hv.krw)}원` : `최근 ${series.length}영업일 흐름`}</span>
            <span>최저 {fmt(min, 0)} · 최고 {fmt(max, 0)}</span>
          </div>
        </div>
      )}

      {fx && (
        <div className="flex gap-6 text-xs">
          <div><div className="text-on-surface-variant">EUR</div><div className="font-semibold text-primary">{fmt(fx.eurkrw)}</div></div>
          <div><div className="text-on-surface-variant">CNY</div><div className="font-semibold text-primary">{fmt(fx.cnykrw)}</div></div>
          <div><div className="text-on-surface-variant">JPY 100</div><div className="font-semibold text-primary">{fmt(fx.jpykrw100)}</div></div>
        </div>
      )}

      {fx && (
        <div className="ml-auto flex items-center gap-3 text-xs">
          <div className="text-right">
            <div className="text-on-surface-variant">원가계산 기준환율</div>
            <div className="font-semibold text-primary">{baseRate != null ? baseRate.toLocaleString() : "-"}</div>
          </div>
          <button className="btn-secondary whitespace-nowrap px-2.5 py-1 text-xs disabled:opacity-50" disabled={applying} onClick={applyToSettings}>오늘 환율 적용</button>
          <button className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container" title="새로고침" onClick={() => load(true)}>
            <Icon name="refresh" size={18} />
          </button>
        </div>
      )}
      {fx && <p className="basis-full text-[10px] text-on-surface-variant/80">{fx.date} 기준 · {fx.source}{fx.stale ? " · 최신 값을 못 받아 이전 값 표시 중" : ""}</p>}
    </div>
  );
}
