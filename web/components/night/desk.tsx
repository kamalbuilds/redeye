"use client";

import { useRef, useState, type ReactNode } from "react";
import { OrderSlip, type ArmState, type SlipState } from "./order-slip";
import { PriceLadder } from "./price-ladder";
import type { ArmedView, RuleView } from "@/lib/redeye";

/** The headline sits above the ladder on a wide screen and above the slip on a phone, so the slip starts under the first thing you read. */
export function Desk({ headline }: { headline: ReactNode }) {
  const [state, setState] = useState<SlipState>({ kind: "idle" });
  const [arm, setArm] = useState<ArmState>({ kind: "idle" });
  const ladder = useRef<HTMLDivElement>(null);

  async function armRule(text: string, forAt: number) {
    setArm({ kind: "arming", forAt });
    try {
      const res = await fetch("/api/arm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setArm({ kind: "armed", forAt, armed: body as ArmedView });
    } catch (e) {
      setArm({ kind: "error", forAt, message: e instanceof Error ? e.message : "Saving the rule failed." });
    }
  }

  async function read(text: string) {
    setArm({ kind: "idle" });
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/rule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setState({ kind: "done", view: body as RuleView });
      queueMicrotask(() => ladder.current?.focus({ preventScroll: true }));
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Reading the rule failed." });
    }
  }

  return (
    <div className="grid gap-x-16 gap-y-8 md:grid-cols-[22.5rem_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:gap-y-10">
      <div className="min-w-0 md:col-start-2 md:row-start-1">{headline}</div>
      <div className="md:col-start-1 md:row-span-2 md:row-start-1">
        <p className="max-w-[18ch] font-serif text-[2rem] leading-[1.08] md:text-[2.5rem]">Leave a rule before bed.</p>
        <p className="mt-3 max-w-[34ch] text-[0.9375rem] leading-snug text-fg-2">
          Redeye watches every tokenized version of the stock on BNB Chain through the US session and acts on the best one that can trade.
        </p>
        <div className="mt-5 md:mt-8">
          <OrderSlip state={state} onRead={read} arm={arm} onArm={armRule} />
        </div>
      </div>
      <div ref={ladder} tabIndex={-1} className="min-w-0 outline-none md:col-start-2 md:row-start-2">
        <PriceLadder state={state} />
      </div>
    </div>
  );
}
