import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon } from "./ui";

const POLL_MS = 60_000; // 1분마다 새 알림 확인

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(false);
  openRef.current = open;

  function load() {
    api.get("/notifications").then((r) => {
      setItems(r.items || []);
      setUnread(r.unread || 0);
    }).catch(() => {});
  }

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(() => { if (!openRef.current) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [user]);

  async function onItem(n: any) {
    if (!n.read_at) {
      try { await api.post(`/notifications/${n.id}/read`); } catch {}
    }
    setOpen(false);
    if (n.related_type === "approval") navigate("/approvals");
    load();
  }

  async function readAll() {
    try { await api.post("/notifications/read-all"); } catch {}
    load();
  }

  return (
    <div className="relative">
      <button onClick={() => { setOpen((v) => !v); if (!open) load(); }} title="알림"
        className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-container-low">
        <Icon name="notifications" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-outline-variant bg-surface-container-lowest shadow-xl">
            <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
              <div className="text-sm font-bold text-primary">알림</div>
              {unread > 0 && (
                <button className="text-xs text-secondary hover:underline" onClick={readAll}>모두 읽음</button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto scrollbar-hide">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-on-surface-variant">새 알림이 없습니다.</p>
              ) : (
                <ul className="divide-y divide-outline-variant">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button onClick={() => onItem(n)}
                        className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-surface-container-low ${n.read_at ? "" : "bg-secondary-fixed/40"}`}>
                        <div className="flex w-full items-center gap-2">
                          {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-error" />}
                          <span className="truncate text-sm font-semibold text-primary">{n.title}</span>
                        </div>
                        {n.body && <span className="text-xs text-on-surface-variant line-clamp-2">{n.body}</span>}
                        <span className="text-[11px] text-on-surface-variant opacity-60">{(n.created_at || "").slice(0, 16)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
