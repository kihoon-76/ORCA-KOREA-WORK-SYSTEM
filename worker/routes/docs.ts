import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware";
import { FLOW_HTML } from "./flowHtml";

// 회사 안내 문서 — 로그인한 사람에게만 내려준다
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use("*", authMiddleware);
app.get("/flow", (c) => c.json({ html: FLOW_HTML }));
export default app;
