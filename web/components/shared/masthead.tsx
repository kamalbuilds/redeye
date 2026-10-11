import Link from "next/link";
import { NavLink } from "./nav-link";

export interface NavItem { href: string; label: string; exact?: boolean }

export function Masthead({ name, home, descriptor, nav }: { name: string; home: string; descriptor: string; nav: NavItem[] }) {
  return (
    <header className="rule-double">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-x-8 px-5 md:flex-row md:items-end md:justify-between md:px-8">
        <div className="flex flex-col pt-5 pb-1 md:pb-3">
          <Link href={home} className="font-serif text-[1.75rem] font-normal leading-none tracking-[-0.01em] text-ink">
            {name}
          </Link>
          <span className="label mt-2 normal-case tracking-[0.02em]">{descriptor}</span>
        </div>
        <nav aria-label={`${name} sections`} className="-mx-5 flex gap-6 overflow-x-auto px-5 md:mx-0 md:px-0">
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.exact}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
