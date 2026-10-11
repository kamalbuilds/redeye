import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

// The Binance keys live in the repo-root .env, one level above web/. They are read into the
// Node server process only. Nothing here is exposed to the browser: no NEXT_PUBLIC_ prefix,
// no value is ever returned from a route handler.
let loaded = false;
export function loadRepoEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(process.cwd(), "..", ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

// Same default and same override as src/agent/store.ts, so the page reads the files the CLI writes.
export const REPO_DATA_DIR = process.env.REDEYE_DATA_DIR ?? path.join(process.cwd(), "..", "data");
