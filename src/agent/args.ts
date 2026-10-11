// spec maps a flag to how many values it takes (--live: 0, --max-usd: 1, --window: 2). Unknown flags are errors.
export interface Args { pos: string[]; flags: Map<string, string[]> }

export function parseArgs(argv: string[], spec: Record<string, number>): Args {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const n = spec[a];
    if (n === undefined) throw new Error(`unknown flag ${a}`);
    const vals = argv.slice(i + 1, i + 1 + n);
    if (vals.length < n || vals.some((v) => v.startsWith("--"))) throw new Error(`${a} needs ${n} value${n === 1 ? "" : "s"}`);
    flags.set(a, vals);
    i += n;
  }
  return { pos, flags };
}

export function numberFlag(a: Args, name: string, fallback: number): number {
  const v = a.flags.get(name)?.[0];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${v}"`);
  return n;
}
