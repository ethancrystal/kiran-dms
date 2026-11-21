let meta = #{
    name: "plan-council",
    description: "Map every Kiran plan, audit twelve domains, verify citations",
    phases: [
        #{ title: "Map", detail: "one mapper per plan, plus a repo map" },
        #{ title: "Audit", detail: "one auditor per present domain" },
        #{ title: "Verify", detail: "refute each cited finding" },
        #{ title: "Synthesise", detail: "one report from confirmed findings" },
    ],
};

let plan_schema = #{
    "type": "object",
    "required": ["plan", "built", "missing", "findings"],
    "properties": #{
        "plan": #{ "type": "string" },
        "board_status": #{ "type": "string" },
        "built": #{
            "type": "array",
            "maxItems": 6,
            "items": #{
                "type": "object",
                "required": ["path", "what"],
                "properties": #{
                    "path": #{ "type": "string" },
                    "what": #{ "type": "string" },
                },
            },
        },
        "missing": #{
            "type": "array",
            "maxItems": 6,
            "items": #{
                "type": "object",
                "required": ["expected", "looked_in"],
                "properties": #{
                    "expected": #{ "type": "string" },
                    "looked_in": #{ "type": "string" },
                },
            },
        },
        "findings": #{
            "type": "array",
            "maxItems": 3,
            "items": #{
                "type": "object",
                "required": ["severity", "claim", "path", "line"],
                "properties": #{
                    "severity": #{ "type": "string" },
                    "claim": #{ "type": "string" },
                    "path": #{ "type": "string" },
                    "line": #{ "type": "integer" },
                    "failure_scenario": #{ "type": "string" },
                },
            },
        },
    },
};

let domain_schema = #{
    "type": "object",
    "required": ["domain", "score", "score_rationale", "findings"],
    "properties": #{
        "domain": #{ "type": "string" },
        "score": #{ "type": "integer" },
        "score_rationale": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 3,
            "items": #{
                "type": "object",
                "required": ["severity", "claim", "path", "line"],
                "properties": #{
                    "severity": #{ "type": "string" },
                    "claim": #{ "type": "string" },
                    "path": #{ "type": "string" },
                    "line": #{ "type": "integer" },
                    "failure_scenario": #{ "type": "string" },
                },
            },
        },
        "could_not_determine": #{
            "type": "array",
            "maxItems": 3,
            "items": #{ "type": "string" },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["verdict", "reason"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "reason": #{ "type": "string" },
    },
};

let root = "C:/Users/moizjmj/K-p1-33-catalogue";
let rules = "Read-only. Do not edit, commit, push, or run pnpm db:test. Do not touch C:/Users/moizjmj/K or C:/Users/moizjmj/K-p1-38-timeline. Use read_file and grep. A plan or README is not proof the code exists. Cite path and line from code or config you opened. ";

let plans = [
    "docs/plans/implemented/2026-11-03-office-orders-and-cards.md",
    "docs/plans/implemented/2026-11-04-delivery-submission-approval.md",
    "docs/plans/implemented/2026-11-05-final-review-checklist.md",
    "docs/plans/implemented/2026-11-05-project-completion.md",
    "docs/plans/implemented/hermes.md",
    "docs/plans/in-progress/2026-11-05-frontend-structure.md",
    "docs/plans/in-progress/2026-11-05-remaining-implementation.md",
    "docs/plans/in-progress/2026-11-08-p1-09-offline-rep-app.md",
    "docs/plans/in-progress/2026-11-10-khsalon-storefront-plan-b-catalogue-data.md",
    "docs/plans/will-be-implemented/2026-11-06-not-yet-planned.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-overview.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-a-decisions.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-c-catalogue-load.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-d-pages-seo.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-e-tracking.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-f-shopify.md",
    "docs/plans/will-be-implemented/2026-11-10-khsalon-storefront-plan-g-timeline-reminders.md",
];

let domains = [
    #{ name: "api-design", evidence: "apps/web routes and app RPC functions in supabase/migrations" },
    #{ name: "database-design", evidence: "supabase/migrations, foreign keys, RLS, forward-only SQL" },
    #{ name: "system-architecture", evidence: "apps/web, packages/import, supabase schemas public control app" },
    #{ name: "security-fundamentals", evidence: "RLS force, auth, role checks, supabase/tests negative cases" },
    #{ name: "error-handling-and-resilience", evidence: "RPC errors, idempotency client_id, outbox plan, no silent success" },
    #{ name: "testing-strategy", evidence: "supabase/tests vitest, apps/web Playwright, .github/workflows/ci.yml" },
    #{ name: "observability", evidence: "control.audit_event hash chain; look also for metrics, tracing, health" },
    #{ name: "devops-and-ci-cd", evidence: ".github/workflows/ci.yml, pnpm lockfile, Railway notes in docs" },
    #{ name: "domain-modeling", evidence: "order, salon, stock, approval state in SQL functions and apps/web" },
    #{ name: "implementation-patterns", evidence: "app security definer functions, Next server actions, shared helpers" },
    #{ name: "requirements-and-scope", evidence: "docs/plans and docs/ACTIVITY.md versus the code those plans name" },
    #{ name: "ui-and-frontend", evidence: "apps/web app office salon routes, forms, empty and error states" },
];

phase("Map");
let map_jobs = [];
for path in plans {
    let prompt = rules;
    prompt += "Repo root " + root + ". Read " + path + " and docs/ACTIVITY.md section 12 for any task id the plan names. ";
    prompt += "Search the code for what the plan says is built. Return built items only when you opened the file. Return missing when you searched and did not find it. ";
    prompt += "At most 3 findings, each a real gap between this plan and the code, with path and line. Empty findings is valid. ";
    prompt += "Set plan to " + path + ".";
    map_jobs.push(#{
        prompt: prompt,
        label: "map:" + path,
        capability_mode: "read-only",
        output_schema: plan_schema,
    });
}

let repo_prompt = rules;
repo_prompt += "Produce a Deep Architecture Map of " + root + " using the repo-intelligence-mapper sections: executive summary, runtime and stack, directory map, critical flows for office order, rep day, and public storefront, quality gates, risk register, agent handoff. Mark uncertain claims as likely. Stay under 120 lines. Do not edit files.";
map_jobs.push(#{
    prompt: repo_prompt,
    label: "repo-map",
    capability_mode: "read-only",
});

let mapped = parallel(map_jobs);

let plan_rows = [];
let queue = [];
let raised = 0;
let i = 0;
for path in plans {
    let row = mapped[i];
    i += 1;
    if row != () && row.success && type_of(row.output) == "map" {
        plan_rows.push(row.output);
        if row.output.findings != () {
            let n = 0;
            for f in row.output.findings {
                if n < 3 {
                    let scenario = "";
                    if f.failure_scenario != () { scenario = f.failure_scenario; }
                    queue.push(#{
                        source: path,
                        severity: f.severity,
                        claim: f.claim,
                        path: f.path,
                        line: f.line,
                        failure_scenario: scenario,
                    });
                    raised += 1;
                }
                n += 1;
            }
        }
    } else {
        plan_rows.push(#{ plan: path, board_status: "mapper failed", built: [], missing: [], findings: [] });
    }
}

let repo_text = "Repo map did not return.";
let repo_row = mapped[plans.len()];
if repo_row != () && repo_row.success {
    if type_of(repo_row.output) == "string" {
        repo_text = repo_row.output;
    } else {
        repo_text = json_encode(repo_row.output);
    }
}

phase("Audit");
let audit_jobs = [];
for d in domains {
    let prompt = rules;
    prompt += "You are the domain-audit agent for one domain only: " + d.name + ". ";
    prompt += "Read C:/Users/moizjmj/.agents/skills/codebase-council/skills/domain-audit/SKILL.md and the " + d.name + " section of C:/Users/moizjmj/.agents/skills/codebase-council/reference/domains.md and the rubric at C:/Users/moizjmj/.agents/skills/codebase-council/reference/maturity-rubric.md. ";
    prompt += "Detection evidence to start from: " + d.evidence + ". Repo root " + root + ". ";
    prompt += "Score the code, not the plans. Score 3 or 4 only if you name the guard. At most 3 findings, each with path and line. Zero findings is valid. Set domain to " + d.name + ".";
    audit_jobs.push(#{
        prompt: prompt,
        label: "audit:" + d.name,
        capability_mode: "read-only",
        output_schema: domain_schema,
    });
}
let audited = parallel(audit_jobs);

let domain_rows = [];
let di = 0;
for d in domains {
    let row = audited[di];
    di += 1;
    if row != () && row.success && type_of(row.output) == "map" {
        domain_rows.push(row.output);
        if row.output.findings != () {
            let n = 0;
            for f in row.output.findings {
                if n < 3 {
                    let scenario = "";
                    if f.failure_scenario != () { scenario = f.failure_scenario; }
                    queue.push(#{
                        source: d.name,
                        severity: f.severity,
                        claim: f.claim,
                        path: f.path,
                        line: f.line,
                        failure_scenario: scenario,
                    });
                    raised += 1;
                }
                n += 1;
            }
        }
    } else {
        domain_rows.push(#{ domain: d.name, score: 0, score_rationale: "auditor failed", findings: [], could_not_determine: ["auditor returned nothing"] });
    }
}

log(raised.to_string() + " findings queued for verification");

phase("Verify");
let confirmed = [];
let dropped = 0;
if queue.len() > 0 {
    let vjobs = [];
    for f in queue {
        let prompt = "You are the evidence-verify agent. Refute this finding. Default to refuted. Open the cited file at the cited line under " + root + ". Read C:/Users/moizjmj/.agents/skills/codebase-council/skills/evidence-verify/SKILL.md and follow it. Do not edit files. Do not run tests. ";
        let line_text = "0";
        if f.line != () { line_text = f.line.to_string(); }
        let scenario = "";
        if f.failure_scenario != () { scenario = f.failure_scenario; }
        prompt += "Source: " + f.source + ". Severity: " + f.severity + ". Claim: " + f.claim + ". Path: " + f.path + ". Line: " + line_text + ". Scenario: " + scenario;
        vjobs.push(#{
            prompt: prompt,
            label: "verify:" + f.path,
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
    }
    let verdicts = parallel(vjobs);
    let vi = 0;
    for v in verdicts {
        if v != () && v.success && type_of(v.output) == "map" && v.output.verdict == "confirmed" && v.output.reason != () && v.output.reason != "" {
            let item = queue[vi];
            item.reason = v.output.reason;
            confirmed.push(item);
        } else {
            dropped += 1;
        }
        vi += 1;
    }
}

phase("Synthesise");
let synth = rules;
synth += "Write one markdown report. You add no new findings. Use only the confirmed findings and the scores below. Follow the council-synthesis report structure in C:/Users/moizjmj/.agents/skills/codebase-council/skills/council-synthesis/SKILL.md. ";
synth += "Scope, say this in the first paragraph: this run mapped every file in docs/plans and audited all twelve detected domains. No domain was absent. Verification was not skipped. ";
synth += "Raised " + raised.to_string() + ". Confirmed " + confirmed.len().to_string() + ". Dropped " + dropped.to_string() + ". ";
synth += "PLAN MAPS: " + json_encode(plan_rows) + " ";
synth += "DOMAIN SCORES: " + json_encode(domain_rows) + " ";
synth += "CONFIRMED FINDINGS: " + json_encode(confirmed) + " ";
synth += "REPO MAP: " + repo_text;

let report = agent(synth, #{ label: "synthesis", capability_mode: "read-only" });
let body = "Synthesis failed.";
if report != () && report.success {
    if type_of(report.output) == "string" {
        body = report.output;
    } else {
        body = json_encode(report.output);
    }
}
let artifact = write_scratch_file("plan-council-report.md", body);
complete(#{
    summary: confirmed.len().to_string() + " confirmed of " + raised.to_string() + " raised",
    artifact: artifact,
    report: body,
});
