import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon, Spinner } from "../components/ui";

interface Channel { id: number; name: string; message_count?: number; last_at?: string | null }
interface Msg { id: number; channel_id: number; user_id: number; body: string; created_at: string; user_name: string; user_role: string }

function fmtTime(s: string) {
  const d = new Date(s.replace(" ", "T") + "Z");
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(s: string) {
  const d = new Date(s.replace(" ", "T") + "Z");
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
function colorFor(name: string) {
  const palette = ["bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-fuchsia-500", "bg-teal-500"];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[h];
}

export default function Chat() {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const lastId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  function loadChannels() {
    api.get<{ items: Channel[] }>("/chat/channels").then((r) => {
      setChannels(r.items);
      setActive((cur) => cur ?? (r.items[0]?.id ?? null));
    }).finally(() => setLoading(false));
  }
  useEffect(loadChannels, []);

  // 채널 선택 시: 메시지 초기화 후 2초 간격 폴링
  useEffect(() => {
    if (active == null) return;
    lastId.current = 0;
    setMessages([]);
    let alive = true;
    async function poll() {
      try {
        const q = lastId.current ? `?after=${lastId.current}` : "";
        const r = await api.get<{ items: Msg[] }>(`/chat/channels/${active}/messages${q}`);
        if (!alive || !r.items.length) return;
        lastId.current = Math.max(lastId.current, r.items[r.items.length - 1].id);
        setMessages((prev) => {
          const have = new Set(prev.map((m) => m.id));
          const fresh = r.items.filter((m) => !have.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      } catch { /* 폴링 실패는 조용히 무시 */ }
    }
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [active]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || active == null) return;
    setText("");
    try {
      const r = await api.post<{ item: Msg }>(`/chat/channels/${active}/messages`, { body });
      lastId.current = Math.max(lastId.current, r.item.id);
      setMessages((prev) => prev.some((m) => m.id === r.item.id) ? prev : [...prev, r.item]);
    } catch (e: any) { alert(e.message); setText(body); }
  }

  async function addChannel() {
    const name = prompt("새 채팅방 이름을 입력하세요")?.trim();
    if (!name) return;
    const r = await api.post<{ item: Channel }>("/chat/channels", { name });
    setChannels((prev) => [...prev, r.item]);
    setActive(r.item.id);
  }

  const activeChannel = channels.find((ch) => ch.id === active);

  if (loading) return <Spinner />;

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 9rem)" }}>
      {/* 채널 목록 */}
      <aside className="card hidden w-60 shrink-0 flex-col overflow-hidden sm:flex">
        <div className="flex items-center justify-between border-b border-outline-variant px-4 py-3">
          <span className="mono-label font-bold text-primary">채팅방</span>
          <button onClick={addChannel} title="채팅방 추가" className="flex h-7 w-7 items-center justify-center rounded-full text-secondary hover:bg-surface-container-highest">
            <Icon name="add" size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide p-2">
          {channels.map((ch) => (
            <button key={ch.id} onClick={() => setActive(ch.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${ch.id === active ? "bg-secondary-container font-bold text-on-secondary-container" : "text-on-surface-variant hover:bg-surface-container-highest"}`}>
              <Icon name="tag" size={18} />
              <span className="flex-1 truncate text-sm">{ch.name}</span>
              {!!ch.message_count && <span className="text-xs opacity-60">{ch.message_count}</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* 대화 영역 */}
      <section className="card flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-outline-variant px-5 py-3">
          <Icon name="forum" className="text-secondary" />
          <h2 className="headline font-bold text-primary">{activeChannel?.name || "채팅"}</h2>
          {/* 모바일용 채널 선택 */}
          <select className="ml-auto rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1 text-sm sm:hidden"
            value={active ?? ""} onChange={(e) => setActive(Number(e.target.value))}>
            {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
          </select>
        </header>

        <div className="flex-1 space-y-1 overflow-y-auto scrollbar-hide bg-surface-container-lowest px-4 py-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-on-surface-variant">
              <Icon name="chat" className="opacity-30" size={44} />
              <p className="text-sm">첫 메시지를 남겨보세요</p>
            </div>
          )}
          {messages.map((m, i) => {
            const mine = m.user_id === user!.id;
            const prev = messages[i - 1];
            const sameAuthor = prev && prev.user_id === m.user_id && m.created_at.slice(0, 16) === prev.created_at.slice(0, 16);
            const newDay = !prev || prev.created_at.slice(0, 10) !== m.created_at.slice(0, 10);
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-full bg-surface-container-high px-3 py-1 text-xs text-on-surface-variant">{fmtDay(m.created_at)}</span>
                  </div>
                )}
                <div className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""} ${sameAuthor ? "mt-0.5" : "mt-3"}`}>
                  {!mine && (sameAuthor
                    ? <div className="w-8 shrink-0" />
                    : <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${colorFor(m.user_name || "?")}`}>{(m.user_name || "?").charAt(0)}</div>)}
                  <div className={`flex max-w-[72%] flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine && !sameAuthor && <span className="mb-0.5 ml-1 text-xs font-medium text-on-surface-variant">{m.user_name}</span>}
                    <div className="flex items-end gap-1.5">
                      {mine && <span className="mb-0.5 text-[10px] text-on-surface-variant opacity-60">{fmtTime(m.created_at)}</span>}
                      <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${mine ? "bg-secondary text-on-secondary rounded-br-sm" : "bg-surface-container-high text-on-surface rounded-bl-sm"}`}>{m.body}</div>
                      {!mine && <span className="mb-0.5 text-[10px] text-on-surface-variant opacity-60">{fmtTime(m.created_at)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2 border-t border-outline-variant px-4 py-3">
          <input
            className="input flex-1"
            placeholder="메시지를 입력하세요..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn-primary shrink-0" onClick={send} disabled={!text.trim()}>
            <Icon name="send" size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
