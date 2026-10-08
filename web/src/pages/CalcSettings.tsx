import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Field } from "../components/ui";

// [원료수입] 품질규격 비교 / 예상판가 빠른계산에서 공통으로 쓰는 기준정보(환율·LC개설처별 마진율·
// 물류비·가공비/로스율·오르카 판매 마진율)를 관리하는 설정 페이지. 엑셀 [기준정보] 탭과 동일한 역할.

interface Settings {
  exchangeRate: number;
  lcMargin: Record<string, number>;
  logistics: { customs: number; cntr: number; melting: number; transport1: number; transport2: number };
  processing: Record<string, { cost: number; loss: number }>;
  salesMarginRate: number;
}

function NumInput({ value, onChange, suffix, step = "1" }: { value: number; onChange: (v: number) => void; suffix?: string; step?: string }) {
  return (
    <div className="flex items-center gap-1">
      <input type="number" step={step} className="input w-32" value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {suffix && <span className="text-xs text-on-surface-variant">{suffix}</span>}
    </div>
  );
}

export default function CalcSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => { api.get("/calc/settings").then((r) => setS(r.item)); }, []);

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const r = await api.put("/calc/settings", s);
      setS(r.item);
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!s) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="기준정보 설정" subtitle="품질규격 비교 · 예상판가 계산에 쓰이는 환율·마진율·물류비·가공비 기준값입니다. 여기서 수정하면 전체 계산에 바로 반영됩니다." />

      <div className="card space-y-5 p-6">
        <div>
          <h3 className="mb-3 text-sm font-bold text-primary">환율</h3>
          <Field label="미화환율 (₩/USD)"><NumInput value={s.exchangeRate} onChange={(v) => setS({ ...s, exchangeRate: v })} /></Field>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-primary">LC 개설처별 Orca 마진율</h3>
          <div className="space-y-2">
            {Object.entries(s.lcMargin).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3">
                <span className="text-sm text-on-surface-variant">{k}</span>
                <NumInput value={v * 100} step="0.1" suffix="%" onChange={(nv) => setS({ ...s, lcMargin: { ...s.lcMargin, [k]: nv / 100 } })} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-primary">공통 물류비 기준 (₩/kg)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="통관비 (Local CHG)"><NumInput value={s.logistics.customs} onChange={(v) => setS({ ...s, logistics: { ...s.logistics, customs: v } })} /></Field>
            <Field label="컨테이너 운송료"><NumInput value={s.logistics.cntr} onChange={(v) => setS({ ...s, logistics: { ...s.logistics, cntr: v } })} /></Field>
            <Field label="멜팅비"><NumInput value={s.logistics.melting} onChange={(v) => setS({ ...s, logistics: { ...s.logistics, melting: v } })} /></Field>
            <Field label="1차 운송"><NumInput value={s.logistics.transport1} onChange={(v) => setS({ ...s, logistics: { ...s.logistics, transport1: v } })} /></Field>
            <Field label="2차 운송"><NumInput value={s.logistics.transport2} onChange={(v) => setS({ ...s, logistics: { ...s.logistics, transport2: v } })} /></Field>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-primary">가공 Type별 가공비 · 로스율</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-on-surface-variant"><th className="py-1">Type</th><th className="py-1">가공비 (₩/kg)</th><th className="py-1">로스율 (%)</th></tr></thead>
              <tbody>
                {Object.entries(s.processing).map(([k, v]) => (
                  <tr key={k} className="border-t border-outline-variant">
                    <td className="py-2 font-semibold">{k}</td>
                    <td className="py-2"><NumInput value={v.cost} onChange={(nv) => setS({ ...s, processing: { ...s.processing, [k]: { ...v, cost: nv } } })} /></td>
                    <td className="py-2"><NumInput value={v.loss * 100} step="0.1" suffix="%" onChange={(nv) => setS({ ...s, processing: { ...s.processing, [k]: { ...v, loss: nv / 100 } } })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold text-primary">오르카 판매 마진율</h3>
          <Field label="예상판가 마진율"><NumInput value={s.salesMarginRate * 100} step="0.1" suffix="%" onChange={(v) => setS({ ...s, salesMarginRate: v / 100 })} /></Field>
        </div>

        <div className="flex items-center gap-3 border-t border-outline-variant pt-4">
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "저장중..." : "저장"}</button>
          {savedAt && <span className="text-xs text-on-surface-variant">{savedAt} 저장됨</span>}
        </div>
      </div>
    </div>
  );
}
