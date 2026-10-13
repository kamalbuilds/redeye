"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_RULE, RuleConsole, type ArmState, type SlipState } from "./rule-console";
import { PriceLadder } from "./price-ladder";
import type { ArmedView, RuleView } from "@/lib/redeye";

/** The headline runs full width; under it the rule console and the live price ladder it drives, side by side. */
export function Desk({ headline }: { headline: ReactNode }) {
  const [state, setState] = useState<SlipState>({ kind: "idle" });
  const [arm, setArm] = useState<ArmState>({ kind: "idle" });
  const first = useRef(false);

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
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Reading the rule failed." });
    }
  }

  // the page opens on a live reading of the default rule, so the ladder shows the market before anyone types
  useEffect(() => {
    if (first.current) return;
    first.current = true;
    void read(DEFAULT_RULE);
  }, []);

  return (
    <div>
      {headline}
      <div className="mt-8 grid gap-x-12 gap-y-10 md:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="min-w-0"><RuleConsole state={state} onRead={read} arm={arm} onArm={armRule} /></div>
        <div className="min-w-0"><PriceLadder state={state} /></div>
      </div>
    </div>
  );
}
