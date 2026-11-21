// Types for scripts/dependency-audit.mjs, which is plain JavaScript so it can be piped into
// directly (`pnpm audit --json --prod | node scripts/dependency-audit.mjs`). The builder test
// imports evaluateAudit; this declaration is what makes that import typed.
export type AuditException = { id: string; reason: string; expires: string };
export type AuditEvaluation = { ok: boolean; failures: string[] };

export function evaluateAudit(report: unknown, exceptionsList: AuditException[], todayValue: string): AuditEvaluation;
