"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Note, Skeleton } from "@/components/shared/page";
import { istAndSgt, istTime, usd } from "@/lib/shared/format";
import type { RuleView, VersionRow } from "@/lib/redeye";

const EXAMPLES = ["if TSLA drops 8% buy $6", "if NVDA jumps 10% sell half", "if KO falls 5% buy $25"];

type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; view: RuleView };

export function RuleDesk() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const out = useRef<HTMLDivElement>(null);

  async function read(value: string) {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setState({ kind: "done", view: body as RuleView });
      queueMicrotask(() => out.current?.focus());
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Reading the rule failed." });
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void read(text);
        }}
        className="max-w-[44rem]"
      >
        <label htmlFor="rule" className="label mb-1.5 block">Your rule, in plain English</label>
        <Textarea
          id="rule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={300}
          spellCheck={false}
          placeholder="if TSLA drops 8% after earnings, buy $6"
          className="min-h-20 rounded-sm bg-paper px-3 py-2.5 font-serif text-[1.25rem] leading-snug"
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" disabled={state.kind === "loading" || !text.trim()} className="h-11 rounded-sm px-5 text-[0.9375rem]">
            {state.kind === "loading" ? "Reading the market" : "Read my rule"}
          </Button>
          <span className="label">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setText(ex); void read(ex); }}
              className="min-h-11 border-b border-rule px-0.5 text-left text-[0.9375rem] text-ink-2 transition-colors duration-150 hover:border-signal hover:text-ink md:min-h-9"
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      <div ref={out} tabIndex={-1} aria-live="polite" className="mt-12 outline-none">
        {state.kind === "loading" && <Skeleton rows={4} />}
        {state.kind === "error" && <Note tone="stop">{state.message}</Note>}
        {state.kind === "done" && <Result view={state.view} />}
      </div>
    </div>
  );
}

function Result({ view }: { view: RuleView }) {
  const r = view.rule;
  const action = r.action.usd !== undefined ? `${r.action.side} ${usd(r.action.usd, 0)}` : `${r.action.side} ${r.action.fractionOfHolding === 1 ? "all" : `${(r.action.fractionOfHolding ?? 0) * 100}%`} of your holding`;
  return (
    <div className="space-y-14">
      <section aria-labelledby="read" className="border-t border-ink pt-6">
        <h2 id="read" className="label">How it read you</h2>
        <p className="mt-3 max-w-[40ch] font-serif text-[1.75rem] font-light leading-tight md:text-[2.25rem]">{view.sentence}</p>
        <dl className="mt-6 grid max-w-[44rem] grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-[0.9375rem]">
          <dt className="label self-center">Stock</dt><dd className="fig">{r.ticker}</dd>
          <dt className="label self-center">Trigger</dt><dd>{r.trigger.direction === "down" ? "falls" : "rises"} {r.trigger.pct}% from the last close</dd>
          <dt className="label self-center">Action</dt><dd className="fig">{action}</dd>
          <dt className="label self-center">Slippage cap</dt><dd className="fig">{(r.maxSlippageBps / 100).toFixed(1)}%</dd>
          <dt className="label self-center">Armed</dt><dd>{view.windowNote}</dd>
          <dt className="label self-center">Read by</dt><dd>{view.parsedBy === "claude" ? "Claude, then checked against the rule schema" : "Exact pattern match, no model involved"}</dd>
        </dl>
      </section>

      <section aria-labelledby="stands" className="border-t border-ink pt-6">
        <h2 id="stands" className="label">If the rule were evaluated right now</h2>
        <p className="mt-3 max-w-[56ch] font-serif text-[1.25rem] leading-snug">{view.standing}</p>
        {view.lastClose && (
          <p className="fig mt-3 text-[0.875rem] text-ink-2">
            Last daily close {usd(view.lastClose.price)} ({view.lastClose.symbol}, {view.lastClose.day} UTC).
            {view.trigger.price !== null && ` The rule fires ${r.trigger.direction === "down" ? "at or below" : "at or above"} ${usd(view.trigger.price)}.`}
          </p>
        )}
      </section>

      <section aria-labelledby="versions" className="border-t border-ink pt-6">
        <h2 id="versions" className="label">Every tokenized {r.ticker} on BNB Chain</h2>
        <p className="mt-2 max-w-[62ch] text-ink-2">
          Quotes were requested at {istTime(view.at)} IST for {usd(view.versions[0]?.probe.amountUsd ?? 0, 0)}, your rule's size.
        </p>
        <ol className="mt-6 divide-y divide-rule border-y border-rule">
          {view.versions.map((v, i) => <VersionLine key={v.address} v={v} i={i} />)}
        </ol>
      </section>
    </div>
  );
}

function sessionText(v: VersionRow): string {
  const s = v.session;
  if (s.reasonCode && s.reasonCode !== "TRADING") return `${s.state ?? "closed"}: ${s.reasonMsg ?? s.reasonCode}`;
  return s.state ? `${s.state}, open` : "trading";
}

function VersionLine({ v, i }: { v: VersionRow; i: number }) {
  return (
    <li className="rise grid gap-x-8 gap-y-2 py-5 md:grid-cols-[11rem_9rem_minmax(0,1fr)]" style={{ ["--i" as string]: i }}>
      <div>
        <p className="fig font-semibold">{v.symbol}</p>
        <p className="text-[0.8125rem] text-ink-3">{v.issuerLabel}, {v.route === "RFQ" ? "quoted by market makers" : v.route === "SWAP" ? "swap on-chain" : "swap or quote"}</p>
      </div>
      <div>
        <p className="fig text-[1.125rem]">{v.perShareUsd === null ? "no price" : usd(v.perShareUsd)}</p>
        <p className="text-[0.8125rem] text-ink-3">per share{v.derived ? ", computed from the stock quote" : ", last trade"}</p>
      </div>
      <div>
        <Note tone={v.tradable ? "ok" : "warn"}>
          <span className="font-medium">{v.tradable ? "Tradable now." : "Not tradable now."}</span> {v.because}
        </Note>
        <p className="mt-1.5 pl-[30px] text-[0.8125rem] text-ink-3">
          Binance session: {sessionText(v)}.
          {v.session.nextOpenTime && !v.tradable ? ` Next open ${istAndSgt(v.session.nextOpenTime)}.` : ""}
        </p>
      </div>
    </li>
  );
}
