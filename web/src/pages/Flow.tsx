import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Spinner } from "../components/ui";

// 업무 흐름 — 입찰부터 정산까지 담당자별 정리 (서버에서 받아 와 그대로 보여준다)
export default function Flow() {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(1200);
  useEffect(() => { api.get("/docs/flow").then((r: any) => setHtml(r.html)).catch((e) => setErr(e.message)); }, []);
  function fit() {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setH(doc.documentElement.scrollHeight + 8);
  }
  useEffect(() => {
    const t = setInterval(fit, 800);
    window.addEventListener("resize", fit);
    return () => { clearInterval(t); window.removeEventListener("resize", fit); };
  }, []);
  if (err) return <p className="text-error">{err}</p>;
  if (!html) return <Spinner />;
  return <iframe ref={ref} title="업무 흐름" srcDoc={html} onLoad={fit} className="w-full rounded-lg border-0" style={{ height: h }} />;
}
