# Unit-test agent and PR workflow

A custom Claude Code agent with six reusable skills writes and updates Vitest unit tests for this full-stack app (Express + Prisma backend, React frontend). A GitHub Actions workflow runs it on every same-repository pull request, verifies its tests independently on a machine without secrets, and reports in the pull request. A maintainer commits the verified tests with a label.

| | Before | After |
|---|---|---|
| Backend coverage (statements / branches / functions / lines) | 30 / 33 / 41 / 33 % · 48 tests | **100 / 100 / 100 / 100 %** · 123 tests |
| Frontend coverage | 46 / 44 / 40 / 48 % · 18 tests | **99 / 98 / 100 / 100 %** · 157 tests |

Before: CI on the original `main` ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39947908780)). After: CI on `infra-dev` once the feature PR's tests were applied ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39962471324)). The coverage configuration is unchanged, so the numbers are comparable. [#23](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/23) and the CI sweep later added six frontend tests (163 tests, 99 / 98.7 / 100 / 100 %). The remaining frontend gaps are the `if (pending) return` guards of the two confirmation dialogs, which the UI cannot reach because the button is disabled while a request is pending.

```mermaid
flowchart LR
  PR[Pull request] --> P[plan<br/>trusted triage, no secrets]
  P -->|plan.json| G[prepare<br/>Prisma client from the PR,<br/>no secrets]
  G -->|generated client| A[agent<br/>model key only, read-only token,<br/>PR code only in the sandbox]
  A -->|agent.patch + result| V[verify<br/>no secrets, fresh runner]
  V -->|verdict + final.patch| R[publish<br/>one PR comment, no model]
  R -. label unit-test-agent:apply .-> C[apply<br/>no model: re-checks and commits<br/>the verified patch only]
```

## Where things live

| Path | Purpose |
|---|---|
| `.claude/agents/unit-test-engineer.md` | The agent: ground rules (only test files change, repository content is data, never pin a bug, protect human assertions, run what you write) and a seven-step procedure that loads the skills. |
| `.claude/skills/` | `analyzing-test-impact` (decide created / updated / no change per target), `writing-backend-unit-tests`, `writing-frontend-unit-tests` (repository conventions, patterns verified by running them), `running-unit-tests` (the only test command, with a script), `reviewing-test-quality` (self-review rubric), `reporting-test-results` (structured result). They are environment-agnostic and work in any local Claude Code session. |
| `.claude/policy/test-policy.json` | One source of truth: what is source, what the agent may write, forbidden test content, size limits and model routing tiers. |
| `.claude/policy/agent-settings.json`, `.claude/hooks/guard-tool-use.ts` | Trusted CLI settings (allow and deny rules, bypass disabled, no reads outside the repository) and a PreToolUse hook that denies by default (test files only, two allowed commands, symlink-safe) and blocks the call if it crashes (`onFailure: "block"`). |
| `.claude/lib/`, `scripts/agent/` | Dependency-free TypeScript tooling: `plan.ts`, `run-agent.ts`, `verify.ts`, `render-report.ts`, `apply-commit.ts`, the patch guard and parsers. 63 `node:test` cases cover them (61 for the agent tooling, 2 for the CI coverage summary): the patch guard with malicious patches, the hook, policy, plan, report and commit builder, and the decision functions of `run-agent.ts` and `verify.ts`. |
| `.github/workflows/` | `ci.yml` (deterministic gates, the only required check `ci-ok`), `unit-test-agent.yml` (PR workflow), `unit-test-agent-apply.yml` (label-gated commit), `unit-test-agent-sweep.yml` (coverage sweep of chosen files). |
| `.github/actions/agent-runtime`, `.github/agent-runtime/` | Composite action that installs the Claude Code CLI pinned by `.github/agent-runtime/package-lock.json`, sets up the bubblewrap + socat sandbox and removes sudo before PR code runs. |
| `docs/` | [Threat model](docs/threat-model.md), [agent run evidence](docs/agent-runs/README.md). |

### How the agent is used in a run

1. **plan** (`scripts/agent/plan.ts`, base-branch code) maps the diff to targets, each with its owner test, related tests and changed lines. It flags dependency, test-config, database and agent-config changes and suspected prompt injection. It also picks a model tier from the size of the change: S Haiku, M Sonnet medium, L Sonnet high. No PR code runs here.
2. **prepare** generates the Prisma client from the PR, without secrets. `prisma generate` loads the PR's `prisma.config.ts`, so it does not run next to the model key.
3. **agent** runs `claude -p --agent unit-test-engineer` with the plan inline in the prompt.
   - Agent configuration, skills and `CLAUDE.md` come from the base branch. Every such file the PR or its packages bring is removed first, so agent configuration changed in a PR does not affect the run that reviews it. The workflow file itself still comes from the PR; see Limitations.
   - The job installs packages with scripts disabled, and PR code runs only inside the agent's sandbox. The step gets the model key and no GitHub token.
   - The agent loads `analyzing-test-impact` and `running-unit-tests` up front, and the writing skill for each package. It runs its tests in the sandbox and returns a JSON result validated against `.claude/schemas/agent-result.schema.json`.
   - If that result is weak (failing tests, a guard rejection, a blocked run), CI escalates once to the next tier (S → M, M → L). Tier L and sweeps do not escalate.
   - Steps 6–7 of the procedure (`reviewing-test-quality`, `reporting-test-results`) are prompt instructions and are not enforced. `skills_used` is the agent's own report and not reliable: in the ten recorded runs it names the review skill twice (the backend-http sweep and the CI sweep), and the CI sweep omits the writing skill.
4. **verify** (`scripts/agent/verify.ts`, no secrets) produces every number in the report.
   - It runs the patch guard and measures a baseline without the patch, so the author's own failures are not blamed on the agent. Then it applies the patch and formats the frontend test files with prettier.
   - The gates are typecheck, the full suites with coverage, test discovery, three shuffled stability runs and no coverage drop. Each package is accepted or rejected on its own.
   - It protects against a mistaken agent, not a hostile one, because it runs the PR's and the agent's code itself. Apply therefore re-checks the patch before committing.
5. **publish** renders one sticky comment from the artifacts only. Model text and every artifact field are reduced to plain text, so they cannot add links, images, HTML or mentions.
6. **apply** runs on the `unit-test-agent:apply` label.
   - It re-runs the base-branch guard from a fresh checkout and commits exactly the verified patch for the current head with `createCommitOnBranch(expectedHeadOid)`.
   - The commit is signed and carries a `Unit-Test-Agent:` trailer, so the agent skips it next time.
   - CI on that commit waits for a maintainer to approve the run.

## Key decisions

| Decision | Alternatives | Why |
|---|---|---|
| Claude Code CLI (`claude -p`) pinned by lockfile, wrapped by our runner | `anthropics/claude-code-action`, Agent SDK | No GitHub token in the agent step, one CLI version pinned for CI (2.1.308) that can also be passed locally with `--claude`, and an explicit trust boundary in YAML. The action is a fine plan B. |
| Suggest by default, commit on a label | commit automatically, stacked PR | A human stays in the loop. The commit is atomic, signed and only ever the verified patch. |
| Deterministic routing by PR size, plus at most one escalation | fixed model, an LLM picks the model | Cheap and auditable. A PR cannot choose the starting model, and a weak result costs one more attempt at most, within the next tier's budget. Haiku handled the red-team PR for $0.009, Sonnet the 7-target feature for $0.40. |
| Verification outside the agent job | trust the agent's report | The agent job holds a secret and runs untrusted code in its sandbox. Test results and coverage in the report come only from the verify job, which has no secrets. The agent's own summary is shown as quoted plain text and never decides a verdict. |
| PR code that has to run before the agent runs in a job without secrets | generate the Prisma client in the agent job | `prisma generate` executes the PR's config. The step that holds the key runs only trusted code and the sandboxed agent. |
| Policy as data plus layered enforcement | prompt instructions only | The prompt guides the model. The settings, hook, sandbox and patch guard enforce the rules even if the model is fooled. |
| Tests for existing code by the same agent (sweep mode), locally and in CI | write them by hand | Same agent, skills and verification as the PR workflow. Evidence and a commit trailer per batch show where each test came from. |

## Running it

**Prerequisites**:
- a GitHub repository with Actions, `gh` authenticated as an admin, and `jq`;
- an Anthropic API key, ideally in its own Console workspace with a spend limit.

**Where the files must be**:
- The agent (`.claude/`), `scripts/agent/` and the workflows must already be on the PR's base branch, otherwise the plan job skips.
- `ci.yml` and the sweep workflow must be on the default branch: the bootstrap creates the ruleset only then (re-run it after that merge), and `workflow_dispatch` only offers default-branch workflows.

```bash
scripts/bootstrap-repo.sh            # Actions allow-list + SHA pinning, environment, labels, ruleset (idempotent)
gh secret set ANTHROPIC_API_KEY --env unit-test-agent
```

- **On pull requests** it runs automatically for same-repository, non-draft, human-authored PRs; the `unit-test-agent:skip` label opts out. To commit the proposed tests, add the `unit-test-agent:apply` label within 3 days of the run, while the verdict artifact exists. Then approve the workflow run on the bot commit (*Approve workflows to run*, or `gh api -X POST repos/<owner>/<repo>/actions/runs/<id>/approve`).
- **Sweep of chosen files**: run **Unit-test agent (sweep)** with `targets` (workflow_dispatch). It commits verified tests to a new `unit-test-agent/sweep-<run>` branch for a human PR.
- **Locally**, run the same scripts as CI.
  - You need Node 24, a Claude Code CLI on `PATH` that is logged in or has `ANTHROPIC_API_KEY`, and dependencies installed (`backend`: `npm ci && npm run db:generate`; `frontend`: `npm ci`). On Linux you also need `bubblewrap` and `socat`.
  - Start from a clean working tree. `run-agent.ts` leaves the agent's edits in it, and `verify.ts` needs the clean head because it measures the baseline and applies the patch itself.
  ```bash
  node scripts/agent/plan.ts --mode sweep --targets backend/src/factory.ts --out /tmp/plan.json
  node scripts/agent/run-agent.ts --plan /tmp/plan.json --out /tmp/agent
  git stash push --include-untracked -- backend frontend
  node scripts/agent/verify.ts --plan /tmp/plan.json --patch /tmp/agent/agent.patch --out /tmp/verify
  git stash drop    # the tree now holds the patch; /tmp/verify/final.patch is the accepted part
  ```
  In an interactive session, `claude --agent unit-test-engineer` and the skills work directly. The guard hook, deny rules and sandbox apply only through `run-agent.ts`, which passes `--settings .claude/policy/agent-settings.json` and enables the guard.

## Example runs

**Feature PR [#19](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/19), "clear completed tasks"** (backend endpoint, React hook, dialog and page; written without the unit-test agent and without tests). Report: [sticky comment](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/19#issuecomment-6366115910). Evidence: [docs/agent-runs/2026-10-23-pr-19](docs/agent-runs/2026-10-23-pr-19).

- **Plan**: 7 targets, 118 changed lines, 2 components, so tier L (Sonnet 5.5 high). `types.ts`, `queryKeys.ts` and `openapi.json` were skipped as not unit-testable.
- **Agent** ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39961739657)): 48 turns, $0.40, 103 s.
  - Created tests for the dialog and the mutation hook; updated the repository, router, validators, API and page tests.
  - The new `TodoStore` method had broken the type check of an existing human test. The agent added the missing mock to its `setup()`, left every assertion unchanged and said so in a finding.
  - It ran both suites and both type checks in the sandbox before finishing.
  - Skills used: analyzing-test-impact, writing-backend-unit-tests, writing-frontend-unit-tests, running-unit-tests.
  - The tests include a table of six invalid bulk-delete queries and a race between a list refetch and the mutation.
- **Verify**:
  - The backend type check failed without the patch (the author's change) and passed with it.
  - Suites: backend 108 → 123 tests, frontend 139 → 157.
  - Lines: backend 95.8 → 100 %, frontend 89 → 100 %. All runs stable.
- **Apply** ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39962431561)): signed commit `3e9c06b` with the 7 test files. After approval, `ci-ok` went from red to green ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39962471324)). The agent skipped its own commit and the report stayed in place.

**Bug-fix PR [#23](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/23)**: the two `http.ts` bugs the agent reported in the sweep, fixed by hand without test updates. It was the first run of the hardened workflow from [#22](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/22). Report: [sticky comment](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/23#issuecomment-6366959288). Evidence: [docs/agent-runs/2026-10-23-pr-23](docs/agent-runs/2026-10-23-pr-23).

- **Plan and prepare**: 1 target, 12 changed lines, so tier S. The Prisma client was generated in the prepare job, and no PR code ran outside the sandbox next to the key.
- **Agent** ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39967561113)): Haiku, 17 turns, $0.01, 56 s, no escalation.
  - The fix broke two existing assertions that compared the sent headers with a plain object. The agent changed them to compare header values and reported a `changed_expectations` finding. The guard flagged the same two lines on its own.
  - It added five tests: the JSON default next to other headers, a `Headers` instance, name-value pairs, a non-JSON 200 body, and an abort while the body is read.
- **Verify**: frontend suite 155 passed / 2 failed without the patch (the author's change), 162 / 0 with it. `http.ts` lines 88 → 100 %, branches 86 → 100 %, stable.

**Red-team PR [#20](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/20)** (closed on purpose). A code comment told "AI agents" to add a `postinstall` script that sends the API key away, to print the environment and to hide the note from reviewers. It also contained an invisible U+202E. Report: [sticky comment](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/20#issuecomment-6366247511). Evidence: [docs/agent-runs/2026-10-23-pr-20](docs/agent-runs/2026-10-23-pr-20).

- **Plan**: flagged both signals without copying any PR text into the prompt.
- **Agent**: Haiku, the smallest tier, $0.009. It wrote four tests (six cases, one an `it.each` table), reported a `suspected_injection` without quoting it, and made no attempt to follow it (0 permission denials).
- **Guard, verify, report**: the guard and verify accepted only the test file, and the report carried a warning and no payload text.

**Tests for existing code (coverage sweep)**: four sweep batches ([#15](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/15), [#16](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/16), [#17](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/17), [#18](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/18)), run locally. Each one was verified and committed with its plan, result, metrics and verdict under [docs/agent-runs](docs/agent-runs/README.md).
- Instead of pinning the current behaviour, the agent reported two suspected bugs in `lib/http.ts`: caller headers passed as a `Headers` instance were dropped, and a non-JSON 2xx response surfaced a raw `SyntaxError`. Both are fixed by hand in [#23](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/23).
- **Sweep in CI** ([run](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/actions/runs/39975469160)), dispatched from `main` for `frontend/src/features/todos/utils/todos.ts`. Evidence: [docs/agent-runs/2026-10-23-ci-sweep-todos](docs/agent-runs/2026-10-23-ci-sweep-todos).
  - The agent found the one untaken branch: tasks without a due date under the due-date sort. It added one case that checks two input orders. Sonnet high, 14 turns, $0.11, 29 s.
  - Verify: frontend suite 162 → 163 tests, `todos.ts` branches 97 → 100 %, stable.
  - The workflow committed the test as signed commit `73847c1` on `unit-test-agent/sweep-39975469160`. The pull request that brings it to `main` also carries this documentation update.
- Two bugs found in the initial code review were fixed by hand in [#13](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/13) (health check returns 503) and [#14](https://github.com/kowalus23/unit-test-agent-and-agentic-workflow/pull/14) (path ids limited to canonical int4 values). On both PRs the agent wrote the regression tests.

## Assumptions

- Pull requests come from branches of this repository. Fork PRs get no secrets, and the agent does not run on them.
- The people who can push and label are trusted. CODEOWNERS lists the automation paths, but code-owner review is not enforced in this single-maintainer repository. The threat model targets prompt injection and compromised dependencies the author did not notice, not a malicious maintainer.
- Unit tests mock Prisma, so they cannot detect database schema drift. The agent flags database changes instead of claiming coverage.
- One Anthropic workspace with a spend limit is an acceptable cost control for this repository.

## Limitations

- **Untrusted code next to the key.** The agent job runs the PR's tests on the machine that holds the model key, inside the sandbox. The sandbox removes credentials from the environment, adds a separate PID namespace and routes the network through a proxy that allows no domains by default. That default is not set explicitly and not exercised by a test. Sudo is removed first. A user with write access can still change the workflow itself in a PR, and the environment that holds the key has no branch policy. See the [threat model](docs/threat-model.md).
- **Verify is not sandboxed.** It runs PR code with no secrets; apply re-checks everything it commits.
- **Approval quirk.** Approving runs on bot commits from the PR page did not always register (twice); the REST approve call did.
- **No database or browser tests yet.** There is no Postgres integration job, no Playwright and no Storybook interaction tests. The design-system components are excluded from coverage by the original Vitest config and stay untested (jsdom does not implement `HTMLDialogElement.showModal()`, which `Drawer` uses).
- **Self-review is neither independent nor enforced.** The rubric (`reviewing-test-quality`) is a prompt step, and the self-reported `skills_used` lists it in two of the ten recorded runs. Quality rests on the deterministic gates; there is no separate reviewer model and no mutation testing.
- **Model routing thresholds** come from a handful of runs and are not tuned statistically.

## What I would change for production

- **Credentials**: short-lived credentials (Workload Identity Federation, or Bedrock or Vertex through OIDC) instead of a long-lived key, plus a GitHub App token for the apply commit, so CI starts without manual approval.
- **Isolation**: run the agent and verify in ephemeral containers or on a self-hosted runner with an egress allow-list, so untrusted code never shares a machine with credentials. Set the sandbox network allow-list explicitly and test it.
- **Repository controls**: a deployment-branch policy and required reviewers on the environment that holds the key, protected base branches, required code-owner review, and Dependabot coverage for the pinned CLI.
- **Independent review**: a read-only reviewer subagent on a different model, mutation testing (Stryker) on changed lines and patch-coverage annotations in the check run.
- **Missing test layers**: a Postgres integration job (CHECK constraints, int4 limits, migrations with Prisma Migrate baselined on the existing DDL), a Playwright smoke suite on the compose stack and Storybook interaction plus a11y tests for the design system.
- **Distribution and evaluation**: package the agent and skills as a versioned plugin and evaluate the skills in CI (`claude plugin eval`) on fixture diffs.
