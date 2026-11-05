// The office sidebar (frontend plan section 4). Only pages that exist and work are listed; a group with
// no page yet (Controls, Reports, Administration) is left out until it has one. Hiding an item is
// convenience, never a control: RLS and the app.* functions decide every read and write (doc 06 section 2).
//
// `ownerOnly` hides an item from the manager. No page on this list is owner-only today: Team is
// governance, but a manager reads it without controls (H-15). The first owner-only page sets the flag.

export type OfficeRole = "owner" | "manager";

export type NavItem = { href: string; label: string; ownerOnly?: boolean; also?: readonly string[] };
export type NavGroup = { title: string; items: readonly NavItem[] };

export const OFFICE_NAV: readonly NavGroup[] = [
  { title: "Overview", items: [{ href: "/office", label: "Overview" }] },
  {
    title: "Customers and Salons",
    items: [
      { href: "/office/salons", label: "Salons" },
      { href: "/office/salons/approvals", label: "Salon approvals" },
      { href: "/office/territories", label: "Territories" },
      { href: "/office/people", label: "People" },
    ],
  },
  {
    title: "Orders and Deliveries",
    items: [
      { href: "/office/orders", label: "Orders" },
      { href: "/office/deliveries", label: "Delivery approvals" },
      { href: "/office/approvals", label: "Approvals" },
    ],
  },
  {
    title: "Inventory and Stock",
    items: [
      { href: "/office/products", label: "Products" },
      { href: "/office/stock", label: "Stock" },
    ],
  },
  {
    title: "Money and Collections",
    items: [
      { href: "/office/receivables", label: "Receivables" },
      { href: "/office/handovers", label: "Cash handover" },
      { href: "/office/commission", label: "Commission" },
      { href: "/office/investors", label: "Investors" },
      { href: "/office/invoices", label: "Invoices", also: ["/office/receipts"] },
    ],
  },
  {
    title: "Field Team",
    items: [
      { href: "/office/team", label: "Team" },
      { href: "/office/devices", label: "Devices" },
      { href: "/office/reps", label: "Rep performance" },
    ],
  },
];

/** The groups this role sees; a group left with no item is dropped. */
export const navFor = (role: OfficeRole): NavGroup[] =>
  OFFICE_NAV.map((g) => ({ ...g, items: g.items.filter((i) => role === "owner" || !i.ownerOnly) })).filter(
    (g) => g.items.length > 0,
  );

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * The one item a path belongs to: the home only on /office itself, otherwise the longest match, so
 * /office/salons/approvals lights Salon approvals and not Salons, and /office/reps/abc Rep performance.
 */
export function currentHref(pathname: string, groups: readonly NavGroup[]): string | null {
  const items = groups.flatMap((g) => g.items).filter((i) => i.href !== "/office");
  const hits = items.flatMap((i) =>
    [i.href, ...(i.also ?? [])].filter((base) => under(pathname, base)).map((base) => ({ href: i.href, length: base.length })),
  );
  if (hits.length > 0) return hits.reduce((a, b) => (b.length > a.length ? b : a)).href;
  return pathname === "/office" ? "/office" : null;
}
