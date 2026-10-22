export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  ANTHROPIC_API_KEY?: string;  // 정산서 자동 읽기용 (Cloudflare 비밀값)
  ANTHROPIC_MODEL?: string;
}

export interface JwtPayload {
  uid: number;
  email: string;
  name: string;
  role: string;
  exp: number;
}

export type Variables = {
  user: JwtPayload;
};
