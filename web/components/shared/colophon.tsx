export function Colophon({ statement, lines }: { statement: string; lines: { term: string; text: string }[] }) {
  return (
    <footer className="mt-28 border-t border-line">
      <div className="mx-auto max-w-[1180px] px-5 py-14 md:px-8">
        <p className="max-w-[26ch] font-serif text-[1.75rem] leading-[1.15] text-fg md:text-[2.25rem]">{statement}</p>
        <dl className="mt-10 grid gap-x-10 gap-y-5 text-[0.8125rem] leading-snug text-fg-2 md:grid-cols-3">
          {lines.map((l) => (
            <div key={l.term}>
              <dt className="label mb-1.5">{l.term}</dt>
              <dd>{l.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </footer>
  );
}
