"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children, exact = false }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex min-h-14 items-center whitespace-nowrap border-b-2 px-0.5 font-mono text-[0.75rem] uppercase tracking-[0.12em] transition-colors duration-150",
        on ? "border-sodium text-fg" : "border-transparent text-fg-3 hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
