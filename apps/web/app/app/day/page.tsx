import { RepDay } from "../rep-day";

// The rep's working day (execution map, slice 2). Kept off the rep home so that page.tsx stays
// the self-contained device-registration screen the verifier probes load on their own
// (supabase/tests/reverify4-attacks.test.ts, reverify5-attacks.test.ts).
export default function RepDayPage() {
  return (
    <main>
      <h1>
        Today · <span lang="ur">آج</span>
      </h1>
      <p>
        <a href="/app">← Home</a> · <a href="/app/salons">Salons</a>
      </p>
      <RepDay />
    </main>
  );
}
