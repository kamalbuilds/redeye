import { cn } from "@/lib/utils";

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={cn("mx-auto w-full max-w-[1180px] px-5 pt-10 md:px-8 md:pt-14", className)}>{children}</main>;
}

/** A state line with a glyph, so meaning never rides on colour alone. */
export function Note({ tone, children }: { tone: "warn" | "stop" | "ok" | "plain"; children: React.ReactNode }) {
  const glyph = { warn: "!", stop: "x", ok: "+", plain: "i" }[tone];
  const color = { warn: "text-warn", stop: "text-stop", ok: "text-signal", plain: "text-ink-2" }[tone];
  return (
    <p role={tone === "stop" ? "alert" : undefined} className={cn("flex gap-2.5 text-[0.9375rem] leading-snug", color)}>
      <span aria-hidden className="fig mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-current text-[0.75rem] leading-none">
        {glyph}
      </span>
      <span>{children}</span>
    </p>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Reading live data" className="divide-y divide-rule border-y border-rule">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse bg-paper-2/60 motion-reduce:animate-none" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}
