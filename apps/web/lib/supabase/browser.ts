"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

const DEVICE_KEY = "kiran.device";

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
 * the old `x-kiran-device` header after a rotation (L-0042 defect 1). The client is
 * rebuilt whenever the device id changes.
 */
export function supabaseBrowser() {
  const id = deviceId();
  if (!client || clientDevice !== id) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      isSingleton: false,
      global: { headers: { "x-kiran-device": id } },
    });
    clientDevice = id;
  }
  return client;
}

/**
 * A revoked device id is dead for good (migration 0006). Replace it with a fresh one;
 * the next supabaseBrowser() call builds a client that sends the new header. The new id
 * must be approved by the office like any new phone.
 */
export function rotateDeviceId(): string {
  window.localStorage.removeItem(DEVICE_KEY);
  client = undefined;
  clientDevice = undefined;
  return deviceId();
}
