// Value normalisers for the salon import (P0-02). Pure functions: no I/O, no globals.
// Target shapes follow doc 04 (salon, salon_contact) and ACTIVITY §5 (money in paisa).

export type Result<T> = { ok: true; value: T; warning?: string } | { ok: false; error: string };

// doc 04 salon.type
export const SALON_TYPES = [
  "ladies_parlor", "mens_salon", "unisex", "bridal_studio", "barber",
  "hair_studio", "spa_wellness", "home_parlor", "academy", "other",
] as const;
export type SalonType = (typeof SALON_TYPES)[number];

// Words owners actually write in a "type" column, mapped to the enum. Matching is on
// lowercased words, so "Ladies Beauty Parlour" and "LADIES PARLOR" both land on ladies_parlor.
const TYPE_RULES: Array<[RegExp, SalonType]> = [
  [/\b(academy|institute|training|school)\b/, "academy"],
  [/\b(home|ghar)\b/, "home_parlor"],
  [/\bbridal\b/, "bridal_studio"],
  [/\b(spa|wellness)\b/, "spa_wellness"],
  [/\bunisex\b/, "unisex"],
  // Both ladies and gents in one label is a unisex salon, not a men's salon (council audit
  // finding 10: "Ladies & Gents Salon" was read as mens_salon, a lower starting credit limit).
  [/\b(ladies|lady|women|female)\b.*\b(gents?|mens?|male)\b|\b(gents?|mens?|male)\b.*\b(ladies|lady|women|female)\b/, "unisex"],
  [/\b(barber|hajjam|hajam)\b/, "barber"],
  [/\b(gents?|mens?|male)\b/, "mens_salon"],
  [/\b(ladies|lady|women|female|parlou?r|beauty)\b/, "ladies_parlor"],
  // Only a hair studio; a bare "studio" (e.g. "Nail Studio") is not recognised and gets a warning.
  [/\bhair\s*studio\b/, "hair_studio"],
  [/\bother\b/, "other"],
];

export function mapSalonType(raw: string): Result<SalonType> {
  const v = raw.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (v === "") return { ok: true, value: "other", warning: "type is empty; imported as other" };
  if ((SALON_TYPES as readonly string[]).includes(v.replace(/ /g, "_"))) return { ok: true, value: v.replace(/ /g, "_") as SalonType };
  for (const [re, t] of TYPE_RULES) if (re.test(v)) return { ok: true, value: t };
  return { ok: true, value: "other", warning: "type not recognised; imported as other" };
}

// Pakistani phone numbers to E.164 (+92…). Mobiles are 03XX-XXXXXXX; Excel often drops the
// leading zero (3XXXXXXXXX) or shows the number in scientific notation, which loses digits.
export function normalizePhone(raw: string): Result<string> {
  const v = raw.trim();
  if (/^\d(\.\d+)?e\+?\d+$/i.test(v)) return { ok: false, error: "phone is stored as a number in Excel and has lost digits; format the column as text" };
  if (/[a-z]/i.test(v.replace(/\b(ext|x)\b.*$/i, ""))) return { ok: false, error: "phone contains letters" };
  let d = v.replace(/[\s().\-\/]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("0092")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return { ok: false, error: "phone has characters other than digits, spaces, dashes or brackets" };
  if (/^923\d{9}$/.test(d)) return { ok: true, value: "+" + d };
  if (/^03\d{9}$/.test(d)) return { ok: true, value: "+92" + d.slice(1) };
  if (/^3\d{9}$/.test(d)) return { ok: true, value: "+92" + d };
  // Landlines: 0 + area code + subscriber number (Karachi 021 + 8 digits). They cannot
  // receive the CTL-09 verification OTP, so they are imported with a warning.
  // No landline area code starts with 3 (03 is the mobile prefix), so a short 03 number is a
  // mobile with a digit missing, not a landline (L-0085 P0-02 D5).
  if (/^92[124-9]\d{8,9}$/.test(d)) return { ok: true, value: "+" + d, warning: "landline: cannot receive the verification OTP (CTL-09)" };
  if (/^0[124-9]\d{8,9}$/.test(d)) return { ok: true, value: "+92" + d.slice(1), warning: "landline: cannot receive the verification OTP (CTL-09)" };
  if (/^(0|92)?3\d+$/.test(d)) return { ok: false, error: "mobile number has the wrong number of digits (expected 03XX-XXXXXXX)" };
  return { ok: false, error: "phone is not a valid Pakistani number" };
}

// Several numbers in one cell ("0399-0000001 / 0399-0000002") are common.
export function splitPhones(raw: string): string[] {
  return raw.split(/\s*(?:[,;|\/]|\bor\b|\n)\s*/i).map((s) => s.trim()).filter(Boolean);
}

// Lists and reports show phones masked (doc 04: 03xx-xxx-1234).
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.length >= 4 ? `0${d.slice(2, 3)}xx-xxx-${d.slice(-4)}` : "***";
}

// Rupee amounts to integer paisa (bigint; never floats). Accepts "Rs 12,500", "12500.5",
// "(1,000)" for a negative, "-1000", "12,500/-", and lakh grouping "1,25,000" (L-0085 FP1).
// At most two decimal places. Brackets and a minus together are ambiguous and refused (D6).
export function parsePaisa(raw: string): Result<bigint> {
  let v = raw.trim().replace(/^(rs\.?|pkr)\s*/i, "").replace(/\s*(\/-|rs\.?|pkr)$/i, "").replace(/\s+/g, "");
  if (v === "" || v === "-") return { ok: true, value: 0n };
  let neg = false;
  if (/^\(.*\)$/.test(v)) { neg = true; v = v.slice(1, -1); }
  if (v.startsWith("-")) {
    if (neg) return { ok: false, error: "amount has both brackets and a minus sign; write one of them" };
    neg = true; v = v.slice(1);
  }
  if (!/^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})+,\d{3}|\d+)(\.\d{1,2})?$/.test(v)) return { ok: false, error: "amount is not a rupee figure (expected e.g. 12,500 or 12500.50)" };
  const [whole, frac = ""] = v.replace(/,/g, "").split(".");
  const paisa = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
  return { ok: true, value: neg ? -paisa : paisa };
}

// Excel error values, as exceljs reads them or as a CSV export shows them, and the marker the
// reader uses for a formula with no saved result. Returns the error message, or null.
export const NO_RESULT = "#NO-RESULT";
const EXCEL_ERRORS = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|BUSY!|UNKNOWN!|GETTING_DATA)$/i;
export function excelError(cell: string): string | null {
  const v = cell.trim();
  if (v === NO_RESULT) return "cell is a formula with no saved result: open the file in Excel, let it calculate, and save it";
  if (EXCEL_ERRORS.test(v)) return `cell holds the Excel error ${v.toUpperCase()}: fix the formula or type the value`;
  return null;
}

export function formatRupees(paisa: bigint): string {
  const neg = paisa < 0n;
  const a = neg ? -paisa : paisa;
  const whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (a % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}Rs ${whole}${frac === "00" ? "" : "." + frac}`;
}

export function parseChairs(raw: string): Result<number | null> {
  const v = raw.trim();
  if (v === "") return { ok: true, value: null };
  if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > 200) return { ok: false, error: "chairs must be a whole number from 1 to 200" };
  return { ok: true, value: Number(v) };
}

// Karachi division, generous box. Outside it is a warning: the pin is probably swapped or wrong.
const KHI = { latMin: 24.6, latMax: 25.4, lngMin: 66.6, lngMax: 67.7 };

export function parseGeo(latRaw: string, lngRaw: string): Result<{ lat: number; lng: number } | null> {
  const la = latRaw.trim(), ln = lngRaw.trim();
  if (la === "" && ln === "") return { ok: true, value: null };
  if (la === "" || ln === "") return { ok: false, error: "latitude and longitude must both be given, or neither" };
  const lat = Number(la), lng = Number(ln);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, error: "latitude/longitude is not a valid coordinate" };
  const inside = lat >= KHI.latMin && lat <= KHI.latMax && lng >= KHI.lngMin && lng <= KHI.lngMax;
  if (!inside) {
    const swapped = lng >= KHI.latMin && lng <= KHI.latMax && lat >= KHI.lngMin && lat <= KHI.lngMax;
    return { ok: true, value: { lat, lng }, warning: swapped ? "latitude and longitude look swapped" : "pin is outside Karachi" };
  }
  return { ok: true, value: { lat, lng } };
}

// Comparison key for headings, names and areas: case, spacing and punctuation do not matter.
// Invisible characters (format characters such as a zero-width space, a zero-width non-joiner
// or a soft hyphen, other default-ignorable code points such as the Hangul fillers, and
// combining marks) are removed, not turned into a word break: "Ph<ZWSP>one" is the same heading
// as "Phone", so a second such column is a duplicate, never an ignored "column D" (L-0116
// P0-02 D2). Visible look-alike letters from other scripts are a known limit (L-0061, B-22).
export function keyOf(s: string): string {
  return s.normalize("NFKC").replace(/[\p{Cf}\p{Mn}\p{Default_Ignorable_Code_Point}]/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
