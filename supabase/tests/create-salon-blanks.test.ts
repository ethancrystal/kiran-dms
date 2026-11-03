/**
 * create_salon treats Unicode whitespace as blank (migration 0020), the follow-up to B-34 item 3
 * that Code Reviewer found on PR 42: migration 0019 fixed app.update_salon only, and create_salon
 * still used btrim(), which strips only the plain space. Synthetic [Test] data only (H-03).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { MANAGER, run } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (sql: string, params: unknown[] = []) => (await run(MANAGER, sql, params, C)).rows[0];
const T = id();
const A = id();

beforeAll(async () => {
  await one("select app.office_upsert_territory($1, $2)", [T, `[Test] Blanks T ${tag()}`]);
  await one("select app.office_upsert_area($1, $2, '[Test] Blanks area')", [A, T]);
});

const BLANKS = ["\t\t", "\n\n", "\u00a0\u00a0", " \r\n\u3000"];

describe("create_salon: whitespace-only text is blank", () => {
  it.each(BLANKS)("saves a whitespace-only name as no name, as a plain-space one already was (%j)", async (blank) => {
    const v = await one("select (app.create_salon($1, $2, 'barber', $3, 'manual')).name", [id(), blank, A]);
    expect(v.name).toBeNull();
  });
  it.each(BLANKS)("saves a whitespace-only contact name, address and note as blank (%j)", async (blank) => {
    const s = id();
    await one(
      "select app.create_salon($1, '[Test] Blanks Salon', 'barber', $2, 'manual', $3, null, null, null, $3, '+920000009201', $3)",
      [s, A, blank],
    );
    const salon = await one("select address from public.salon where id = $1", [s]);
    expect(salon.address).toBeNull();
    const contacts = (await run("postgres", "select name from public.salon_contact where salon_id = $1", [s])).rows;
    expect(contacts).toEqual([{ name: null }]);
    const notes = (await run("postgres", "select 1 from public.salon_note where salon_id = $1", [s])).rows;
    expect(notes).toHaveLength(0);
  });

  it("keeps real text, trimmed of surrounding whitespace", async () => {
    const s = id();
    const v = await one("select (app.create_salon($1, $2, 'barber', $3, 'manual')).name", [s, "\t[Test] Trim Salon\u00a0", A]);
    expect(v.name).toBe("[Test] Trim Salon");
  });
});