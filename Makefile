.PHONY: db-up db-down dev build up down deploy

db-up:
	docker compose -f docker-compose.dev.yml up postgres -d

db-down:
	docker compose -f docker-compose.dev.yml down

dev:
	bun run dev

build:
	bun run build

up: db-up dev

down: db-down

# Deploy — documents the rollhook trigger (actual deploy is user-run on the VPS).
# The GitHub Actions workflow (.github/workflows/deploy.yml) handles this automatically
# on push to master. Use this target as a reminder of the manual trigger command.
deploy:
	@echo "Deploy is triggered automatically by pushing to master."
	@echo "GitHub Actions builds the image, pushes to rollhook.jkrumm.com/modelpick:<sha>,"
	@echo "and triggers the RollHook webhook at https://rollhook.jkrumm.com/deploy/modelpick."
	@echo ""
	@echo "To deploy manually from the VPS (SSH in first):"
	@echo "  cd ~/vps && make modelpick-up"
	@echo ""
	@echo "To trigger a fresh RollHook deploy without a code change:"
	@echo "  git commit --allow-empty -m 'chore: redeploy' && git push"
