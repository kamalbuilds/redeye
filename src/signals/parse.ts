import type { Rule } from "../types.ts";

export interface ParseCtx { now: number; window: { startMs: number; endMs: number } }

const TICKER = /^[A-Z]{1,6}$/;

function build(o: { ticker: unknown; direction: unknown; pct: unknown; side: unknown; usd?: unknown; fraction?: unknown }, ctx: ParseCtx): Rule {
  const bad = (m: string): never => { throw new Error(`Invalid rule: ${m}`); };
  const { ticker, direction, pct, side, usd, fraction } = o;
  if (typeof ticker !== "string" || !TICKER.test(ticker)) bad("ticker must be 1-6 letters A-Z");
  if (direction !== "down" && direction !== "up") bad("direction must be down or up");
  if (typeof pct !== "number" || !(pct >= 0.5 && pct <= 50)) bad("pct must be between 0.5 and 50");
  if (side !== "buy" && side !== "sell") bad("side must be buy or sell");
  const hasUsd = usd !== undefined && usd !== null;
  const hasFrac = fraction !== undefined && fraction !== null;
  if (hasUsd === hasFrac) bad("give exactly one of usd or fractionOfHolding");
  if (hasUsd && !(typeof usd === "number" && usd >= 1 && usd <= 1000)) bad("usd must be between 1 and 1000");
  if (hasFrac && !(typeof fraction === "number" && fraction >= 0 && fraction <= 1)) bad("fractionOfHolding must be between 0 and 1");
  if (hasFrac && side === "buy") bad("a buy needs a dollar amount, not a fraction of holding");
  const action: Rule["action"] = hasUsd ? { side, usd: usd as number } : { side, fractionOfHolding: fraction as number };
  return {
    id: `${ticker}-${direction}-${pct}-${ctx.now}`,
    ticker: ticker as string,
    trigger: { kind: "move_pct", direction: direction as "down" | "up", pct: pct as number, from: "last_close" },
    action: action as Rule["action"],
    window: ctx.window,
    maxSlippageBps: 100,
  };
}

const TOOL = {
  name: "emit_rule",
  description: "Emit the trading rule the user described. Only call with values the user actually stated.",
  input_schema: {
    type: "object",
    properties: {
      ticker: { type: "string", description: "US stock ticker, A-Z, 1-6 chars" },
      direction: { type: "string", enum: ["down", "up"] },
      pct: { type: "number", description: "move size in percent, 0.5 to 50" },
      side: { type: "string", enum: ["buy", "sell"] },
      usd: { type: "number", description: "dollars to trade, 1 to 1000. Omit if the user gave a fraction." },
      fraction: { type: "number", description: "fraction of holding to sell, 0 to 1 (half = 0.5). Omit if the user gave dollars." },
    },
    required: ["ticker", "direction", "pct", "side"],
  },
};

export async function parseRule(text: string, ctx: ParseCtx): Promise<Rule> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set; use parseRuleStrict or set the key in .env");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 512,
      system: "Convert the user's plain-English overnight trading rule into the emit_rule tool call. Never guess a missing number or ticker: if the rule is ambiguous, still call the tool with only what was stated.",
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { content?: { type: string; input?: Record<string, unknown> }[] };
  const input = body.content?.find((c) => c.type === "tool_use")?.input;
  if (!input) throw new Error("Anthropic API returned no rule");
  return build({ ticker: input.ticker, direction: input.direction, pct: input.pct, side: input.side, usd: input.usd, fraction: input.fraction }, ctx);
}

const WORDS: Record<string, number> = { half: 0.5, all: 1, everything: 1, quarter: 0.25 };
const SHAPE = /^if\s+([A-Za-z]{1,6})\s+(drops?|falls?|dips?|jumps?|rises?|gains?|pops?)\s+(?:by\s+)?(?:more than\s+|over\s+|at least\s+)?(\d+(?:\.\d+)?)\s*%\s*,?\s*(?:then\s+)?(buy|sell)\s+(?:\$\s*(\d+(?:\.\d+)?)|(half|all|everything|quarter)(?:\s+(?:of\s+)?(?:my\s+)?(?:position|holding|it))?)\s*\.?$/i;

export function parseRuleStrict(text: string, ctx: ParseCtx = { now: Date.now(), window: { startMs: 0, endMs: 0 } }): Rule {
  const m = SHAPE.exec(text.trim());
  if (!m) throw new Error(`Cannot parse rule with certainty: "${text}". Try: "if TSLA drops more than 8% buy $50".`);
  const direction = /^(drop|fall|dip)/i.test(m[2]) ? "down" : "up";
  return build(
    {
      ticker: m[1].toUpperCase(),
      direction,
      pct: Number(m[3]),
      side: m[4].toLowerCase(),
      usd: m[5] !== undefined ? Number(m[5]) : undefined,
      fraction: m[6] !== undefined ? WORDS[m[6].toLowerCase()] : undefined,
    },
    ctx,
  );
}
