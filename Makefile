.PHONY: dev build db-push db-seed refresh-setup refresh-check refresh-teardown \
	web-setup web-check web-teardown web-restart

# Local-only app: a single SQLite file (modelpick.db, gitignored). No docker.

# The daily refresh (bun run refresh: probe → collect → recommend) as a mini
# LaunchAgent. Template rendered with the repo path and $HOME; launchd starts
# the job with no shell profile, so the plist pins PATH to reach bun and the
# secrets-run shim (cache backend, no biometric needed). Logs in
# ~/Library/Logs, never /tmp (dotfiles CLAUDE.md, "Odds and ends").
REFRESH_LABEL := com.jkrumm.modelpick-refresh
REFRESH_PLIST := $(HOME)/Library/LaunchAgents/$(REFRESH_LABEL).plist
REFRESH_TMPL  := launchd/$(REFRESH_LABEL).plist.template

# The always-on dashboard, same LaunchAgent mechanism. Not a Docker container:
# host-side writers (the refresh agent, `bun run bench`) share modelpick.db, and
# SQLite's fcntl locks do not cross the macOS/Docker-VM boundary — see the plist
# template's header for the two corruption incidents that settled this.
WEB_LABEL := com.jkrumm.modelpick-web
WEB_PLIST := $(HOME)/Library/LaunchAgents/$(WEB_LABEL).plist
WEB_TMPL  := launchd/$(WEB_LABEL).plist.template
WEB_URL   := http://localhost:7727

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

web-setup: build ## Build, then install + load the always-on dashboard LaunchAgent (mini only)
	@test "$$(cat ~/.config/secrets/backend 2>/dev/null)" = cache || { echo "web-setup: dev host only (secrets backend is not 'cache')"; exit 1; }
	@mkdir -p "$(HOME)/Library/LaunchAgents" "$(HOME)/Library/Logs"
	@sed -e 's|__HOME__|$(HOME)|g' -e 's|__REPO__|$(CURDIR)|g' "$(WEB_TMPL)" > "$(WEB_PLIST)"
	@plutil -lint "$(WEB_PLIST)" >/dev/null
	@launchctl bootout "gui/$$(id -u)/$(WEB_LABEL)" 2>/dev/null || true
	@launchctl bootstrap "gui/$$(id -u)" "$(WEB_PLIST)"
	@$(MAKE) --no-print-directory web-check

web-check: ## Is the dashboard agent loaded, and is IT the thing serving :7727
	@launchctl print "gui/$$(id -u)/$(WEB_LABEL)" 2>/dev/null | grep -E 'state =|last exit code|pid =' || { echo "✗ $(WEB_LABEL) not loaded — make web-setup"; exit 1; }
	@# /stack is the probe target on purpose: unlike /, it reads SQLite, so a
	@# hit proves server + secrets + DB path together. And the body is matched,
	@# not just the status code — a leftover `vite dev` on 7727 also answers 200,
	@# which once made this check pass against a server the agent never started.
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		body=$$(curl -s "$(WEB_URL)/stack" 2>/dev/null); \
		case "$$body" in \
			*@react-refresh*) \
				echo "✗ :7727 is a vite dev server, not this agent — npx kill-port 7727, then make web-restart"; \
				exit 1 ;; \
			*"What every service actually runs"*) \
				echo "✓ $(WEB_URL)/stack — 200, production build, deployments rendered"; \
				exit 0 ;; \
		esac; \
		sleep 2; \
	done; \
	echo "✗ $(WEB_URL)/stack never served the built app — tail ~/Library/Logs/modelpick-web.err"; \
	tail -n 20 "$(HOME)/Library/Logs/modelpick-web.err" 2>/dev/null; exit 1

web-restart: build ## Rebuild and restart the dashboard without re-rendering the plist
	@launchctl kickstart -k "gui/$$(id -u)/$(WEB_LABEL)"
	@$(MAKE) --no-print-directory web-check

web-teardown: ## Unload + remove the dashboard LaunchAgent (logs kept)
	@launchctl bootout "gui/$$(id -u)/$(WEB_LABEL)" 2>/dev/null || true
	@rm -f "$(WEB_PLIST)"
	@echo "✓ $(WEB_LABEL) removed"
