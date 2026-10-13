import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const LINKS = [
  { href: "/", label: "Tonight", external: false },
  { href: "/proof", label: "Replay the TSLA night", external: false },
  { href: "https://github.com/kamalbuilds/redeye", label: "Source on GitHub", external: true },
];
const LINK = "fig inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-[0.75rem] uppercase tracking-[0.12em] text-fg-3 transition-colors duration-150 hover:text-fg";

export function Colophon({ statement, lines }: { statement: string; lines: { term: string; text: string }[] }) {
  return (
    <footer className="mt-28 border-t border-line">
      <div className="mx-auto max-w-[1180px] px-5 py-16 md:px-8">
        <p className="max-w-[26ch] font-serif text-[1.75rem] leading-[1.15] text-fg md:text-[2.25rem]">{statement}</p>
        <dl className="mt-10 grid gap-x-10 gap-y-5 text-[0.8125rem] leading-snug text-fg-2 md:grid-cols-3">
          {lines.map((l) => (
            <div key={l.term}>
              <dt className="label mb-1.5">{l.term}</dt>
              <dd>{l.text}</dd>
            </div>
          ))}
        </dl>
        <nav aria-label="Footer" className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-1 border-t border-line pt-5">
          <span className="font-serif text-[1.25rem] text-fg">Redeye</span>
          {LINKS.map((l) => l.external ? (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={LINK}>
              {l.label} <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : (
            <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>
          ))}
          <span className="fig text-[0.6875rem] text-fg-3 md:ml-auto">BNB Chain, chainId 56</span>
        </nav>
      </div>
    </footer>
  );
}
