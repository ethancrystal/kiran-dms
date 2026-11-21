const fs = require("fs");
function body(path, startMarker) {
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  const s = lines.findIndex((l) => l.includes(startMarker));
  let e = s;
  while (e < lines.length && !/\$\$;\s*$/.test(lines[e])) e++;
  return lines.slice(s, e + 1).filter((l) => !l.trim().startsWith("--")).join("\n");
}
const a = body("supabase/migrations/20261024232225_device_hardening.sql", "create or replace function control.audit_row");
const b = body(".worktrees/vault/supabase/migrations/20261121150000_vault_suppliers.sql", "create or replace function control.audit_row");
const norm = (t) => t.replace(/\s+/g, " ").trim();
const A = norm(a);
const B = norm(b);
console.log("src chars", A.length, "dst chars", B.length);
let i = 0;
while (i < A.length && i < B.length && A[i] === B[i]) i++;
console.log("first diff at", i);
console.log("SRC ...", JSON.stringify(A.slice(Math.max(0, i - 40), i + 200)));
console.log("DST ...", JSON.stringify(B.slice(Math.max(0, i - 40), i + 200)));
console.log("dst has redaction branch:", B.includes("supplier_vault"));
