"use client";
import { rpc } from "@/lib/rpc";

export type Salon = {
  id: string;
  name: string | null;
  type: string;
  stage: string;
  verification_status: string;
  area_id: string;
  area_name: string;
  lat: number | null;
  lng: number | null;
  phone_masked: string | null;
};

export const SALON_TYPES = [
  "ladies_parlor",
  "mens_salon",
  "unisex",
  "bridal_studio",
  "barber",
  "hair_studio",
  "spa_wellness",
  "home_parlor",
  "academy",
  "other",
] as const;

export const VISIT_OUTCOMES = [
  "order",
  "collection",
  "sample",
  "quote",
  "intro",
  "no_decision",
  "closed_not_interested",
  "not_present",
] as const;

export const label = (s: string) => s.replace(/_/g, " ");

/** One page of the rep's salons (app.my_salons: own territories only, capped at 50 rows, phones masked). */
export function salonPage(after?: Salon) {
  return rpc<Salon[]>("my_salons", { p_after_name: after?.name ?? null, p_after_id: after?.id ?? null, p_limit: 50 });
}

/**
 * One salon as app.my_salon returns it (migration 0016; approval_status since slice 7, migration
 * 20261105160000): read-only for the rep (D-35). A salon the rep proposed reads pending until the office decides.
 */
export type SalonDetail = Salon & {
  address: string | null;
  chairs: number | null;
  approval_status: "pending" | "approved" | "rejected";
};

/** One of the rep's own salons (app.my_salon: same territory scope as app.my_salons, phone masked), or null. */
export async function findSalon(id: string): Promise<SalonDetail | null> {
  const rows = await rpc<SalonDetail[]>("my_salon", { p_id: id });
  return rows?.[0] ?? null;
}

/** Browser GPS, or null when the phone refuses or has no fix. */
export function position(): Promise<{ lat: number; lng: number } | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    ),
  );
}
