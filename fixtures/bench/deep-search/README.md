# storefront

The storefront service. `src/api/` is the public surface; everything below it is
internal. Configuration is read once at the edge of the process and passed down
— see `src/config/`.

Layout:

- `src/api/` — the public handlers
- `src/services/` — business logic, re-exported through `src/services/index.ts`
- `src/gateways/` — payment gateway adapters
- `src/config/` — process configuration
- `src/domain/` — pure domain types and calculations
- `src/telemetry/` — logging and health
- `src/util/` — generic helpers
- `src/legacy/` — the pre-v3 code path, kept for the migration
