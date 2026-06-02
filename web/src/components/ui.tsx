import { ReactNode, useEffect, useState } from "react";
import { api } from "../api";

export function Icon({ name, className = "", size }: { name: string; className?: string; size?: number }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={size ? { fontSize: size } : undefined}>
      {name}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-outline-variant border-t-secondary" />
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="headline text-3xl font-bold tracking-tight text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary/40 p-4 sm:p-8 backdrop-blur-sm" onClick={onClose}>
      <div className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} my-8 rounded-xl shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
          <h2 className="headline font-bold text-primary">{title}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container">
            <Icon name="close" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function Empty({ text = "데이터가 없습니다", icon = "inbox" }: { text?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-on-surface-variant">
      <Icon name={icon} className="opacity-40" size={40} />
      <p className="text-sm">{text}</p>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  todo: "bg-surface-container-highest text-on-surface-variant", in_progress: "bg-secondary-fixed text-on-secondary-container", done: "bg-success-container text-success",
  pending: "bg-tertiary-fixed text-on-tertiary-container", approved: "bg-success-container text-success", rejected: "bg-error-container text-on-error-container", cancelled: "bg-surface-container-highest text-on-surface-variant",
  draft: "bg-surface-container-highest text-on-surface-variant", submitted: "bg-tertiary-fixed text-on-tertiary-container",
  contracted: "bg-surface-container-highest text-on-surface-variant", shipped: "bg-secondary-fixed text-on-secondary-container", arrived: "bg-primary-fixed text-on-primary-fixed",
  cleared: "bg-success-container text-success", planned: "bg-tertiary-fixed text-on-tertiary-container", completed: "bg-success-container text-success",
  low: "bg-surface-container-highest text-on-surface-variant", normal: "bg-surface-container-highest text-on-surface-variant", high: "bg-tertiary-fixed text-on-tertiary-container", urgent: "bg-error-container text-on-error-container",
};
const STATUS_LABEL: Record<string, string> = {
  todo: "대기", in_progress: "진행중", done: "완료", pending: "결재중", approved: "승인", rejected: "반려", cancelled: "취소됨",
  draft: "작성중", submitted: "상신완료",
  contracted: "계약", shipped: "선적", arrived: "도착", cleared: "통관/입고", planned: "예정", completed: "완료",
  low: "낮음", normal: "보통", high: "높음", urgent: "긴급", annual: "연차", sick: "병가",
};
export function Badge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_STYLES[value] || "bg-surface-container-highest text-on-surface-variant"}`}>{STATUS_LABEL[value] || value}</span>;
}

export function useList<T = any>(path: string, deps: any[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  function reload() {
    setLoading(true);
    api.get<{ items: T[] }>(path).then((r) => { setItems(r.items || []); setError(null); })
      .catch((e) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(reload, deps);
  return { items, loading, error, reload, setItems };
}

export function FileManager({ entityType, entityId, category, label }: { entityType: string; entityId: number; category: string; label: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  function load() {
    api.get(`/files/list?entity_type=${entityType}&entity_id=${entityId}&category=${category}`)
      .then((r) => setFiles(r.items || []));
  }
  useEffect(load, [entityType, entityId, category]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { await api.upload(file, entityType, entityId, category); load(); }
    catch (err: any) { alert(err.message); }
    finally { setBusy(false); e.target.value = ""; }
  }
  async function remove(id: number) {
    if (!confirm("삭제하시겠습니까?")) return;
    await api.del(`/files/${id}`); load();
  }

  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-low p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono-label text-on-surface-variant">{label}</span>
        <label className="btn-secondary cursor-pointer rounded-lg px-2.5 py-1 text-xs">
          <Icon name="upload" size={16} />{busy ? "업로드중..." : "파일 첨부"}
          <input type="file" className="hidden" onChange={onUpload} disabled={busy} />
        </label>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-on-surface-variant opacity-70">첨부된 파일이 없습니다</p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-2 py-1.5 text-sm">
              <button className="flex items-center gap-1 truncate text-secondary hover:underline" onClick={() => api.download(f.id, f.file_name)}>
                <Icon name="attach_file" size={16} /> {f.file_name}
              </button>
              <button className="ml-2 text-on-surface-variant hover:text-error" onClick={() => remove(f.id)}><Icon name="delete" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
