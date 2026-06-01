import { useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Modal, Field, useList, FileManager } from "../components/ui";

export default function Materials() {
  const mats = useList<any>("/materials");
  const analyses = useList<any>("/materials/analyses");
  const [matOpen, setMatOpen] = useState(false);
  const [mat, setMat] = useState<any>(null);
  const [anaOpen, setAnaOpen] = useState(false);
  const [ana, setAna] = useState<any>(null);

  async function saveMat() {
    const body = { code: mat.code, name: mat.name, spec: mat.spec, unit: mat.unit || "MT", origin: mat.origin, note: mat.note };
    if (mat.id) await api.put(`/materials/${mat.id}`, body); else await api.post("/materials", body);
    setMatOpen(false); mats.reload();
  }
  async function removeMat(id: number) { if (confirm("삭제하시겠습니까?")) { await api.del(`/materials/${id}`); mats.reload(); } }

  async function saveAna() {
    if (ana.id) { setAnaOpen(false); analyses.reload(); return; }
    const r = await api.post("/materials/analyses", {
      material_id: ana.material_id || null, sample_no: ana.sample_no, analyzed_at: ana.analyzed_at, result_summary: ana.result_summary,
    });
    setAna(r.item); analyses.reload(); // 등록 후 파일 첨부 가능하도록 유지
  }
  async function removeAna(id: number) { if (confirm("삭제하시겠습니까?")) { await api.del(`/materials/analyses/${id}`); analyses.reload(); } }

  return (
    <div>
      <PageHeader title="원료 / 분석결과" subtitle="원료 마스터와 샘플 분석결과를 관리합니다"
        action={<div className="flex gap-2">
          <button className="btn-secondary" onClick={() => { setAna({ analyzed_at: new Date().toISOString().slice(0,10) }); setAnaOpen(true); }}>+ 분석결과</button>
          <button className="btn-primary" onClick={() => { setMat({ unit: "MT" }); setMatOpen(true); }}>+ 원료 등록</button>
        </div>} />

      <h2 className="mb-2 text-sm font-semibold text-slate-600">🧪 원료 마스터</h2>
      {mats.loading ? <Spinner /> : mats.items.length === 0 ? <Empty /> : (
        <div className="card mb-6 overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead><tr className="bg-slate-50"><th className="th">코드</th><th className="th">원료명</th><th className="th">규격</th><th className="th">단위</th><th className="th">원산지</th><th className="th"></th></tr></thead>
            <tbody>
              {mats.items.map((m) => (
                <tr key={m.id}>
                  <td className="td">{m.code || "-"}</td><td className="td font-medium">{m.name}</td><td className="td">{m.spec || "-"}</td>
                  <td className="td">{m.unit}</td><td className="td">{m.origin || "-"}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => { setMat({ ...m }); setMatOpen(true); }}>수정</button>
                    <button className="ml-2 text-xs text-red-500 hover:underline" onClick={() => removeMat(m.id)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-600">📋 샘플 분석결과</h2>
      {analyses.loading ? <Spinner /> : analyses.items.length === 0 ? <Empty text="분석결과가 없습니다" /> : (
        <div className="space-y-2">
          {analyses.items.map((a) => (
            <div key={a.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium">{a.material_name || "원료 미지정"} <span className="text-xs text-slate-400">샘플 {a.sample_no || "-"}</span></div>
                  <div className="text-xs text-slate-500">분석일: {a.analyzed_at || "-"}</div>
                  {a.result_summary && <p className="mt-1 text-sm text-slate-600">{a.result_summary}</p>}
                </div>
                <div className="flex gap-2">
                  <button className="text-xs text-brand-600 hover:underline" onClick={() => { setAna({ ...a }); setAnaOpen(true); }}>파일</button>
                  <button className="text-xs text-red-500 hover:underline" onClick={() => removeAna(a.id)}>삭제</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 원료 마스터 모달 */}
      <Modal open={matOpen} onClose={() => setMatOpen(false)} title={mat?.id ? "원료 수정" : "원료 등록"}>
        {mat && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="코드"><input className="input" value={mat.code || ""} onChange={(e) => setMat({ ...mat, code: e.target.value })} /></Field>
              <Field label="원료명"><input className="input" value={mat.name || ""} onChange={(e) => setMat({ ...mat, name: e.target.value })} /></Field>
              <Field label="규격"><input className="input" value={mat.spec || ""} onChange={(e) => setMat({ ...mat, spec: e.target.value })} /></Field>
              <Field label="단위"><input className="input" value={mat.unit || ""} onChange={(e) => setMat({ ...mat, unit: e.target.value })} /></Field>
              <Field label="원산지"><input className="input" value={mat.origin || ""} onChange={(e) => setMat({ ...mat, origin: e.target.value })} /></Field>
            </div>
            <Field label="비고"><input className="input" value={mat.note || ""} onChange={(e) => setMat({ ...mat, note: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setMatOpen(false)}>취소</button>
              <button className="btn-primary" onClick={saveMat} disabled={!mat.name}>저장</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 분석결과 모달 */}
      <Modal open={anaOpen} onClose={() => { setAnaOpen(false); analyses.reload(); }} title={ana?.id ? "분석결과 상세" : "분석결과 등록"}>
        {ana && (
          <div className="space-y-3">
            <Field label="원료">
              <select className="input" value={ana.material_id || ""} onChange={(e) => setAna({ ...ana, material_id: e.target.value })}>
                <option value="">미지정</option>
                {mats.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="샘플번호"><input className="input" value={ana.sample_no || ""} onChange={(e) => setAna({ ...ana, sample_no: e.target.value })} /></Field>
              <Field label="분석일"><input type="date" className="input" value={ana.analyzed_at || ""} onChange={(e) => setAna({ ...ana, analyzed_at: e.target.value })} /></Field>
            </div>
            <Field label="결과 요약"><textarea className="input" rows={2} value={ana.result_summary || ""} onChange={(e) => setAna({ ...ana, result_summary: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setAnaOpen(false); analyses.reload(); }}>닫기</button>
              <button className="btn-primary" onClick={saveAna}>{ana.id ? "확인" : "등록"}</button>
            </div>
            {ana.id ? (
              <div className="border-t border-slate-200 pt-3">
                <FileManager entityType="material" entityId={ana.id} category="analysis" label="📄 분석성적서 / 결과파일" />
              </div>
            ) : <p className="border-t border-slate-200 pt-3 text-xs text-slate-400">등록 후 분석결과 파일을 첨부할 수 있습니다.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
