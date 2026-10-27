// Column mapping for the salon import (P0-02, SAL-10 "field mapping"). Headers in the owner's
// Excel are free text; each import field lists the headers it answers to. An explicit
// mapping (field -> header) overrides the guess.

import { keyOf } from "./normalize.ts";

export const FIELDS = {
  name:            { required: true,  aliases: ["salon name", "salon", "name", "parlor name", "parlour name", "parlor", "parlour", "shop name", "shop", "customer", "customer name", "party", "party name", "business name"] },
  type:            { required: false, aliases: ["type", "salon type", "category", "kind"] },
  area:            { required: true,  aliases: ["area", "locality", "location", "block", "sector", "town", "zone"] },
  address:         { required: false, aliases: ["address", "full address", "street", "addr"] },
  phone:           { required: false, aliases: ["phone", "phone no", "phone number", "mobile", "mobile no", "mobile number", "cell", "cell no", "contact no", "contact number", "number", "whatsapp", "tel", "telephone"] },
  contact_name:    { required: false, aliases: ["owner", "owner name", "contact", "contact name", "contact person", "person", "proprietor"] },
  chairs:          { required: false, aliases: ["chairs", "no of chairs", "chair", "size", "seats"] },
  lat:             { required: false, aliases: ["lat", "latitude"] },
  lng:             { required: false, aliases: ["lng", "lon", "long", "longitude"] },
  opening_balance: { required: false, aliases: ["balance", "opening balance", "outstanding", "amount due", "due", "receivable", "udhaar", "udhar", "baqaya", "remaining", "pending amount"] },
  notes:           { required: false, aliases: ["notes", "note", "remarks", "remark", "comments", "comment"] },
  ref:             { required: false, aliases: ["ref", "sr", "sr no", "s no", "serial", "id", "code", "customer code", "account no"] },
} as const;

export type Field = keyof typeof FIELDS;
export const FIELD_NAMES = Object.keys(FIELDS) as Field[];
export type Mapping = Partial<Record<Field, string>>;

export type MappingResult = {
  mapping: Mapping;            // field -> header as it appears in the file
  extraPhones: string[];       // further phone-like columns ("Owner Mobile"): checked as phones too
  unmappedHeaders: string[];   // headers no field claimed (ignored by the import)
  missingRequired: Field[];    // required fields with no column: the dry-run cannot pass
  problems: string[];          // explicit-mapping mistakes (unknown field or header)
};

// A header naming a phone ("Contact Mobile", "Owner Mobile", "WhatsApp No") is a phone column,
// whatever other word it starts with (L-0085 P0-02 D4).
const PHONE_WORD = /\b(mobile|phone|cell|whatsapp|tel|telephone|contact no|contact number|fone)\b/;
export const isPhoneHeader = (h: string) => PHONE_WORD.test(keyOf(h));

// Reports print a header's text only when every word in it is header vocabulary (the alias
// words plus a few connectors). Anything else could be a data row taken as the header (a salon
// name, a phone), so it is shown as its column letter instead (H-03, L-0085 P0-02 D1).
const VOCAB = new Set([
  ...Object.values(FIELDS).flatMap((f) => f.aliases.flatMap((a) => a.split(" "))),
  "mobile", "phone", "cell", "whatsapp", "tel", "telephone", "fone", "no", "number", "of", "the", "and",
  "salon", "salons", "shop", "owner", "contact", "primary", "secondary", "alt", "alternate", "other", "second",
  "rs", "pkr", "amount", "total", "date", "city", "colour", "color", "status", "rep",
]);
export const isHeaderWords = (h: string) => {
  const words = keyOf(h).split(" ").filter(Boolean);
  return words.length > 0 && words.length <= 5 && words.every((w) => VOCAB.has(w));
};
export const columnLetter = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function resolveMapping(headers: string[], explicit: Record<string, string> = {}): MappingResult {
  const problems: string[] = [];
  const mapping: Mapping = {};
  const used = new Set<string>();
  const byKey = new Map(headers.filter((h) => h.trim() !== "").map((h) => [keyOf(h), h] as const));

  for (const [field, header] of Object.entries(explicit)) {
    if (!(FIELD_NAMES as string[]).includes(field)) { problems.push(`mapping names an unknown field "${field}"`); continue; }
    const actual = byKey.get(keyOf(header));
    if (!actual) { problems.push(`mapping for "${field}" names a column that is not in the file: "${header}"`); continue; }
    if (used.has(actual)) { problems.push(`column "${actual}" is mapped to more than one field`); continue; }
    mapping[field as Field] = actual;
    used.add(actual);
  }

  // Guess the rest: an exact alias match first, then any header naming a phone for the phone
  // field, then a header that starts with an alias. Phone-like headers never go to another field.
  for (const pass of ["exact", "phone", "prefix"] as const) {
    for (const field of FIELD_NAMES) {
      if (mapping[field]) continue;
      if (pass === "phone" && field !== "phone") continue;
      for (const alias of FIELDS[field].aliases) {
        const hit = [...byKey.entries()].find(([k, h]) => !used.has(h) && (
          pass === "exact" ? k === alias
          : pass === "phone" ? isPhoneHeader(h)
          : k.startsWith(alias + " ") && (field === "phone" || !isPhoneHeader(h))));
        if (hit) { mapping[field] = hit[1]; used.add(hit[1]); break; }
      }
    }
  }
  const extraPhones = headers.filter((h) => h.trim() !== "" && !used.has(h) && isPhoneHeader(h));
  for (const h of extraPhones) used.add(h);

  return {
    mapping,
    extraPhones,
    unmappedHeaders: headers.filter((h) => h.trim() !== "" && !used.has(h)),
    missingRequired: FIELD_NAMES.filter((f) => FIELDS[f].required && !mapping[f]),
    problems,
  };
}
