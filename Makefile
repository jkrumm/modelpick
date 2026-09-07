.PHONY: dev build db-push db-seed refresh-setup refresh-check refresh-teardown

# Local-only app: a single SQLite file (modelpick.db, gitignored). No docker.

# The daily refresh (bun run refresh: probe → collect → recommend) as a mini
# LaunchAgent. Template rendered with the repo path and $HOME; launchd starts
# the job with no shell profile, so the plist pins PATH to reach bun and the
# secrets-run shim (cache backend, no biometric needed). Logs in
# ~/Library/Logs, never /tmp (dotfiles CLAUDE.md, "Odds and ends").
REFRESH_LABEL := com.jkrumm.modelpick-refresh
REFRESH_PLIST := $(HOME)/Library/LaunchAgents/$(REFRESH_LABEL).plist
REFRESH_TMPL  := launchd/$(REFRESH_LABEL).plist.template

# Create/sync the SQLite schema from src/db/schema.ts, then seed it.
db-push:
	bun run db:push

db-seed:
	bun run db:seed

dev:
	bun run dev

build:
	bun run build

refresh-setup: ## Install + load the 06:00 daily refresh LaunchAgent (mini only)
	@test "$$(cat ~/.config/secrets/backend 2>/dev/null)" = cache || { echo "refresh-setup: dev host only (secrets backend is not 'cache')"; exit 1; }
	@mkdir -p "$(HOME)/Library/LaunchAgents" "$(HOME)/Library/Logs"
	@sed -e 's|__HOME__|$(HOME)|g' -e 's|__REPO__|$(CURDIR)|g' "$(REFRESH_TMPL)" > "$(REFRESH_PLIST)"
	@plutil -lint "$(REFRESH_PLIST)" >/dev/null
	@launchctl bootout "gui/$$(id -u)/$(REFRESH_LABEL)" 2>/dev/null || true
	@launchctl bootstrap "gui/$$(id -u)" "$(REFRESH_PLIST)"
	@echo "✓ $(REFRESH_LABEL) loaded — 06:00 daily; logs ~/Library/Logs/modelpick-refresh.{log,err}"
	@echo "  run once now: launchctl kickstart gui/$$(id -u)/$(REFRESH_LABEL)"

refresh-check: ## Is the daily refresh agent loaded, and how did its last run end
	@launchctl print "gui/$$(id -u)/$(REFRESH_LABEL)" 2>/dev/null | grep -E 'state =|last exit code|pid =' || { echo "✗ $(REFRESH_LABEL) not loaded — make refresh-setup"; exit 1; }
	@tail -n 3 "$(HOME)/Library/Logs/modelpick-refresh.log" 2>/dev/null || true

refresh-teardown: ## Unload + remove the daily refresh LaunchAgent (logs kept)
	@launchctl bootout "gui/$$(id -u)/$(REFRESH_LABEL)" 2>/dev/null || true
	@rm -f "$(REFRESH_PLIST)"
	@echo "✓ $(REFRESH_LABEL) removed"
