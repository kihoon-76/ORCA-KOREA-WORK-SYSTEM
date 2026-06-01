import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth, ROLE_LABEL } from "../auth";
import { PageHeader, Spinner, Empty, Modal, Field, Badge, FileManager } from "../components/ui";
import { mondayOf, weekLabel } from "../week";

export default function WeeklyReports() {
  const { user } = useAuth();
  const isReporter = user!.role !== "ceo" && user!.role !== "admin";
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<{ id: number | "new"; weekStart: string } | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const thisWeek = mondayOf();
  const myThisWeek = items.find((w) => w.user_id === user!.id && w.week_start === thisWeek);

  function load() {
    setLoading(true);
    api.get(`/weekly${isReporter ? "?mine=1" : ""}`).then((r) => setItems(r.items || [])).finally(() => setLoading(false));
  }
  useEffect(load, []);

  return (
    <div>
      <PageHeader
        title="주간결산 보고"
        subtitle={isReporter ? "매주 진행사항·완료사항을 작성하여 대표이사에게 결재 상신합니다 (마감: 금요일 17:00)" : "담당자별 주간결산 보고 검토 및 결재"}
        action={isReporter && !myThisWeek ? <button className="btn-primary" onClick={() => setEdit({ id: "new", weekStart: thisWeek })}>+ 이번 주 주간결산 작성</button> : undefined}
      />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Empty text={isReporter ? "작성한 주간결산 보고가 없습니다" : "상신된 주간결산 보고가 없습니다"} icon="event_note" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead><tr className="bg-slate-50">
              <th className="th">주차</th>
              {!isReporter && <th className="th">담당자</th>}
              <th className="th">진행/완료 요약</th>
              <th className="th">상태</th>
              <th className="th"></th>
            </tr></thead>
            <tbody>
              {items.map((w) => {
                const editable = w.user_id === user!.id && (w.status === "draft" || w.status === "rejected");
                return (
                  <tr key={w.id}>
                    <td className="td font-medium">{w.week_label || weekLabel(w.week_start)}</td>
                    {!isReporter && <td className="td">{w.user_name}<span className="ml-1 text-xs text-slate-400">{w.user_department || ""}</span></td>}
                    <td className="td max-w-[280px] truncate text-slate-500">{w.completed || w.progress || "-"}</td>
                    <td className="td"><Badge value={w.status} /></td>
                    <td className="td text-right space-x-2">
                      {editable && <button className="text-xs text-brand-600 hover:underline" onClick={() => setEdit({ id: w.id, weekStart: w.week_start })}>수정/상신</button>}
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setDetailId(w.id)}>열기</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {edit !== null && (
        <EditModal
          id={edit.id}
          weekStart={edit.weekStart}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); }}
        />
      )}
      {detailId !== null && (
        <DetailModal id={detailId} role={user!.role} userId={user!.id} onClose={() => { setDetailId(null); load(); }} />
      )}
    </div>
  );
}

function EditModal({ id, weekStart, onClose, onSaved }: { id: number | "new"; weekStart: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ progress: "", completed: "" });
  const [reportId, setReportId] = useState<number | null>(typeof id === "number" ? id : null);
  const [loading, setLoading] = useState(typeof id === "number");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof id === "number") {
      api.get(`/weekly/${id}`).then((r) => {
        setF({ progress: r.item.progress || "", completed: r.item.completed || "" });
      }).finally(() => setLoading(false));
    }
  }, [id]);

  async function saveDraft(): Promise<number | null> {
    setBusy(true);
    try {
      const r = await api.post("/weekly", {
        week_start: weekStart,
        week_label: weekLabel(weekStart),
        progress: f.progress,
        completed: f.completed,
      });
      setReportId(r.item.id);
      return r.item.id;
    } catch (e: any) { alert(e.message); return null; }
    finally { setBusy(false); }
  }

  async function submit() {
    const rid = reportId ?? (await saveDraft());
    if (!rid) return;
    if (!confirm("대표이사에게 결재 상신하시겠습니까? 상신 후에는 수정할 수 없습니다.")) return;
    setBusy(true);
    try { await api.post(`/weekly/${rid}/submit`); onSaved(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`주간결산 작성 (${weekLabel(weekStart)})`} wide>
      {loading ? <Spinner /> : (
        <div className="space-y-3">
          <Field label="진행사항">
            <textarea className="input" rows={5} placeholder="이번 주 진행 중인 업무를 작성하세요"
              value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value })} />
          </Field>
          <Field label="완료사항">
            <textarea className="input" rows={5} placeholder="이번 주 완료한 업무를 작성하세요"
              value={f.completed} onChange={(e) => setF({ ...f, completed: e.target.value })} />
          </Field>

          {reportId ? (
            <FileManager entityType="weekly_report" entityId={reportId} category="weekly" label="첨부파일" />
          ) : (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">먼저 [임시저장]을 하면 첨부파일을 추가할 수 있습니다.</p>
          )}

          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">상신 시 대표이사 결재함으로 전달되며, 대표이사가 의견과 함께 승인/반려합니다.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>닫기</button>
            <button className="btn-secondary" onClick={saveDraft} disabled={busy}>임시저장</button>
            <button className="btn-primary" onClick={submit} disabled={busy}>결재 상신</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function DetailModal({ id, role, userId, onClose }: { id: number; role: string; userId: number; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  function load() { api.get(`/weekly/${id}`).then(setData); }
  useEffect(load, [id]);

  async function act(action: "approve" | "reject") {
    if (!data?.approval) return;
    setBusy(true);
    try { await api.post(`/approvals/${data.approval.id}/action`, { action, comment }); setComment(""); load(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <Modal open onClose={onClose} title="주간결산 보고"><Spinner /></Modal>;
  const w = data.item;
  const ap = data.approval;
  const currentStep = data.steps.find((s: any) => s.step_order === ap?.current_step);
  const canAct = ap && ap.status === "pending" && currentStep && currentStep.approver_role === role;

  return (
    <Modal open onClose={onClose} title={`주간결산 — ${w.user_name}`} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge value={w.status} />
          <span className="text-sm text-slate-500">{w.week_label || w.week_start} · {w.user_name} {w.user_department ? `(${w.user_department})` : ""}</span>
        </div>

        <div>
          <div className="mb-1 text-sm font-semibold text-slate-600">진행사항</div>
          <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{w.progress || "-"}</div>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold text-slate-600">완료사항</div>
          <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{w.completed || "-"}</div>
        </div>

        <FileManager entityType="weekly_report" entityId={w.id} category="weekly" label="첨부파일" />

        {ap && (
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-600">결재선</div>
            <ol className="space-y-2">
              {data.steps.map((s: any) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="w-20 text-sm font-medium text-slate-700">{ROLE_LABEL[s.approver_role] || s.approver_role}</span>
                  <Badge value={s.status} />
                  {s.approver_name && <span className="text-xs text-slate-500">{s.approver_name}</span>}
                  {s.acted_at && <span className="text-xs text-slate-400">{s.acted_at}</span>}
                  {s.comment && <span className="text-xs text-slate-600">– 의견: {s.comment}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {canAct && (
          <div className="border-t border-slate-200 pt-3 space-y-2">
            <Field label="대표 의견"><textarea className="input" rows={2} placeholder="결재 의견을 입력하세요 (선택)" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn-danger" onClick={() => act("reject")} disabled={busy}>반려</button>
              <button className="btn-primary" onClick={() => act("approve")} disabled={busy}>승인</button>
            </div>
          </div>
        )}

        {w.user_id === userId && w.status === "rejected" && (
          <p className="rounded-md bg-error-container px-3 py-2 text-sm text-on-error-container">반려되었습니다. 목록에서 [수정/상신]으로 다시 상신해 주세요.</p>
        )}
      </div>
    </Modal>
  );
}
