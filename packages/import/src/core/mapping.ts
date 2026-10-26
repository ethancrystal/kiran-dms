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
  unmappedHeaders: string[];   // headers no field claimed (ignored by the import)
  missingRequired: Field[];    // required fields with no column: the dry-run cannot pass
  problems: string[];          // explicit-mapping mistakes (unknown field or header)
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

  // Guess the rest: an exact alias match first, then a header that starts with an alias.
  for (const pass of ["exact", "prefix"] as const) {
    for (const field of FIELD_NAMES) {
      if (mapping[field]) continue;
      for (const alias of FIELDS[field].aliases) {
        const hit = [...byKey.entries()].find(([k, h]) => !used.has(h) && (pass === "exact" ? k === alias : k.startsWith(alias + " ")));
        if (hit) { mapping[field] = hit[1]; used.add(hit[1]); break; }
      }
    }
  }

  return {
    mapping,
    unmappedHeaders: headers.filter((h) => h.trim() !== "" && !used.has(h)),
    missingRequired: FIELD_NAMES.filter((f) => FIELDS[f].required && !mapping[f]),
    problems,
  };
}
