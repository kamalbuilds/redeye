export function Colophon({ lines }: { lines: { term: string; text: string }[] }) {
  return (
    <footer className="mt-24 border-t border-rule">
      <dl className="mx-auto grid max-w-[1180px] gap-x-10 gap-y-4 px-5 py-10 text-[0.8125rem] leading-snug text-ink-2 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] md:px-8">
        {lines.map((l) => (
          <div key={l.term}>
            <dt className="label mb-1">{l.term}</dt>
            <dd>{l.text}</dd>
          </div>
        ))}
      </dl>
    </footer>
  );
}
