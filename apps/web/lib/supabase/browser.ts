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

/**
 * A revoked device id is dead for good (migration 0006). Replace it with a fresh one and
 * rebuild the client so the new header is sent; the new id must be approved again.
 */
export function rotateDeviceId(): string {
  window.localStorage.removeItem(DEVICE_KEY);
  client = undefined;
  return deviceId();
}

let client: ReturnType<typeof createBrowserClient> | undefined;

export function supabaseBrowser() {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { "x-kiran-device": deviceId() } },
  });
  return client;
}
