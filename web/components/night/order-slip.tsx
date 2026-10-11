"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { istAndSgt, usd, watchWindow } from "@/lib/shared/format";
import { cn } from "@/lib/utils";
import type { ArmedView, RuleView } from "@/lib/redeye";

export const EXAMPLES = ["if TSLA drops 8% buy $6", "if NVDA jumps 10% sell half", "if KO falls 5% buy $25"];

export type SlipState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; view: RuleView };

/** Whether the rule on the slip has been handed to the agent. `forAt` ties the answer to the reading it came from. */
export type ArmState =
  | { kind: "idle" }
  | { kind: "arming"; forAt: number }
  | { kind: "armed"; forAt: number; armed: ArmedView }
  | { kind: "error"; forAt: number; message: string };

function fields(view: RuleView): { k: string; v: string }[] {
  const r = view.rule;
  const act = r.action.usd !== undefined
    ? `${r.action.side} ${usd(r.action.usd, 0)}`
    : `${r.action.side} ${r.action.fractionOfHolding === 1 ? "all" : `${(r.action.fractionOfHolding ?? 0) * 100}%`} of your holding`;
  return [
    { k: "STOCK", v: r.ticker },
    { k: "IF", v: `${r.ticker} ${r.trigger.direction === "down" ? "falls" : "rises"} ${r.trigger.pct}% from the last close` },
    { k: "THEN", v: act },
    { k: "SLIPPAGE", v: `${(r.maxSlippageBps / 100).toFixed(1)}% cap` },
    { k: "WATCH", v: view.windowNote },
    { k: "READ BY", v: view.parsedBy === "claude" ? "Claude, then checked against the rule schema" : "exact pattern match, no model" },
  ];
}

const BLANK = ["STOCK", "IF", "THEN", "SLIPPAGE", "WATCH", "READ BY"];

export function OrderSlip({ state, onRead, arm, onArm }: {
  state: SlipState;
  onRead: (text: string) => void;
  arm: ArmState;
  onArm: (text: string, forAt: number) => void;
}) {
  const [text, setText] = useState("");
  const done = state.kind === "done" ? state.view : null;
  const mine = done !== null && arm.kind !== "idle" && arm.forAt === done.at ? arm : null;
  const armed = mine?.kind === "armed" ? mine.armed : null;
  const arming = mine?.kind === "arming";
  const stale = done !== null && text.trim() !== done.text;
  const torn = armed !== null;

  const rows = done ? fields(done) : BLANK.map((k) => ({ k, v: "" }));

  return (
    <div className="slip-wrap w-full max-w-[22.5rem]">
      <form
        onSubmit={(e) => { e.preventDefault(); onRead(text); }}
        className={cn("slip slip-top relative px-5 pb-5 pt-8", torn && "slip-bottom")}
        aria-busy={state.kind === "loading"}
      >
        <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
          <p className="text-[0.9375rem] font-bold uppercase tracking-[0.2em]">Redeye</p>
          <p className="text-[0.6875rem] uppercase tracking-[0.18em] text-ink-2">Order slip</p>
        </div>

        <label htmlFor="rule" className="mt-4 block text-[0.6875rem] uppercase tracking-[0.18em] text-ink-2">Your rule, in plain English</label>
        <Textarea
          id="rule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={300}
          spellCheck={false}
          placeholder="if TSLA drops 8% buy $6"
          className="mt-1 min-h-[4.5rem] resize-none rounded-none border-0 border-b border-paper-rule bg-transparent px-0 py-0 font-mono text-[0.9375rem] leading-6 text-ink [background-image:repeating-linear-gradient(transparent_0_23px,var(--paper-rule)_23px_24px)] placeholder:text-ink-2/70 focus-visible:ring-0 dark:bg-transparent md:text-[0.9375rem]"
        />

        <div className="mt-4 flex items-center gap-3">
          <Button
            type="submit"
            disabled={state.kind === "loading" || !text.trim()}
            className={cn(
              "h-11 rounded-none border-2 border-ink px-4 font-mono text-[0.75rem] font-bold uppercase tracking-[0.16em] disabled:border-ink/40 disabled:bg-transparent disabled:text-ink/45 disabled:opacity-100",
              done && !stale ? "bg-transparent text-ink hover:bg-ink/10" : "bg-ink text-paper hover:bg-ink-2",
            )}
          >
            {state.kind === "loading" ? "Reading" : "Read my rule"}
          </Button>
          {state.kind === "loading" && <p className="animate-pulse text-[0.75rem] uppercase tracking-[0.14em] text-ink-2 motion-reduce:animate-none">pricing every version</p>}
        </div>

        <ul aria-label="Example rules" className="mt-3 space-y-0.5">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                disabled={state.kind === "loading"}
                onClick={() => { setText(ex); onRead(ex); }}
                className="min-h-11 w-full text-left text-[0.8125rem] text-ink-2 underline decoration-ink/30 underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink disabled:opacity-50 md:min-h-8"
              >
                &gt; {ex}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-dashed border-ink/50 pt-3" aria-live="polite">
          {state.kind === "error" && (
            <p role="alert" className="flex gap-2 text-[0.8125rem] font-bold leading-snug">
              <span aria-hidden>x</span>
              <span>{state.message}</span>
            </p>
          )}
          {state.kind !== "error" && (
            <dl className="space-y-2.5 text-[0.8125rem] leading-snug">
              {rows.map((f, i) => (
                <div key={f.k} className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-x-2">
                  <dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-2">{f.k}</dt>
                  {f.v ? (
                    <dd key={done?.at} className="feed break-words font-bold" style={{ ["--i" as string]: i }}>{f.v}</dd>
                  ) : (
                    <dd aria-hidden className="mt-2 border-b border-dotted border-ink/40" />
                  )}
                </div>
              ))}
            </dl>
          )}
          {done && <p className="feed mt-3 text-[0.8125rem] leading-snug text-ink-2" style={{ ["--i" as string]: rows.length }}>{done.sentence}</p>}
        </div>

        {done && !torn && (
          <div className="mt-4">
            <Button
              type="button"
              disabled={stale || arming}
              onClick={() => onArm(done.text, done.at)}
              className="h-11 w-full rounded-none border-2 border-ink bg-ink px-4 font-mono text-[0.75rem] font-bold uppercase tracking-[0.16em] text-paper hover:bg-ink-2 disabled:border-ink/40 disabled:bg-transparent disabled:text-ink/45 disabled:opacity-100"
            >
              {arming ? "Arming" : "Leave it for tonight"}
            </Button>
            {stale && <p className="mt-2 text-[0.75rem] leading-snug text-ink-2">The rule changed. Read it again before leaving it.</p>}
            {mine?.kind === "error" && (
              <p role="alert" className="mt-2 flex gap-2 text-[0.8125rem] font-bold leading-snug">
                <span aria-hidden>x</span>
                <span>{mine.message}</span>
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-[0.6875rem] leading-snug text-ink-2">
          Live fills run from the Redeye agent with your Agentic Wallet. Checks on this page quote and simulate, and never sign.
        </p>
      </form>

      {!torn && <div aria-hidden className="perforation -my-[5px] h-[10px] bg-paper" />}

      <div data-torn={torn} className={cn("stub slip px-5 pb-4 pt-5", torn && "slip-top")} aria-live="polite">
        {armed ? (
          <>
            <p className="text-[0.875rem] font-bold leading-snug">Armed. Watching {watchWindow(armed.window.startMs, armed.window.endMs, armed.at)}</p>
            <p className="mt-2 break-all text-[0.75rem] leading-snug text-ink-2">Rule id {armed.ruleId}</p>
            <p className="mt-1 text-[0.75rem] leading-snug text-ink-2">{armed.alreadyArmed ? "This rule was already armed. " : ""}Left {istAndSgt(armed.at)}</p>
          </>
        ) : (
          <>
            <p className="text-[0.6875rem] uppercase tracking-[0.18em] text-ink-2">Rule id</p>
            {done ? (
              <>
                <p className="mt-1 break-all text-[0.875rem] font-bold leading-snug">{done.rule.id}</p>
                <p className="mt-2 text-[0.75rem] leading-snug text-ink-2">Read {istAndSgt(done.at)}. Not armed yet.</p>
              </>
            ) : (
              <p className="mt-1 text-[0.875rem] leading-snug text-ink-2">The rule id prints here once the rule is read.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
