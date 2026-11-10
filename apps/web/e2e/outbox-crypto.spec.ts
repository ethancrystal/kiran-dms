import { expect, test } from "@playwright/test";
import { newKey, openJson, sealJson } from "../lib/outbox/crypto";

// P1-09 (doc 05: encrypted cache). The queue's contents are sealed before they are written to the
// phone's storage. These run in Node, which has the same WebCrypto as the browser.

// About the size of a signature picture as a data URL, well past one chunk of the encoder.
const PICTURE_CHARS = 200_000;
const AMOUNT_PAISA = 150_000;
const VALUE = { p_client_id: "a", p_amount_paisa: AMOUNT_PAISA, note: "[Dummy] salon, cash" };

test("a sealed value opens to the original with the same key", async () => {
  const key = await newKey();
  const sealed = await sealJson(key, VALUE);
  expect(await openJson(key, sealed)).toEqual(VALUE);
});

test("the sealed text does not contain the value", async () => {
  const key = await newKey();
  const sealed = await sealJson(key, VALUE);
  expect(sealed).not.toContain("p_client_id");
  expect(sealed).not.toContain("Dummy");
});

test("opening with a different key fails", async () => {
  const sealed = await sealJson(await newKey(), VALUE);
  await expect(openJson(await newKey(), sealed)).rejects.toThrow();
});

test("a sealed text that was changed fails to open", async () => {
  const key = await newKey();
  const sealed = await sealJson(key, VALUE);
  const flipped = sealed.endsWith("A") ? "B" : "A";
  await expect(openJson(key, `${sealed.slice(0, -1)}${flipped}`)).rejects.toThrow();
});

test("sealing the same value twice gives different text", async () => {
  const key = await newKey();
  expect(await sealJson(key, VALUE)).not.toBe(await sealJson(key, VALUE));
});

test("the key cannot be exported", async () => {
  const key = await newKey();
  expect(key.extractable).toBe(false);
  await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
});

test("a value the size of a signature picture survives", async () => {
  const key = await newKey();
  const picture = { p_image: "x".repeat(PICTURE_CHARS) };
  expect(await openJson(key, await sealJson(key, picture))).toEqual(picture);
});

test("null survives", async () => {
  const key = await newKey();
  expect(await openJson(key, await sealJson(key, null))).toBeNull();
});
