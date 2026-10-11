import "server-only";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Decision, Rule, SessionStatus, VersionPrice } from "../../../src/types.ts";

// ../src is written for Node 24 native .ts execution and locates its own data files with
// import.meta.url. Bundling it breaks that (the bundler tries to resolve ../../data/*.json at
// build time and rewrites import.meta.url), so the server loads it with Node's own loader.
// Types still come from the real files through `typeof import`, so the calls stay type-checked.
const SRC = path.join(process.cwd(), "..", "src");
const load = (file: string) => import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(path.join(SRC, file)).href);

export const rwa = () => load("data/rwa.ts") as Promise<typeof import("../../../src/data/rwa.ts")>;

// src/signals does not pass strict tsc on its own (it runs under Node's type stripping), so its surface is
// declared here from the shared types instead of being pulled into the web type-check.
export interface ParseCtx { now: number; window: { startMs: number; endMs: number } }
export const parseMod = () => load("signals/parse.ts") as Promise<{
  parseRule(text: string, ctx: ParseCtx): Promise<Rule>;
  parseRuleStrict(text: string, ctx?: ParseCtx): Rule;
}>;
export const evaluateMod = () => load("signals/evaluate.ts") as Promise<{
  evaluate(rule: Rule, lastClose: number, observed: VersionPrice[], status: Map<string, SessionStatus>, now: number): Decision;
}>;

export const lastCloseMod = () => load("agent/lastclose.ts") as Promise<typeof import("../../../src/agent/lastclose.ts")>;

export const web3api = () => load("exec/web3api.ts") as Promise<typeof import("../../../src/exec/web3api.ts")>;
