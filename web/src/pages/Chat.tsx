import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Icon, Spinner } from "../components/ui";

interface Channel { id: number; name: string; message_count?: number; last_at?: string | null }
interface Msg {
  id: number; channel_id: number; user_id: number; body: string; created_at: string;
  user_name: string; user_role: string;
  attachment_id?: number | null; file_name?: string | null; content_type?: string | null; file_size?: number | null;
}

function fmtTime(s: string) {
  const d = new Date(s.replace(" ", "T") + "Z");
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(s: string) {
  const d = new Date(s.replace(" ", "T") + "Z");
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}
function fmtSize(n?: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function colorFor(name: string) {
  const palette = ["bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-fuchsia-500", "bg-teal-500"];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[h];
}

function FileChip({ m, mine }: { m: Msg; mine: boolean }) {
  const isImg = (m.content_type || "").startsWith("image/");
  return (
    <button onClick={() => api.download(m.attachment_id!, m.file_name!)}
      title="다운로드"
      className={`flex max-w-[260px] items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm ${mine ? "bg-secondary text-on-secondary rounded-br-sm" : "bg-surface-container-high text-on-surface rounded-bl-sm"}`}>
      <Icon name={isImg ? "image" : "description"} size={24} className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{m.file_name}</span>
        <span className="text-[10px] opacity-70">{fmtSize(m.file_size)} · 다운로드 <Icon name="download" size={11} /></span>
      </span>
    </button>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [results, setResults] = useState<Msg[] | null>(null);
  const lastId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setResults(null); setSearchOpen(false); setSearchQ("");
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

  useEffect(() => { if (!results) bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, results]);

  function mergeMine(item: Msg) {
    lastId.current = Math.max(lastId.current, item.id);
    setMessages((prev) => prev.some((m) => m.id === item.id) ? prev : [...prev, item]);
  }

  async function send() {
    const body = text.trim();
    if (!body || active == null) return;
    setText("");
    try {
      const r = await api.post<{ item: Msg }>(`/chat/channels/${active}/messages`, { body });
      mergeMine(r.item);
    } catch (e: any) { alert(e.message); setText(body); }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || active == null) return;
    setUploading(true);
    try {
      const r = await api.uploadChat(active, file);
      mergeMine(r.item);
    } catch (err: any) { alert(err.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runSearch(q: string) {
    setSearchQ(q);
    if (!q.trim() || active == null) { setResults(null); return; }
    const r = await api.get<{ items: Msg[] }>(`/chat/search?channel_id=${active}&q=${encodeURIComponent(q.trim())}`);
    setResults(r.items);
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
        <header className="flex items-center gap-2 border-b border-outline-variant px-4 py-3 sm:px-5">
          <Icon name="forum" className="text-secondary" />
          <h2 className="headline truncate font-bold text-primary">{activeChannel?.name || "채팅"}</h2>
          <div className="ml-auto flex items-center gap-1">
            {searchOpen ? (
              <div className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface-container-low px-2">
                <Icon name="search" size={18} className="text-on-surface-variant" />
                <input autoFocus className="h-8 w-36 border-none bg-transparent text-sm focus:ring-0 sm:w-52"
                  placeholder="대화 내용 검색..." value={searchQ}
                  onChange={(e) => runSearch(e.target.value)} />
                <button onClick={() => { setSearchOpen(false); setSearchQ(""); setResults(null); }}
                  className="text-on-surface-variant hover:text-primary"><Icon name="close" size={18} /></button>
              </div>
            ) : (
              <button onClick={() => setSearchOpen(true)} title="검색"
                className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"><Icon name="search" size={20} /></button>
            )}
            <select className="rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1 text-sm sm:hidden"
              value={active ?? ""} onChange={(e) => setActive(Number(e.target.value))}>
              {channels.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
            </select>
          </div>
        </header>

        {/* 검색 결과 모드 */}
        {results !== null ? (
          <div className="flex-1 overflow-y-auto scrollbar-hide bg-surface-container-lowest px-4 py-3">
            <div className="mb-2 text-xs text-on-surface-variant">검색 결과 {results.length}건</div>
            {results.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-on-surface-variant">
                <Icon name="search_off" className="opacity-30" size={40} /><p className="text-sm">일치하는 메시지가 없습니다</p>
              </div>
            ) : results.map((m) => (
              <div key={m.id} className="mb-2 rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
                <div className="mb-1 flex items-center gap-2 text-xs text-on-surface-variant">
                  <span className="font-bold text-primary">{m.user_name}</span>
                  <span>{fmtDay(m.created_at)} {fmtTime(m.created_at)}</span>
                </div>
                {m.body && <p className="whitespace-pre-wrap break-words text-sm text-on-surface">{m.body}</p>}
                {m.attachment_id && (
                  <button onClick={() => api.download(m.attachment_id!, m.file_name!)} className="mt-1 inline-flex items-center gap-1 text-sm text-secondary hover:underline">
                    <Icon name="attach_file" size={16} />{m.file_name}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* 실시간 대화 모드 */
          <div className="flex-1 space-y-1 overflow-y-auto scrollbar-hide bg-surface-container-lowest px-4 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-on-surface-variant">
                <Icon name="chat" className="opacity-30" size={44} /><p className="text-sm">첫 메시지를 남겨보세요</p>
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
                      <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
                        <div className="flex flex-col gap-1">
                          {m.body && <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${mine ? "self-end bg-secondary text-on-secondary rounded-br-sm" : "self-start bg-surface-container-high text-on-surface rounded-bl-sm"}`}>{m.body}</div>}
                          {m.attachment_id && <FileChip m={m} mine={mine} />}
                        </div>
                        <span className="mb-0.5 shrink-0 text-[10px] text-on-surface-variant opacity-60">{fmtTime(m.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {/* 입력창 (검색 모드일 땐 숨김) */}
        {results === null && (
          <div className="flex items-center gap-2 border-t border-outline-variant px-4 py-3">
            <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} title="파일 첨부"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-50">
              <Icon name={uploading ? "hourglass_top" : "attach_file"} size={22} />
            </button>
            <input
              className="input flex-1"
              placeholder={uploading ? "파일 업로드 중..." : "메시지를 입력하세요..."}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="btn-primary shrink-0" onClick={send} disabled={!text.trim()}>
              <Icon name="send" size={18} />
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
