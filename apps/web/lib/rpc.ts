"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type Role = "owner" | "manager" | "rep";

export type Session = {
  full_name: string;
  role: Role;
  status: "active" | "suspended" | "offboarded";
  device_status: "pending" | "approved" | "revoked" | null;
};

/** The database's own words, or a fallback. Every rule is enforced there (doc 06 §2); the page only reports. */
export function messageOf(error: unknown, fallback = "The request was refused."): string {
  const m = (error as { message?: unknown } | null)?.message;
  return typeof m === "string" && m.trim() ? m : fallback;
}

/** Calls an app.* function (the only write path, H-08). Returns the data or throws the database's message. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().schema("app").rpc(fn, args);
  if (error) throw new Error(messageOf(error));
  return data as T;
}

/**
 * Calls a vault_api function (P1-05). The vault is read no other way: the schema has no grant for any
 * application role, and each function checks the vault grant and AAL2 before it answers (doc 07 §2).
 * The database's refusal is shown as it comes, never replaced with an empty list.
 */
export async function vaultRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().schema("vault_api").rpc(fn, args);
  if (error) throw new Error(messageOf(error, "The vault refused this request."));
  return data as T;
}

/** Reads rows of a public table through RLS. Throws the database's message on refusal. */
export async function rows<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(messageOf(error, "Could not load this list."));
  return (data ?? []) as T[];
}

export const db = () => supabaseBrowser();

export async function mySession(): Promise<Session | null> {
  return (await rpc<Session | null>("my_session")) ?? null;
}
