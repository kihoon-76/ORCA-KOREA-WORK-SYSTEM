import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth, ROLE_LABEL } from "../auth";
import { PageHeader, Spinner, Empty, Modal, Field, Badge, Icon, FileManager } from "../components/ui";

const DOC_LABEL: Record<string, string> = { payment: "자금결제", general: "일반결재", trip: "출장결재", weekly: "주간결산" };

export default function Approvals() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"inbox" | "mine" | "all">(user!.role === "ceo" ? "inbox" : "mine");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createType, setCreateType] = useState<"payment" | "general" | null>(null);
  const [editItem, setEditItem] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);

  function load() {
    setLoading(true);
    const q = tab === "inbox" ? "?inbox=1" : tab === "mine" ? "?mine=1" : "";
    api.get(`/approvals${q}`).then((r) => setItems(r.items || [])).finally(() => setLoading(false));
  }
  useEffect(load, [tab]);

  // 자금결제 상신은 재무차장(finance)·관리자 또는 재무팀 소속, 일반결제 상신은 모든 직원
  const inFinanceDept = (user!.department || "").includes("재무");
  const canRequestPayment = user!.role === "finance" || user!.role === "admin" || inFinanceDept;
  const canRequestGeneral = user!.role !== "ceo";

  return (
    <div>
      <PageHeader title="전자결재" subtitle="자금결제: 재무차장 상신 → 대표이사 승인"
        action={(canRequestPayment || canRequestGeneral) ? (
          <div className="flex gap-2">
            {canRequestPayment && <button className="btn-primary" onClick={() => setCreateType("payment")}>+ 자금결제 상신</button>}
            {canRequestGeneral && <button className="btn-secondary" onClick={() => setCreateType("general")}>+ 일반결제 상신</button>}
          </div>
        ) : undefined} />

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

      <CreateModal docType={createType} editItem={editItem}
        onClose={() => { setCreateType(null); setEditItem(null); }}
        onSaved={() => { setCreateType(null); setEditItem(null); load(); }} />
      {detail && <DetailModal id={detail.id} role={user!.role} meId={user!.id}
        onClose={() => { setDetail(null); load(); }}
        onEdit={(item) => { setDetail(null); setEditItem(item); }} />}
    </div>
  );
}

const PAY_CATEGORIES = ["자재대금", "용역비", "운영비", "세금/공과금", "급여/4대보험", "임차료", "기타"];
const PAY_METHODS = ["계좌이체", "법인카드", "현금", "어음/수표"];

// 자금결제 상신서 본문 조립 (구조화 필드 → content 텍스트)
function buildPaymentContent(f: any): string {
  const amountStr = f.amount ? `${f.currency || "KRW"} ${Number(f.amount).toLocaleString()}` : "";
  const rows: [string, any][] = [
    ["지급구분", f.category],
    ["지급처(수취인)", f.payee],
    ["금액", amountStr],
    ["결제수단", f.method],
    ["지급예정일", f.payDate],
    ["예금주", f.holder],
  ];
  const lines = ["[자금결제 상신서]"];
  for (const [k, v] of rows) if (v) lines.push(`· ${k}: ${v}`);
  if (f.reason) lines.push("", "[지출 사유]", f.reason);
  return lines.join("\n");
}

// content 텍스트(buildPaymentContent 결과) → 구조화 필드 복원 (수정 시 폼 채우기 / 엑셀 출력용)
const PAY_FIELD_MAP: Record<string, string> = {
  "지급구분": "category", "지급처(수취인)": "payee", "결제수단": "method", "지급예정일": "payDate", "예금주": "holder",
};
function parsePaymentContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const reasonLines: string[] = [];
  let inReason = false;
  for (const line of (content || "").split("\n")) {
    if (line.startsWith("[지출 사유]")) { inReason = true; continue; }
    if (inReason) { reasonLines.push(line); continue; }
    if (line.startsWith("· ")) {
      const idx = line.indexOf(": ");
      if (idx > -1) { const k = line.slice(2, idx), key = PAY_FIELD_MAP[k]; if (key) out[key] = line.slice(idx + 2); }
    }
  }
  const reason = reasonLines.join("\n").trim();
  if (reason) out.reason = reason;
  return out;
}

// 엑셀(CSV) 다운로드 — UTF-8 BOM 으로 한글 깨짐 방지, 더블클릭 시 엑셀에서 바로 열림
function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
const STATUS_TEXT: Record<string, string> = { pending: "결재중", approved: "승인", rejected: "반려", cancelled: "취소됨" };
// 자금결제 한 건 → 항목/내용 2열 표 (엑셀 저장용)
function paymentRows(d: any): (string | number)[][] {
  const amountStr = d.amount ? `${d.currency || "KRW"} ${Number(d.amount).toLocaleString()}` : "";
  const rows: [string, string][] = [
    ["제목", d.title || ""], ["지급구분", d.category || ""], ["지급처(수취인)", d.payee || ""],
    ["금액", amountStr], ["결제수단", d.method || ""], ["지급예정일", d.payDate || ""],
    ["예금주", d.holder || ""], ["지출사유", d.reason || ""],
  ];
  if (d.status) rows.push(["상태", STATUS_TEXT[d.status] || d.status]);
  if (d.requester) rows.push(["상신자", d.requester]);
  if (d.createdAt) rows.push(["상신일", d.createdAt]);
  return [["항목", "내용"], ...rows];
}
function paymentFilename(title?: string): string {
  return `자금결제_${(title || "상신서").replace(/[\\/:*?"<>|]/g, "_")}.csv`;
}

function CreateModal({ docType, editItem, onClose, onSaved }: { docType: "payment" | "general" | null; editItem?: any; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!editItem;
  const dt = editItem ? editItem.doc_type : docType;
  const isPay = dt === "payment";
  const [f, setF] = useState<any>({ currency: "KRW", category: PAY_CATEGORIES[0], method: PAY_METHODS[0] });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!docType && !editItem) return;
    if (editItem) {
      const base: any = {
        title: editItem.title || "", currency: editItem.currency || "KRW",
        amount: editItem.amount != null ? String(editItem.amount) : "",
        category: PAY_CATEGORIES[0], method: PAY_METHODS[0],
      };
      if (editItem.doc_type === "payment") Object.assign(base, parsePaymentContent(editItem.content || ""));
      else base.content = editItem.content || "";
      setF(base);
    } else {
      setF({ currency: "KRW", category: PAY_CATEGORIES[0], method: PAY_METHODS[0] });
    }
    setFiles([]); setBusy(false);
  }, [docType, editItem]);
  if (!docType && !editItem) return null;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const valid = isPay ? f.title && f.payee && f.amount : f.title;
  async function save() {
    setBusy(true);
    try {
      const content = isPay ? buildPaymentContent(f) : f.content;
      const payload = { doc_type: dt, title: f.title, content, amount: f.amount ? Number(f.amount) : null, currency: f.currency };
      if (isEdit) {
        await api.put(`/approvals/${editItem.id}`, payload);
      } else {
        const res = await api.post("/approvals", payload);
        const newId = res?.item?.id;
        if (newId && files.length) {
          for (const file of files) await api.upload(file, "approval", newId, "approval");
        }
      }
      onSaved();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }
  function exportExcel() { downloadCsv(paymentFilename(f.title), paymentRows(f)); }

  return (
    <Modal open onClose={onClose} title={(isEdit ? "수정 · " : "") + (isPay ? "자금결제 상신" : "일반결제 상신")} wide={isPay}>
      <div className="space-y-3">
        <Field label="제목"><input className="input" value={f.title || ""} onChange={set("title")} placeholder={isPay ? "예) 2026년 6월 자재대금 지급" : "결재 제목"} /></Field>

        {isPay && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="지급구분">
                <select className="input" value={f.category} onChange={set("category")}>
                  {PAY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="결제수단">
                <select className="input" value={f.method} onChange={set("method")}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <Field label="지급처 (수취인/거래처)"><input className="input" value={f.payee || ""} onChange={set("payee")} /></Field>
          </>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="금액"><input type="text" inputMode="numeric" className="input" value={f.amount ? Number(f.amount).toLocaleString() : ""} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })} placeholder="0" /></Field></div>
          <Field label="통화"><input className="input" value={f.currency} onChange={set("currency")} /></Field>
        </div>

        {isPay && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="지급예정일"><input type="date" className="input" value={f.payDate || ""} onChange={set("payDate")} /></Field>
              <Field label="예금주"><input className="input" value={f.holder || ""} onChange={set("holder")} /></Field>
            </div>
            <Field label="지출 사유"><textarea className="input" rows={3} value={f.reason || ""} onChange={set("reason")} placeholder="지급 근거 및 상세 내역" /></Field>
          </>
        )}

        {!isPay && (
          <Field label="내용"><textarea className="input" rows={4} value={f.content || ""} onChange={set("content")} /></Field>
        )}

        {!isEdit && (
          <Field label="첨부파일 (선택)">
            <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
              <label className="btn-secondary inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-xs">
                <Icon name="upload" size={16} /> 파일 선택
                <input type="file" multiple className="hidden"
                  onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map((file, i) => (
                    <li key={i} className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-2 py-1.5 text-sm">
                      <span className="flex items-center gap-1 truncate text-slate-700"><Icon name="attach_file" size={16} /> {file.name}</span>
                      <button type="button" className="ml-2 text-on-surface-variant hover:text-error"
                        onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
        )}

        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {isEdit ? "수정 내용은 결재중인 동안에만 저장됩니다. 대표이사 승인/반려 후에는 수정할 수 없습니다." : "상신 시 대표이사 결재함으로 전달되며, 대표이사 승인 시 최종 확정됩니다."}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          {isPay && <button className="btn-secondary mr-auto" onClick={exportExcel} disabled={!f.title}>📊 엑셀 저장</button>}
          <button className="btn-secondary" onClick={onClose}>{isEdit ? "닫기" : "취소"}</button>
          <button className="btn-primary" onClick={save} disabled={!valid || busy}>{isEdit ? "수정 저장" : "상신"}</button>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal({ id, role, meId, onClose, onEdit }: { id: number; role: string; meId: number; onClose: () => void; onEdit: (item: any) => void }) {
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
  async function cancelReq() {
    if (!confirm("이 결재 상신을 취소하시겠습니까? 취소 후에는 되돌릴 수 없습니다.")) return;
    setBusy(true);
    try { await api.post(`/approvals/${id}/cancel`, {}); onClose(); }
    catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <Modal open onClose={onClose} title="결재 문서"><Spinner /></Modal>;
  const a = data.item;
  const currentStep = data.steps.find((s: any) => s.step_order === a.current_step);
  const canAct = a.status === "pending" && currentStep && currentStep.approver_role === role;
  const isMine = a.requester_id === meId;
  const canEdit = a.status === "pending" && isMine;
  function exportExcel() {
    const p = parsePaymentContent(a.content || "");
    downloadCsv(paymentFilename(a.title), paymentRows({
      title: a.title, amount: a.amount, currency: a.currency, ...p,
      status: a.status, requester: a.requester_name, createdAt: (a.created_at || "").slice(0, 10),
    }));
  }

  return (
    <Modal open onClose={onClose} title={a.title} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge value={a.status} />
          <span className="text-sm text-slate-500">{DOC_LABEL[a.doc_type] || a.doc_type} · 상신: {a.requester_name}</span>
          {a.doc_type === "payment" && isMine && (
            <button className="btn-secondary ml-auto text-xs" onClick={exportExcel}>📊 엑셀 저장</button>
          )}
        </div>
        {a.amount != null && <div className="text-2xl font-bold text-slate-800">{a.currency} {Number(a.amount).toLocaleString()}</div>}
        {a.content && <div className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{a.content}</div>}

        <FileManager entityType="approval" entityId={id} category="approval" label="첨부파일" />

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

        {canEdit && (
          <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
            <span className="text-xs text-slate-500">결재중인 문서는 회수하여 수정하거나 취소할 수 있습니다.</span>
            <button className="btn-danger ml-auto" onClick={cancelReq} disabled={busy}>상신 취소</button>
            <button className="btn-secondary" onClick={() => onEdit(a)} disabled={busy}>회수·수정</button>
          </div>
        )}

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
