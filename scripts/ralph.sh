#!/usr/bin/env bash
# modelpick — RALPH Loop Runner
#
# Usage:
#   ./scripts/ralph.sh              # Run all pending groups
#   ./scripts/ralph.sh 3            # Run only group 3
#   ./scripts/ralph.sh --reset 3    # Reset group 3 to pending, then run
#   ./scripts/ralph.sh --status     # Print status and exit
#
# Logs: .ralph-logs/group-N.log  (watch: tail -f .ralph-logs/group-N.log)
# Secrets: sourced from .env (gitignored) at startup so claude -p children inherit them.
#
# Prerequisites: brew install coreutils (gtimeout); claude CLI in PATH; bun in PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/ralph"
PROMPTS_DIR="$DOCS_DIR/prompts"
STATE_FILE="$REPO_ROOT/.ralph-tasks.json"
LOGS_DIR="$REPO_ROOT/.ralph-logs"
REPORT_FILE="$DOCS_DIR/RALPH_REPORT.md"
ENV_FILE="$REPO_ROOT/.env"

MAX_RETRIES=3
CLAUDE_TIMEOUT=2700  # 45 minutes per group

# Model + transport (override via env, e.g. RALPH_TRANSPORT=bridge ./scripts/ralph.sh).
#   max    → sonnet on Max subscription. Best quality + keeps WebSearch/WebFetch
#            (several groups research TanStack Start / Mantine / visx / external APIs).
#   bridge → Kimi-K2.6 via local LiteLLM bridge, zero Max quota, but NO web tools.
RALPH_MODEL="${RALPH_MODEL:-sonnet}"
RALPH_EFFORT="${RALPH_EFFORT:-high}"
RALPH_TRANSPORT="${RALPH_TRANSPORT:-max}"
LITELLM_BRIDGE_URL="${LITELLM_BRIDGE_URL:-http://127.0.0.1:4000}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

TOTAL_GROUPS=11

GROUP_TITLES=(
  ""  # 1-indexed
  "Scaffold & foundation"
  "Strictness baseline"
  "DB layer (Drizzle + schema)"
  "IU capability probe"
  "External collectors (OpenRouter + artificialanalysis)"
  "Scoring + recommender"
  "visx chart primitives (from Argo)"
  "Decider + catalog UI"
  "Audio playground"
  "Daily refresh + news"
  "Deploy artifacts"
)

log_info()    { echo -e "${BLUE}[ralph]${NC} $*"; }
log_success() { echo -e "${GREEN}[ralph]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[ralph]${NC} $*"; }
log_error()   { echo -e "${RED}[ralph]${NC} $*"; }

require_commands() {
  local missing=0
  for cmd in claude gtimeout python3 bun; do
    if ! command -v "$cmd" &>/dev/null; then log_error "$cmd not found."; missing=1; fi
  done
  [[ $missing -eq 0 ]] || { echo "Install: brew install coreutils (gtimeout); bun.sh; claude CLI"; exit 1; }
}

# ── Pre-flight: env, branch, signing, push guard ──────────────────────────────

source_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a; # shellcheck disable=SC1090
    source "$ENV_FILE"; set +a
    log_success "Sourced .env into runner env (children inherit IU/DB/API keys)."
  else
    log_warn ".env not found — groups needing secrets will fail. Copy .env.example and fill."
  fi
}

refuse_default_branch() {
  cd "$REPO_ROOT"
  local current; current="$(git rev-parse --abbrev-ref HEAD)"
  case "$current" in
    master|main)
      log_error "Refusing to run on '$current' — autonomous commits to the default branch are unsafe."
      log_error "Switch to a build branch first: git checkout -b build/v1"
      exit 1 ;;
  esac
  log_info "Running on branch: $current"
}

ORIG_GPGSIGN=""; GPGSIGN_TOUCHED=false
disable_commit_signing() {
  cd "$REPO_ROOT"
  ORIG_GPGSIGN="$(git config --local --get commit.gpgsign || echo '__unset__')"
  local effective; effective="$(git config --get commit.gpgsign || echo 'false')"
  if [[ "$effective" == "true" ]]; then
    log_warn "commit.gpgsign=true — disabling for the loop (would block on Touch ID)."
    git config --local commit.gpgsign false; GPGSIGN_TOUCHED=true
  fi
}
restore_commit_signing() {
  $GPGSIGN_TOUCHED || return 0
  cd "$REPO_ROOT" 2>/dev/null || return 0
  if [[ "$ORIG_GPGSIGN" == "__unset__" ]]; then git config --local --unset commit.gpgsign 2>/dev/null || true
  else git config --local commit.gpgsign "$ORIG_GPGSIGN"; fi
  log_info "Restored commit.gpgsign (was: $ORIG_GPGSIGN)."
}

PUSH_GUARD_INSTALLED=false
install_push_guard() {
  cd "$REPO_ROOT"
  local hook; hook="$(git rev-parse --git-path hooks)/pre-push"
  [[ -f "$hook" ]] && mv "$hook" "${hook}.ralph-backup"
  cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
echo "[ralph] pre-push hook: autonomous push blocked." >&2
exit 1
HOOK
  chmod +x "$hook"; PUSH_GUARD_INSTALLED=true
}
remove_push_guard() {
  $PUSH_GUARD_INSTALLED || return 0
  cd "$REPO_ROOT" 2>/dev/null || return 0
  local hook; hook="$(git rev-parse --git-path hooks)/pre-push"
  rm -f "$hook"
  [[ -f "${hook}.ralph-backup" ]] && mv "${hook}.ralph-backup" "$hook"
}

cleanup_on_exit() { restore_commit_signing; remove_push_guard; }
trap cleanup_on_exit EXIT

# ── State management ──────────────────────────────────────────────────────────

init_state() {
  [[ -f "$STATE_FILE" ]] && { log_info "Resuming from existing state."; return; }
  log_info "Initializing task state..."
  python3 - <<PYEOF
import json
titles = [$(printf '"%s", ' "${GROUP_TITLES[@]:1}" | sed 's/, $//')]
groups = [{"id": i+1, "title": t, "status": "pending", "attempts": 0,
           "started_at": None, "completed_at": None} for i, t in enumerate(titles)]
state = {"groups": groups, "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
with open("$STATE_FILE", "w") as f: json.dump(state, f, indent=2)
print("State initialized.")
PYEOF
}

get_field() {
  python3 -c "
import json
with open('$STATE_FILE') as f: state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        print(g.get('$2', '')); break
"
}

set_field() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f: state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        val = '$3'
        if val in ('True','False','None'): val = {'True':True,'False':False,'None':None}[val]
        g['$2'] = val; break
with open('$STATE_FILE','w') as f: json.dump(state, f, indent=2)
PYEOF
}

inc_attempts() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f: state = json.load(f)
for g in state['groups']:
    if g['id'] == $1: g['attempts'] = g.get('attempts',0)+1; break
with open('$STATE_FILE','w') as f: json.dump(state, f, indent=2)
PYEOF
}

print_status() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f: state = json.load(f)
icons = {'complete':'✅','blocked':'🚫','pending':'⬜','in_progress':'🔄'}
total = len(state['groups']); done = sum(1 for g in state['groups'] if g['status']=='complete')
blocked = sum(1 for g in state['groups'] if g['status']=='blocked'); pending = total-done-blocked
print(f"  {total} groups | {done} complete | {pending} pending | {blocked} blocked"); print()
for g in state['groups']:
    icon = icons.get(g['status'],'⬜')
    attempts = f"  (attempt {g['attempts']})" if g['attempts']>0 else ""
    print(f"  {icon}  Group {g['id']}: {g['title']}{attempts}")
PYEOF
}

# ── Validation ────────────────────────────────────────────────────────────────

BUILD_TIMEOUT=600  # 10 min — a hung build must not stall the loop
validate() {
  local label=${1:-""}
  log_info "Validation${label:+ ($label)}..."
  cd "$REPO_ROOT"
  # CI=1 forces non-interactive mode (e.g. vitest never enters watch) regardless of stdin TTY.
  if ! CI=1 bun run typecheck 2>&1; then log_error "Typecheck failed"; return 1; fi
  if ! CI=1 bun run lint 2>&1; then log_error "Lint failed"; return 1; fi
  if ! CI=1 bun run test 2>&1; then log_error "Tests failed"; return 1; fi
  if ! CI=1 gtimeout "$BUILD_TIMEOUT" bun run build 2>&1; then log_error "Build failed (or timed out after ${BUILD_TIMEOUT}s)"; return 1; fi
  log_success "Validation passed"
  return 0
}

# ── Claude invocation ─────────────────────────────────────────────────────────

run_group() {
  local group_id=$1
  local prompt_file="$PROMPTS_DIR/group-$group_id.md"
  local context_file="$DOCS_DIR/shared-context.md"
  local log_file="$LOGS_DIR/group-$group_id.log"
  mkdir -p "$LOGS_DIR"
  [[ -f "$prompt_file" ]] || { log_error "Prompt not found: $prompt_file"; return 1; }

  local full_prompt
  full_prompt="$(cat "$context_file")"$'\n\n---\n\n'"$(cat "$prompt_file")"

  log_info "Claude running (model: $RALPH_MODEL, transport: $RALPH_TRANSPORT, timeout: ${CLAUDE_TIMEOUT}s) → .ralph-logs/group-$group_id.log"
  log_info "Watch live: tail -f .ralph-logs/group-$group_id.log"; echo ""

  local -a group_env=(CLAUDE_CODE_ENABLE_TASKS=true CLAUDECODE=)
  if [[ "$RALPH_TRANSPORT" == "bridge" ]]; then
    if ! curl -fsS -m 3 "${LITELLM_BRIDGE_URL}/health/liveliness" >/dev/null 2>&1; then
      log_error "RALPH_TRANSPORT=bridge but LiteLLM bridge unreachable at $LITELLM_BRIDGE_URL — run 'make litellm-restart' in dotfiles."
      return 1
    fi
    group_env+=(ANTHROPIC_BASE_URL="$LITELLM_BRIDGE_URL" ANTHROPIC_AUTH_TOKEN=sk-litellm-master-key CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1)
  fi

  local exit_code=0
  if env -u ANTHROPIC_API_KEY "${group_env[@]}" gtimeout "$CLAUDE_TIMEOUT" claude \
    -p "$full_prompt" --model "$RALPH_MODEL" --effort "$RALPH_EFFORT" \
    --dangerously-skip-permissions --output-format stream-json --verbose \
    --no-session-persistence < /dev/null > "$log_file" 2>&1; then exit_code=0; else exit_code=$?; fi

  grep -q "RALPH_TASK_COMPLETE: Group $group_id" "$log_file" && return 0
  grep -q "RALPH_TASK_BLOCKED: Group $group_id" "$log_file" && return 2
  [[ $exit_code -eq 124 ]] && { log_error "Timed out after ${CLAUDE_TIMEOUT}s"; return 1; }
  log_warn "Claude finished but no completion signal in log."
  return 1
}

# ── Report ────────────────────────────────────────────────────────────────────

generate_report() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f: state = json.load(f)
icons = {'complete':'✅','blocked':'🚫','pending':'⬜','in_progress':'🔄'}
total = len(state['groups']); done = sum(1 for g in state['groups'] if g['status']=='complete')
blocked = sum(1 for g in state['groups'] if g['status']=='blocked'); pending = total-done-blocked
lines = ["# RALPH Report","",f"Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)",
         f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked","","## Status",""]
for g in state['groups']:
    icon = icons.get(g['status'],'⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts']>0 else ""
    lines.append(f"- {icon} **Group {g['id']}**: {g['title']}{attempts}")
lines += ["","## Next Steps",""]
if done==total: lines += ["All groups complete.","","1. `git log --oneline -25`","2. Run full build + E2E","3. `/ship`"]
elif pending>0: lines.append("Run `./scripts/ralph.sh` to continue.")
with open('$REPORT_FILE','w') as f: f.write('\n'.join(lines)+'\n')
print(f"Report: $REPORT_FILE")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local target_group="" do_reset=false status_only=false
  while [[ $# -gt 0 ]]; do
    case $1 in
      --status) status_only=true; shift ;;
      --reset) do_reset=true; target_group="${2:?'--reset requires a group number'}"; shift 2 ;;
      [0-9]*) target_group="$1"; shift ;;
      *) echo "Unknown: $1"; echo "Usage: ralph.sh [group] [--reset group] [--status]"; exit 1 ;;
    esac
  done

  echo ""; echo -e "${BOLD}  RALPH Loop — modelpick${NC}"; echo ""
  require_commands
  cd "$REPO_ROOT"

  if $status_only; then [[ -f "$STATE_FILE" ]] && print_status || echo "  No state yet."; exit 0; fi

  source_env
  refuse_default_branch
  disable_commit_signing
  install_push_guard
  init_state

  if $do_reset; then
    log_info "Resetting Group $target_group to pending..."
    set_field "$target_group" "status" "pending"
    python3 - <<PYEOF
import json
with open('$STATE_FILE') as f: state = json.load(f)
for g in state['groups']:
    if g['id'] == $target_group: g['attempts']=0; break
with open('$STATE_FILE','w') as f: json.dump(state, f, indent=2)
PYEOF
  fi

  print_status; echo ""

  local groups_to_run=()
  if [[ -n "$target_group" ]]; then groups_to_run=("$target_group")
  else for i in $(seq 1 $TOTAL_GROUPS); do groups_to_run+=("$i"); done; fi

  for group_id in "${groups_to_run[@]}"; do
    local status; status=$(get_field "$group_id" "status")
    if [[ "$status" == "complete" ]]; then echo -e "  ✅  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (complete)"; continue; fi
    if [[ "$status" == "blocked" ]]; then echo -e "  🚫  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (blocked)"; continue; fi

    local attempts; attempts=$(get_field "$group_id" "attempts")
    if [[ "$attempts" -ge "$MAX_RETRIES" ]]; then log_warn "Group $group_id reached max retries. Marking blocked."; set_field "$group_id" "status" "blocked"; continue; fi

    echo ""; echo "  ────────────────────────────────────────────"
    echo -e "  ${BOLD}Group $group_id: ${GROUP_TITLES[$group_id]}${NC}"
    echo "  Attempt: $((attempts + 1)) / $MAX_RETRIES"
    echo "  ────────────────────────────────────────────"; echo ""

    if [[ "$group_id" -gt 1 ]]; then
      if ! validate "pre-group $group_id"; then log_error "Pre-group validation failed. Fix before continuing."; exit 1; fi
      echo ""
    fi

    set_field "$group_id" "status" "in_progress"
    set_field "$group_id" "started_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    inc_attempts "$group_id"

    run_result=0; run_group "$group_id" || run_result=$?; echo ""

    if [[ $run_result -eq 0 ]]; then
      log_success "Group $group_id complete."
      set_field "$group_id" "status" "complete"
      set_field "$group_id" "completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo ""
      if validate "post-group $group_id"; then log_success "Post-group validation passed ✓"
      else log_warn "Post-group validation FAILED. Review log; retry: ./scripts/ralph.sh --reset $group_id"; fi
    elif [[ $run_result -eq 2 ]]; then
      log_warn "Group $group_id blocked. See: .ralph-logs/group-$group_id.log"; set_field "$group_id" "status" "blocked"
    else
      log_error "Group $group_id failed (attempt $((attempts + 1)) / $MAX_RETRIES)"; set_field "$group_id" "status" "pending"
      log_info "Log: .ralph-logs/group-$group_id.log"
      new_attempts=$(get_field "$group_id" "attempts")
      if [[ "$new_attempts" -ge "$MAX_RETRIES" ]]; then set_field "$group_id" "status" "blocked"
      elif [[ -z "$target_group" ]]; then log_warn "Stopping. Fix Group $group_id before proceeding."; break; fi
    fi
    echo ""
  done

  echo ""; generate_report; echo ""
  echo -e "${BOLD}  RALPH loop done.${NC}"; echo ""; print_status; echo ""
}

main "$@"
