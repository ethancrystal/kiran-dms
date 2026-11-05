// Times on the page (REP-20, L2). The database keeps timestamps in UTC and its dates are Karachi
// dates, so every page shows a time in Karachi, not in the zone of the browser it happens to open in.

export const KARACHI = "Asia/Karachi";

/** A database time as a short Karachi date and time, e.g. "06-Nov-2026, 1:00 am". */
export const when = (t: string) =>
  new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", timeZone: KARACHI });

/** Like `when`, for a time that may be missing: a dash when there is none. */
export const whenOrDash = (t: string | null) => (t ? when(t) : "—");

/** A database time as a short Karachi clock time only, e.g. "1:00 am". */
export const clock = (t: string) => new Date(t).toLocaleTimeString("en-PK", { timeStyle: "short", timeZone: KARACHI });
