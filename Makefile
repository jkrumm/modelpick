.PHONY: db-up db-down dev build up down

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
