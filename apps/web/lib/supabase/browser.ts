"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

const DEVICE_KEY = "kiran.device";
const CLAIM_KEY = "kiran.device.registering";
const CLAIM_TTL_MS = 30_000;

/**
 * A stable per-install device id (SEC-03). It is sent as `x-kiran-device` on every
 * request; the database only honours it when an office user has approved the device.
 */
export function deviceId(): string {
  let id = window.localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    window.localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

let client: ReturnType<typeof createBrowserClient> | undefined;
let clientDevice: string | undefined;

/**
 * The browser client, bound to the current device id. `isSingleton: false` stops
 * @supabase/ssr from handing back its own module-level cached client, which would keep
 * the old `x-kiran-device` header after a rotation (L-0042). The client is rebuilt
 * whenever the device id changes; the replaced client's token auto-refresh is stopped so
 * it cannot keep sending the old id (L-0055 observation). Always call this per request
 * rather than holding on to a client across a rotation.
 */
export function supabaseBrowser() {
  const id = deviceId();
  if (!client || clientDevice !== id) {
    if (client) void client.auth.stopAutoRefresh();
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      isSingleton: false,
      global: { headers: { "x-kiran-device": id } },
    });
    clientDevice = id;
  }
  return client;
}

/**
 * Replace the device id. With `revokedId`, only if it is still the stored one
 * (compare-and-swap): if another tab or a second effect run has already rotated it, adopt
 * that new id instead of minting a second one (L-0055 C1). Without it, rotate
 * unconditionally.
 */
export function rotateDeviceId(revokedId?: string): string {
  if (revokedId === undefined || window.localStorage.getItem(DEVICE_KEY) === revokedId) {
    window.localStorage.removeItem(DEVICE_KEY);
  }
  return deviceId();
}

let inflight: Promise<{ error: unknown }> | null = null;

/**
 * Make sure this phone's current device id is registered, exactly once (migration 0006:
 * a revoked id is dead for good, so a revoked phone needs a fresh id). Safe to call from
 * an effect that runs twice (React strict mode) and from two tabs at once:
 *   - one in-flight promise per page;
 *   - compare-and-swap rotation across tabs;
 *   - a short-lived claim in localStorage so a second tab does not register the same id again.
 * `idUsedForStatus` is the device id that was sent when `status` was read.
 */
export function ensureDeviceRegistered(status: string | null, idUsedForStatus: string): Promise<{ error: unknown }> {
  inflight ??= (async () => {
    if (status === "revoked") rotateDeviceId(idUsedForStatus);
    else if (status !== null) return { error: null };
    const id = deviceId();
    try {
      const claim = JSON.parse(window.localStorage.getItem(CLAIM_KEY) ?? "null") as { id: string; at: number } | null;
      if (claim && claim.id === id && Date.now() - claim.at < CLAIM_TTL_MS) return { error: null };
    } catch { /* unreadable claim: ignore it */ }
    window.localStorage.setItem(CLAIM_KEY, JSON.stringify({ id, at: Date.now() }));
    const reg = await supabaseBrowser().schema("app").rpc("register_device", {
      p_fingerprint: id,
      p_platform: navigator.userAgent.slice(0, 60),
      p_label: null,
    });
    if (reg.error) window.localStorage.removeItem(CLAIM_KEY);
    return { error: reg.error };
  })().finally(() => { inflight = null; });
  return inflight;
}
