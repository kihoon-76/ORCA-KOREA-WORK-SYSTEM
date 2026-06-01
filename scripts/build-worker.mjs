// worker/index.ts 를 Cloudflare Pages 고급 모드용 _worker.js 단일 파일로 번들한다.
// Pages 는 빌드 산출물 디렉터리(web/dist)에 _worker.js 가 있으면 모든 요청을 이 워커로 라우팅하고,
// 정적 자산은 env.ASSETS 로 서빙한다. (Hono 앱이 이미 그 패턴으로 구현되어 있음)
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await build({
  entryPoints: [resolve(root, "worker/index.ts")],
  outfile: resolve(root, "web/dist/_worker.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  conditions: ["worker", "browser"],
  loader: { ".ts": "ts" },
  logLevel: "info",
});

console.log("✓ web/dist/_worker.js 생성 완료");
