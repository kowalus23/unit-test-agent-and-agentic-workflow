#!/usr/bin/env bash
# Applies the repository settings this project relies on. Idempotent: safe to re-run.
#
# Usage: scripts/bootstrap-repo.sh [--repo owner/name] [--dry-run]
# Requires: gh (authenticated as a repository admin), jq.
#
# Run it once .github/workflows/ci.yml is on the default branch: the ruleset
# requires the `ci-ok` check, so creating it earlier would leave open PRs
# without CI unmergeable. The script skips the ruleset until then.
#
# The model API key is NOT set here. Add it yourself as the environment secret
# ANTHROPIC_API_KEY in the `unit-test-agent` environment (command printed at the end).
set -euo pipefail

REPO=""
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

# Third-party actions allowed in addition to GitHub-owned ones (always pinned by SHA).
ALLOWED_ACTION_PATTERNS='[]'
# Status check required on the default branch (job name in .github/workflows/ci.yml).
REQUIRED_CHECK="ci-ok"
GITHUB_ACTIONS_APP_ID=15368
AGENT_ENVIRONMENT="unit-test-agent"

api() {
  local method="$1" path="$2" body="${3:-}"
  if $DRY_RUN; then
    echo "[dry-run] gh api -X $method $path ${body:+<<< $(jq -c . <<< "$body")}"
    return 0
  fi
  if [[ -n "$body" ]]; then
    gh api -X "$method" "$path" --input - <<< "$body" > /dev/null
  else
    gh api -X "$method" "$path" > /dev/null
  fi
}

step() { printf '\n==> %s\n' "$1"; }

step "Actions: only GitHub-owned (+ allow-listed) actions, full-SHA pinning required"
api PUT "repos/$REPO/actions/permissions" \
  '{"enabled": true, "allowed_actions": "selected", "sha_pinning_required": true}'
api PUT "repos/$REPO/actions/permissions/selected-actions" \
  "$(jq -n --argjson patterns "$ALLOWED_ACTION_PATTERNS" \
    '{github_owned_allowed: true, verified_allowed: false, patterns_allowed: $patterns}')"

step "Actions: read-only GITHUB_TOKEN by default, workflows cannot approve or create PRs"
api PUT "repos/$REPO/actions/permissions/workflow" \
  '{"default_workflow_permissions": "read", "can_approve_pull_request_reviews": false}'

step "Actions: require approval for workflow runs from all external contributors"
api PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  '{"approval_policy": "all_external_contributors"}'

step "Security: vulnerability alerts, Dependabot security updates, secret scanning + push protection"
api PUT "repos/$REPO/vulnerability-alerts"
api PUT "repos/$REPO/automated-security-fixes"
api PATCH "repos/$REPO" \
  '{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}'

step "Merge settings consistent with the ruleset (no rebase merges, delete merged branches)"
api PATCH "repos/$REPO" '{"allow_rebase_merge": false, "delete_branch_on_merge": true}'

step "Environment '$AGENT_ENVIRONMENT' (holds the model API key)"
# Deployment branch policy is not restricted yet: the agent workflow runs on
# pull_request (ref refs/pull/<n>/merge), and narrowing the environment to those
# refs is validated together with that workflow. Protection rules added in the UI
# (required reviewers, wait timer) are preserved on re-runs.
if ! current_env="$(gh api "repos/$REPO/environments/$AGENT_ENVIRONMENT" 2>/dev/null)"; then
  current_env='{}'
fi
api PUT "repos/$REPO/environments/$AGENT_ENVIRONMENT" "$(jq '
  (.protection_rules // []) as $rules
  | ($rules | map(select(.type == "required_reviewers")) | first) as $reviewers
  | ($rules | map(select(.type == "wait_timer")) | first) as $timer
  | { deployment_branch_policy: .deployment_branch_policy }
  + (if $reviewers then {
        reviewers: ($reviewers.reviewers | map({ type, id: .reviewer.id })),
        prevent_self_review: $reviewers.prevent_self_review
      } else {} end)
  + (if $timer then { wait_timer: $timer.wait_timer } else {} end)
' <<< "$current_env")"

step "Labels used by the unit-test agent workflow"
label() {
  if $DRY_RUN; then echo "[dry-run] gh label create $1"; return 0; fi
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force > /dev/null
}
label "unit-test-agent:apply" "0e8a16" "Commit the tests verified by the unit-test agent to this PR"
label "unit-test-agent:skip" "cfd3d7" "Do not run the unit-test agent on this PR"

step "Ruleset on the default branch: PRs only, '$REQUIRED_CHECK' must pass, no force-push or deletion"
ruleset="$(jq -n --arg check "$REQUIRED_CHECK" --argjson app "$GITHUB_ACTIONS_APP_ID" '{
  name: "default-branch",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  bypass_actors: [],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["merge", "squash"] } },
    { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [{ context: $check, integration_id: $app }] } }
  ]
}')"
if ! gh api "repos/$REPO/contents/.github/workflows/ci.yml" > /dev/null 2>&1; then
  echo "Skipped: .github/workflows/ci.yml is not on the default branch yet, so '$REQUIRED_CHECK' cannot be reported."
  echo "Merge the CI pull request first, then re-run this script."
else
  existing_id="$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name == "default-branch") | .id')"
  if [[ -n "$existing_id" ]]; then
    api PUT "repos/$REPO/rulesets/$existing_id" "$ruleset"
  else
    api POST "repos/$REPO/rulesets" "$ruleset"
  fi
fi

printf '\nDone. Remaining manual step: add the ANTHROPIC_API_KEY secret to the "%s" environment:\n' "$AGENT_ENVIRONMENT"
printf '  gh secret set ANTHROPIC_API_KEY --repo %s --env %s\n' "$REPO" "$AGENT_ENVIRONMENT"
