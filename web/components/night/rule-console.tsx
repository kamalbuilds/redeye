"use client";

import { useState } from "react";
import { ArrowRight, Check, CornerDownLeft } from "lucide-react";
import { istAndSgt, usd, watchWindow } from "@/lib/shared/format";
import { cn } from "@/lib/utils";
import type { ArmedView, RuleView } from "@/lib/redeye";

export const DEFAULT_RULE = "if TSLA drops 8% buy $6";
export const EXAMPLES = [
  { text: DEFAULT_RULE, short: "TSLA -8% buy $6" },
  { text: "if NVDA jumps 10% sell half", short: "NVDA +10% sell half" },
  { text: "if AAPL falls 3% buy $10", short: "AAPL -3% buy $10" },
];

export type SlipState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; view: RuleView };

/** Whether the rule on the console has been handed to the agent. `forAt` ties the answer to the reading it came from. */
export type ArmState =
  | { kind: "idle" }
  | { kind: "arming"; forAt: number }
  | { kind: "armed"; forAt: number; armed: ArmedView }
  | { kind: "error"; forAt: number; message: string };

const closeDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

function Tok({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={cn("whitespace-nowrap border-b", accent ? "border-sodium text-sodium" : "border-fg-3 text-fg")}>{children}</span>;
}

/** The rule read back as one sentence, with every number the agent will use filled in from the live market. */
function Reading({ view }: { view: RuleView }) {
  const r = view.rule;
  const act = r.action.usd !== undefined
    ? <>{r.action.side} <Tok accent>{usd(r.action.usd, 0)}</Tok></>
    : <>{r.action.side} <Tok accent>{r.action.fractionOfHolding === 1 ? "all" : `${(r.action.fractionOfHolding ?? 0) * 100}%`}</Tok> of your holding</>;
  return (
    <p className="feed num text-[1.375rem] leading-[1.55] text-fg-2">
      Watch <Tok>{r.ticker}</Tok>
      {view.lastClose && <> from <Tok>{usd(view.lastClose.price)}</Tok>, {closeDay(view.lastClose.day)}&apos;s close</>}.
      {" "}If it {r.trigger.direction === "down" ? "falls" : "rises"} <Tok accent>{r.trigger.pct}%</Tok>
      {view.trigger.price !== null && <> to <Tok accent>{usd(view.trigger.price)}</Tok></>}, {act}
      {view.pick ? <> of <Tok>{view.pick.symbol}</Tok>.</> : "."}
    </p>
  );
}

export function RuleConsole({ state, onRead, arm, onArm }: {
  state: SlipState;
  onRead: (text: string) => void;
  arm: ArmState;
  onArm: (text: string, forAt: number) => void;
}) {
  const [text, setText] = useState(DEFAULT_RULE);
  const done = state.kind === "done" ? state.view : null;
  const mine = done !== null && arm.kind !== "idle" && arm.forAt === done.at ? arm : null;
  const armed = mine?.kind === "armed" ? mine.armed : null;
  const arming = mine?.kind === "arming";
  const stale = done !== null && text.trim() !== done.text;
  const loading = state.kind === "loading";

  return (
    <section aria-labelledby="console-h" className="overflow-hidden rounded-lg border border-line-2 bg-night-2">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 id="console-h" className="label text-fg-2">Your rule</h2>
        <p className="label truncate">{done ? (done.parsedBy === "claude" ? "Read by Claude, schema-checked" : "Read by exact pattern") : "Plain English"}</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); onRead(text); }} aria-busy={loading} className="p-4">
        <label htmlFor="rule" className="sr-only">Your rule, in plain English</label>
        <div className="flex items-center gap-2 border-b-2 border-fg-3 pb-2 transition-colors duration-150 focus-within:border-sodium">
          <input
            id="rule"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            spellCheck={false}
            autoComplete="off"
            placeholder={DEFAULT_RULE}
            className="min-w-0 flex-1 bg-transparent font-mono text-[1.0625rem] text-fg caret-sodium outline-none placeholder:text-fg-3 focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !text.trim()}
            aria-label="Read my rule"
            title="Read my rule"
            className={cn(
              "inline-flex size-11 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150 active:scale-[0.97] disabled:opacity-40 md:size-9",
              stale || !done ? "border-sodium bg-sodium text-sodium-ink hover:bg-sodium/85" : "border-line-2 text-fg-2 hover:border-fg-2 hover:text-fg",
            )}
          >
            <CornerDownLeft aria-hidden className="size-4" />
          </button>
        </div>

        <ul aria-label="Example rules" className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map(({ text: ex, short }) => (
            <li key={ex}>
              <button
                type="button"
                disabled={loading}
                onClick={() => { setText(ex); onRead(ex); }}
                aria-pressed={done?.text === ex}
                className="min-h-9 rounded-sm border border-line-2 px-2.5 font-mono text-[0.75rem] text-fg-3 transition-colors duration-150 hover:border-fg-3 hover:text-fg aria-pressed:border-sodium/60 aria-pressed:text-fg disabled:opacity-50"
              >
                <span className="sr-only">{ex}</span><span aria-hidden>{short}</span>
              </button>
            </li>
          ))}
        </ul>
      </form>

      <div className="min-h-[12rem] border-t border-line p-4" aria-live="polite">
        {(loading || state.kind === "idle") && (
          <div role="status" className="space-y-3">
            <p className="label animate-pulse text-sodium motion-reduce:animate-none">Pricing every tokenized version</p>
            <div className="h-6 w-11/12 animate-pulse rounded-sm bg-night-3 motion-reduce:animate-none" />
            <div className="h-6 w-3/4 animate-pulse rounded-sm bg-night-3 motion-reduce:animate-none" />
            <div className="h-6 w-1/2 animate-pulse rounded-sm bg-night-3 motion-reduce:animate-none" />
          </div>
        )}
        {state.kind === "error" && (
          <p role="alert" className="flex gap-2 text-[0.9375rem] leading-snug text-fail">
            <span aria-hidden className="fig">x</span>
            <span>{state.message}</span>
          </p>
        )}
        {done && (
          <>
            <Reading key={done.at} view={done} />
            <p className="feed mt-3 text-[0.875rem] leading-snug text-fg-2" style={{ ["--i" as string]: 1 }}>{done.standing}</p>
            <dl className="feed mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3" style={{ ["--i" as string]: 2 }}>
              <div>
                <dt className="label">Slippage cap</dt>
                <dd className="fig mt-0.5 text-[0.875rem] text-fg">{(done.rule.maxSlippageBps / 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="label">Would act on</dt>
                <dd className="fig mt-0.5 text-[0.875rem] text-fg">{done.pick ? done.pick.symbol : "no version can trade"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="label">Watch</dt>
                <dd className="mt-0.5 text-[0.8125rem] leading-snug text-fg-2">{done.windowNote}</dd>
              </div>
            </dl>
          </>
        )}
      </div>

      {done && (
        <div className="border-t border-line p-4" aria-live="polite">
          {armed ? (
            <div className="feed flex gap-3">
              <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-sodium text-sodium-ink"><Check className="size-3.5" /></span>
              <div className="min-w-0">
                <p className="text-[0.9375rem] font-medium leading-snug text-fg">
                  {armed.alreadyArmed ? "Already armed. " : "Armed. "}Watching {watchWindow(armed.window.startMs, armed.window.endMs, armed.at)}
                </p>
                <p className="fig mt-1 break-all text-[0.6875rem] text-fg-3">{armed.ruleId}, left {istAndSgt(armed.at)}</p>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                disabled={stale || arming}
                onClick={() => onArm(done.text, done.at)}
                className="group inline-flex h-12 w-full items-center justify-between rounded-sm bg-sodium px-4 font-mono text-[0.8125rem] font-bold uppercase tracking-[0.12em] text-sodium-ink transition-colors duration-150 hover:bg-sodium/85 active:scale-[0.99] disabled:bg-night-3 disabled:text-fg-3"
              >
                {arming ? "Arming" : "Arm it for tonight"}
                <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 group-disabled:translate-x-0" />
              </button>
              {stale && <p className="mt-2 text-[0.8125rem] leading-snug text-fg-2">The rule changed. Press enter to read it again.</p>}
              {mine?.kind === "error" && (
                <p role="alert" className="mt-2 flex gap-2 text-[0.8125rem] leading-snug text-fail">
                  <span aria-hidden className="fig">x</span>
                  <span>{mine.message}</span>
                </p>
              )}
            </>
          )}
          <p className="mt-3 text-[0.75rem] leading-snug text-fg-3">
            This page quotes and simulates from a probe wallet. Fills are signed by the Redeye agent with your Binance Agentic Wallet.
          </p>
        </div>
      )}
    </section>
  );
}
