# Agent run evidence

Each directory holds the artifacts of one run of the `unit-test-engineer` agent: the four local sweeps and the CI runs on the example pull requests. Workflow artifacts expire after 1–7 days, so they are kept here. A commit made from a run carries a `Unit-Test-Agent:` trailer that points back here or to the workflow run.

| File | Produced by | Content |
|---|---|---|
| `plan.json` | `scripts/agent/plan.ts` | targets, owner and related tests, flags, model routing |
| `agent-result.json` | the agent (schema-validated) | per-target decision, behaviours, reasons, findings, skills used (self-reported) |
| `metrics.json` | `scripts/agent/run-agent.ts` | model, turns, cost, duration, permission denials, attempts |
| `verdict.json` | `scripts/agent/verify.ts` | guard result, baseline vs patched suites, stability, coverage per target |

## Sweep of the existing code (local runs, Claude Code subscription, `claude-sonnet-5-5` high)

| Batch | PR | Targets | Result |
|---|---|---|---|
| [backend-http](2026-10-23-sweep-backend-http) | [#15](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/15) | `factory.ts`, `router.ts` | `factory.ts` 0 → 100 % lines and branches; `router.ts` 44 → 100 % lines, 17 → 100 % branches; 24 turns |
| [backend-core](2026-10-23-sweep-backend-core) | [#17](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/17) | `config.ts`, `database.ts`, `lifespan.ts`, `main.ts` | all 100 % lines and branches; 22 turns |
| [frontend-data](2026-10-23-sweep-frontend-data) | [#16](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/16) | `lib/http.ts`, `api/todos.ts`, `utils/todos.ts`, `useNotice.ts`, five React Query hooks and `useTodoFilters` | all 100 % lines; two suspected bugs in `http.ts` reported (fixed in [#23](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/23)); 44 turns |
| [frontend-ui](2026-10-23-sweep-frontend-ui) | [#18](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/18) | `AppProviders`, six todo components and the page | all 100 % lines; no human assertion changed; 54 turns |

## Pull-request runs in CI

| PR | Run | Evidence | Tier / model | Outcome |
|---|---|---|---|---|
| [#13](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/13) health 503 | [39956721272](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39956721272) | [pr-13](2026-10-23-pr-13) | S → M (escalated) | created `health.test.ts`; applied |
| [#14](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/14) id validation | [39958778672](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39958778672) | [pr-14](2026-10-23-pr-14) | S → M | updated `validators.test.ts`; applied |
| [#19](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/19) clear completed | [39961739657](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39961739657) | [pr-19](2026-10-23-pr-19) | L, Sonnet high | 7 test files, $0.40; applied, `ci-ok` red → green |
| [#20](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/20) red-team | [39962736215](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39962736215) | [pr-20](2026-10-23-pr-20) | S, Haiku | injection reported and ignored, $0.009 |
| [#23](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/23) `http.ts` fixes | [39967561113](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39967561113) | [pr-23](2026-10-23-pr-23) | S, Haiku | first run of the hardened workflow (prepare job); updated `http.test.ts`, 2 changed expectations reported, $0.01 |

Runs on #13 and #14 happened while the CI sandbox was still being configured. The agent could not execute tests in its own sandbox and said so (`local_result: not_run`), and verification still accepted the tests independently. From #19 on, the agent runs its tests and the type check in the sandbox itself (`local_result: passed`).
