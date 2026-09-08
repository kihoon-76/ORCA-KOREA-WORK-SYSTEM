import { useEffect, useState } from "react";
import { api } from "../api";
import { PageHeader, Spinner, Empty, Icon } from "../components/ui";

function fmtSize(n?: number | null) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtDate(s: string) {
  return (s || "").slice(0, 16).replace("T", " ");
}

interface Folder { id: number; name: string; parent_id: number | null; created_by_name?: string; created_at: string }
interface FileItem { id: number; file_name: string; content_type?: string; size?: number; created_at: string }

export default function Drive() {
  const [currentId, setCurrentId] = useState<number | null>(null); // null = 루트
  const [path, setPath] = useState<{ id: number; name: string }[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [usage, setUsage] = useState<{ total_bytes: number; file_count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    const folderQuery = currentId ? `?parent_id=${currentId}` : "";
    Promise.all([
      api.get(`/drive/folders${folderQuery}`),
      api.get(`/files/list?entity_type=drive_folder&entity_id=${currentId ?? 0}`),
      currentId ? api.get(`/drive/folders/${currentId}/path`) : Promise.resolve({ path: [] }),
    ])
      .then(([f, files2, p]) => {
        setFolders(f.items || []);
        setFiles(files2.items || []);
        setPath(p.path || []);
      })
      .finally(() => setLoading(false));
  }
  function loadUsage() {
    api.get("/drive/usage").then(setUsage).catch(() => {});
  }
  useEffect(load, [currentId]);
  useEffect(loadUsage, []);

  async function createFolder() {
    const name = prompt("새 폴더 이름을 입력하세요")?.trim();
    if (!name) return;
    try {
      await api.post("/drive/folders", { name, parent_id: currentId });
      load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function removeFolder(f: Folder) {
    if (!confirm(`"${f.name}" 폴더를 삭제할까요? (폴더가 비어있어야 삭제됩니다)`)) return;
    try {
      await api.del(`/drive/folders/${f.id}`);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(fileList)) {
        await api.upload(file, "drive_folder", currentId ?? 0, "general");
      }
      load();
      loadUsage();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function removeFile(id: number) {
    if (!confirm("이 파일을 삭제하시겠습니까?")) return;
    await api.del(`/files/${id}`);
    load();
    loadUsage();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="파일함"
        subtitle="회사 공용 파일 저장 · 백업 공간입니다. 팀원 누구나 열람/업로드할 수 있어요."
        action={
          <div className="flex items-center gap-3">
            {usage && (
              <span className="mono-label rounded-lg bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant">
                총 사용량 {fmtSize(usage.total_bytes)} · 파일 {usage.file_count}개
              </span>
            )}
            <button className="btn-secondary" onClick={createFolder}><Icon name="create_new_folder" size={18} /> 새 폴더</button>
            <label className="btn-primary cursor-pointer">
              <Icon name="upload" size={18} />{busy ? "업로드중..." : "파일 업로드"}
              <input type="file" multiple className="hidden" onChange={onUpload} disabled={busy} />
            </label>
          </div>
        }
      />

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button className={`rounded px-2 py-1 hover:bg-surface-container-low ${currentId === null ? "font-bold text-primary" : "text-secondary"}`}
          onClick={() => setCurrentId(null)}>
          <Icon name="folder_open" size={16} className="mr-1 align-middle" />전체 파일함
        </button>
        {path.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1">
            <Icon name="chevron_right" size={16} className="text-on-surface-variant" />
            <button className={`rounded px-2 py-1 hover:bg-surface-container-low ${i === path.length - 1 ? "font-bold text-primary" : "text-secondary"}`}
              onClick={() => setCurrentId(p.id)}>
              {p.name}
            </button>
          </span>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : folders.length === 0 && files.length === 0 ? (
        <Empty text="이 폴더가 비어있습니다" icon="folder_open" />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr><th className="th">이름</th><th className="th">종류</th><th className="th">크기</th><th className="th">업로드</th><th className="th">등록일</th><th className="th"></th></tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {folders.map((f) => (
                  <tr key={`folder-${f.id}`} className="cursor-pointer transition-colors hover:bg-surface-container-low" onClick={() => setCurrentId(f.id)}>
                    <td className="td font-bold"><Icon name="folder" className="mr-1 align-middle text-secondary" size={18} />{f.name}</td>
                    <td className="td text-on-surface-variant">폴더</td>
                    <td className="td text-on-surface-variant">-</td>
                    <td className="td text-on-surface-variant">{f.created_by_name || "-"}</td>
                    <td className="td font-mono text-xs">{fmtDate(f.created_at)}</td>
                    <td className="td text-right">
                      <button className="text-on-surface-variant hover:text-error" onClick={(e) => { e.stopPropagation(); removeFolder(f); }}>
                        <Icon name="delete" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
                {files.map((f) => (
                  <tr key={`file-${f.id}`} className="transition-colors hover:bg-surface-container-low">
                    <td className="td font-bold">
                      <button className="flex items-center gap-1 text-left text-secondary hover:underline" onClick={() => api.download(f.id, f.file_name)}>
                        <Icon name="description" size={18} />{f.file_name}
                      </button>
                    </td>
                    <td className="td text-on-surface-variant">{f.content_type || "-"}</td>
                    <td className="td text-on-surface-variant">{fmtSize(f.size)}</td>
                    <td className="td text-on-surface-variant">-</td>
                    <td className="td font-mono text-xs">{fmtDate(f.created_at)}</td>
                    <td className="td text-right">
                      <button className="text-on-surface-variant hover:text-error" onClick={() => removeFile(f.id)}>
                        <Icon name="delete" size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
