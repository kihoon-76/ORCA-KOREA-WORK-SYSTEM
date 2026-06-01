import type { Context, Next } from "hono";
import type { Env, Variables } from "./types";
import { verifyJwt } from "./auth";

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export async function authMiddleware(c: AppContext, next: Next) {
  const header = c.req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "인증이 필요합니다" }, 401);
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: "토큰이 유효하지 않습니다" }, 401);
  c.set("user", payload);
  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: AppContext, next: Next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) {
      return c.json({ error: "권한이 없습니다" }, 403);
    }
    await next();
  };
}
