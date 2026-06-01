import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth, ROLE_LABEL } from "../auth";
import { PageHeader, Spinner, Empty, Modal, Field, Badge } from "../components/ui";

const DOC_LABEL: Record<string, string> = { payment: "자금결제", general: "일반결재", trip: "출장결재" };

export default function Approvals() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"inbox" | "mine" | "all">(user!.role === "ceo" ? "inbox" : "mine");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  function load() {
    setLoading(true);
    const q = tab === "inbox" ? "?inbox=1" : tab === "mine" ? "?mine=1" : "";
    api.get(`/approvals${q}`).then((r) => setItems(r.items || [])).finally(() => setLoading(false));
  }
  useEffect(load, [tab]);

  // 자금결제 상신은 재무차장(finance) / 관리자
  const canRequest = user!.role === "finance" || user!.role === "admin";

  return (
    <div>
      <PageHeader title="전자결재" subtitle="자금결제: 재무차장 상신 → 대표이사 승인"
        action={canRequest ? <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ 자금결제 상신</button> : undefined} />

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1 text-sm w-fit">
        {[["inbox", "결재함"], ["mine", "내 상신함"], ["all", "전체"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === k ? "bg-white shadow text-brand-700" : "text-slate-600"}`}>{l}</button>
        ))}
      </div>

      {loading ? <Spinner /> : items.length === 0 ? <Empty text={tab === "inbox" ? "결재할 문서가 없습니다" : "문서가 없습니다"} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr className="bg-slate-50">
              <th className="th">유형</th><th className="th">제목</th><th className="th">금액</th>
              <th className="th">상신자</th><th className="th">상신일</th><th className="th">상태</th><th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="td">{DOC_LABEL[a.doc_type] || a.doc_type}</td>
                  <td className="td font-medium">{a.title}</td>
                  <td className="td">{a.amount != null ? `${a.currency} ${Number(a.amount).toLocaleString()}` : "-"}</td>
                  <td className="td">{a.requester_name}</td>
                  <td className="td">{(a.created_at || "").slice(0, 10)}</td>
                  <td className="td"><Badge value={a.status} /></td>
                  <td className="td text-right"><button className="text-xs text-brand-600 hover:underline" onClick={() => setDetail({ id: a.id })}>열기</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); load(); }} />
      {detail && <DetailModal id={detail.id} role={user!.role} onClose={() => { setDetail(null); load(); }} />}
    </div>
  );
}

function CreateModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ doc_type: "payment", currency: "KRW" });
  async function save() {
    await api.post("/approvals", { doc_type: f.doc_type, title: f.title, content: f.content, amount: f.amount ? Number(f.amount) : null, currency: f.currency });
    setF({ doc_type: "payment", currency: "KRW" }); onSaved();
  }
  return (
    <Modal open={open} onClose={onClose} title="자금결제 상신">
      <div className="space-y-3">
        <Field label="결재 유형">
          <select className="input" value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })}>
            <option value="payment">자금결제</option><option value="general">일반결재</option><option value="trip">출장결재</option>
          </select>
        </Field>
        <Field label="제목"><input className="input" value={f.title || ""} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="금액"><input type="number" className="input" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field></div>
          <Field label="통화"><input className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></Field>
        </div>
        <Field label="내용"><textarea className="input" rows={4} value={f.content || ""} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field>
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">상신 시 대표이사 결재함으로 전달되며, 대표이사 승인 시 최종 확정됩니다.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-secondary" onClick={onClose}>취소</button>
          <button className="btn-primary" onClick={save} disabled={!f.title}>상신</button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ id, role, onClose }: { id: number; role: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  function load() { api.get(`/approvals/${id}`).then(setData); }
  useEffect(load, [id]);

  async function act(action: "approve" | "reject") {
    setBusy(true);
    try { await api.post(`/approvals/${id}/action`, { action, comment }); load(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <Modal open onClose={onClose} title="결재 문서"><Spinner /></Modal>;
  const a = data.item;
  const currentStep = data.steps.find((s: any) => s.step_order === a.current_step);
  const canAct = a.status === "pending" && currentStep && currentStep.approver_role === role;

  return (
    <Modal open onClose={onClose} title={a.title} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge value={a.status} />
          <span className="text-sm text-slate-500">{DOC_LABEL[a.doc_type] || a.doc_type} · 상신: {a.requester_name}</span>
        </div>
        {a.amount != null && <div className="text-2xl font-bold text-slate-800">{a.currency} {Number(a.amount).toLocaleString()}</div>}
        {a.content && <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{a.content}</div>}

        <div>
          <div className="mb-2 text-sm font-semibold text-slate-600">결재선</div>
          <ol className="space-y-2">
            {data.steps.map((s: any) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <span className="text-sm font-medium text-slate-700 w-20">{ROLE_LABEL[s.approver_role] || s.approver_role}</span>
                <Badge value={s.status} />
                {s.approver_name && <span className="text-xs text-slate-500">{s.approver_name}</span>}
                {s.acted_at && <span className="text-xs text-slate-400">{s.acted_at}</span>}
                {s.comment && <span className="text-xs text-slate-500">– {s.comment}</span>}
              </li>
            ))}
          </ol>
        </div>

        {canAct && (
          <div className="border-t border-slate-200 pt-3 space-y-2">
            <Field label="결재 의견 (선택)"><input className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn-danger" onClick={() => act("reject")} disabled={busy}>반려</button>
              <button className="btn-primary" onClick={() => act("approve")} disabled={busy}>승인</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
