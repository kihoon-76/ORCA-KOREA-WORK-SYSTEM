export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  JWT_SECRET: string;
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
