"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { maskPhone } from "@/lib/office-gaps";
import { db, rows, rpc } from "@/lib/rpc";

type Duplicate = { phone: string; salon_ids: string[] };
type Named = { id: string; name: string | null };

// Shown at most; the function returns every shared phone, and a long list belongs in the digest (P1-08).
const SHOWN = 50;

// CTL-18 (part): phones on more than one active salon contact, from app.duplicate_phones (owner or
// manager; the database refuses anyone else). Phones are masked as app.mask_phone masks them; each
// salon links to its own page, where the office reads the full number.
export function DuplicatePhones() {
  const [list, setList] = useState<Duplicate[]>([]);
  const [names, setNames] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const go = async () => {
      try {
        const found = (await rpc<Duplicate[] | null>("duplicate_phones")) ?? [];
        const shown = found.slice(0, SHOWN);
        const ids = [...new Set(shown.flatMap((d) => d.salon_ids))];
        const named = ids.length === 0 ? [] : await rows<Named>(db().from("salon").select("id, name").in("id", ids));
        if (!live) return;
        setList(found);
        setNames(new Map(named.map((n) => [n.id, n.name])));
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    };
    void go();
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="card" aria-labelledby="shared-phones-h" data-testid="shared-phones">
      <h2 id="shared-phones-h">Phones on more than one salon</h2>
      <p className="muted">The same active phone number on two or more salons may be one salon entered twice.</p>
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No phone is shared between salons." />
      {!loading && !error && list.length > 0 && (
        <ul className="plain">
          {list.slice(0, SHOWN).map((d) => (
            <li key={d.phone} data-testid="shared-phone">
              <code>{maskPhone(d.phone)}</code>:{" "}
              {d.salon_ids.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <Link href={`/office/salons/${id}`}>{names.get(id) ?? "Unnamed salon"}</Link>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {list.length > SHOWN && (
        <p className="muted">
          Showing {SHOWN} of {list.length} shared phones.
        </p>
      )}
    </section>
  );
}
