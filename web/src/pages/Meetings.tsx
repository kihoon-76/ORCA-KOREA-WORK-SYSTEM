import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader, Spinner, Empty, Icon, Modal, Field, useList } from "../components/ui";

declare global { interface Window { JitsiMeetExternalAPI: any } }

interface Meeting { id: number; name: string; room: string; created_by: number; creator_name: string; created_at: string }

const JITSI_DOMAIN = "meet.jit.si";

function loadJitsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) return resolve();
    const s = document.createElement("script");
    s.src = `https://${JITSI_DOMAIN}/external_api.js`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("화상회의 모듈을 불러오지 못했습니다"));
    document.body.appendChild(s);
  });
}

function Room({ meeting, onLeave }: { meeting: Meeting; onLeave: () => void }) {
  const { user } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    loadJitsi().then(() => {
      if (disposed || !ref.current) return;
      const j = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
        roomName: meeting.room,
        parentNode: ref.current,
        width: "100%",
        height: "100%",
        userInfo: { displayName: user?.name || "ORCA" },
        configOverwrite: { prejoinPageEnabled: false, startWithAudioMuted: true, disableDeepLinking: true },
        interfaceConfigOverwrite: { MOBILE_APP_PROMO: false, SHOW_JITSI_WATERMARK: false },
      });
      apiRef.current = j;
      j.addEventListener("readyToClose", onLeave);
    }).catch((e) => setErr(e.message));
    return () => { disposed = true; try { apiRef.current?.dispose(); } catch { /* noop */ } };
  }, [meeting.room]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="videocam" className="text-secondary" />
          <h1 className="headline text-2xl font-bold text-primary">{meeting.name}</h1>
        </div>
        <button className="btn-secondary" onClick={onLeave}><Icon name="logout" size={18} /> 회의 나가기</button>
      </div>
      {err ? (
        <div className="card p-8 text-center text-error">{err}</div>
      ) : (
        <div className="card overflow-hidden" style={{ height: "calc(100vh - 12rem)" }}>
          <div ref={ref} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}

export default function Meetings() {
  const { user } = useAuth();
  const { items, loading, reload } = useList<Meeting>("/meetings");
  const [joined, setJoined] = useState<Meeting | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  async function create() {
    if (!name.trim()) return;
    const r = await api.post<{ item: Meeting }>("/meetings", { name: name.trim() });
    setOpen(false); setName(""); reload();
    setJoined(r.item);
  }
  async function end(m: Meeting, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`'${m.name}' 회의를 종료하시겠습니까?`)) return;
    await api.del(`/meetings/${m.id}`); reload();
  }

  if (joined) return <Room meeting={joined} onLeave={() => { setJoined(null); reload(); }} />;

  return (
    <div>
      <PageHeader title="화상회의" subtitle="회의방을 만들고 팀원과 화상으로 연결합니다"
        action={<button className="btn-primary" onClick={() => setOpen(true)}>+ 회의 개설</button>} />

      {loading ? <Spinner /> : items.length === 0 ? (
        <Empty text="진행중인 회의가 없습니다. 새 회의를 개설해보세요." icon="videocam_off" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <button key={m.id} onClick={() => setJoined(m)}
              className="card group flex flex-col gap-3 p-5 text-left transition-shadow hover:shadow-lg">
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-container text-on-secondary-container">
                  <Icon name="videocam" />
                </div>
                {(m.created_by === user!.id || user!.role === "admin") && (
                  <span onClick={(e) => end(m, e)} title="회의 종료"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-error-container hover:text-on-error-container">
                    <Icon name="call_end" size={18} />
                  </span>
                )}
              </div>
              <div>
                <div className="font-bold text-primary">{m.name}</div>
                <div className="mt-0.5 text-xs text-on-surface-variant">개설: {m.creator_name || "-"}</div>
              </div>
              <div className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-secondary group-hover:underline">
                입장하기 <Icon name="arrow_forward" size={16} />
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="회의 개설">
        <div className="space-y-3">
          <Field label="회의 이름">
            <input className="input" autoFocus placeholder="예: 주간 영업회의" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          </Field>
          <p className="text-xs text-on-surface-variant">개설 후 바로 입장합니다. 다른 직원은 화상회의 목록에서 같은 방으로 들어올 수 있습니다.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>취소</button>
            <button className="btn-primary" onClick={create} disabled={!name.trim()}>개설 후 입장</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
