"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { currentHref, navFor, type OfficeRole } from "@/lib/office-nav";

// The grouped office sidebar. Native details and summary give the keyboard behaviour (Tab reaches each
// heading, Enter or Space folds it). Every group starts open and the choice lasts only while the shell
// stays mounted, so a link is always there for a fresh page. Moving to a page opens its group.
export function OfficeNav({ role }: { role: OfficeRole }) {
  const pathname = usePathname();
  const groups = navFor(role);
  const current = currentHref(pathname, groups);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const currentGroup = groups.find((g) => g.items.some((i) => i.href === current))?.title;

  useEffect(() => {
    if (currentGroup) setClosed((c) => new Set([...c].filter((t) => t !== currentGroup)));
  }, [currentGroup]);

  return (
    <nav aria-label="Office" className="office-nav">
      {groups.map((g) => (
        <details
          key={g.title}
          open={!closed.has(g.title)}
          onToggle={(e) => {
            const isOpen = e.currentTarget.open;
            setClosed((c) => {
              if (isOpen === !c.has(g.title)) return c;
              return isOpen ? new Set([...c].filter((t) => t !== g.title)) : new Set([...c, g.title]);
            });
          }}
        >
          <summary>{g.title}</summary>
          <ul>
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={i.href === current ? "page" : undefined}>
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </nav>
  );
}
