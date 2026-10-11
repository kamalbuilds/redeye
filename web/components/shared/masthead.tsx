import Link from "next/link";
import { NavLink } from "./nav-link";

export interface NavItem { href: string; label: string; exact?: boolean }

export function Masthead({ name, home, nav }: { name: string; home: string; nav: NavItem[] }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 md:px-8">
        <Link href={home} className="inline-flex min-h-14 items-center font-serif text-[1.75rem] leading-none tracking-[-0.01em] text-fg">
          {name}
        </Link>
        <nav aria-label={`${name} sections`} className="flex gap-6">
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
