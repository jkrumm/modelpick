# modelpick — env template resolved by 1Password at runtime (account: tkrumm).
# Tracked: holds only op:// references + non-secret config — never plaintext secrets.
# The package.json scripts wrap commands in `op run --account tkrumm --env-file=.env.tpl`,
# so secrets are injected into the process env and never rest on disk.
# Run a one-off manually: op run --account tkrumm --env-file=.env.tpl -- bun run probe

# --- IU unified endpoint ---
# Secret key in op://common/anthropic; the per-provider gateway routes are non-secret config.
IU_API_KEY=op://common/anthropic/API_KEY
IU_ANTHROPIC_BASE_URL=https://unified-endpoint-main.app.iu-it.org/anthropic/v1
IU_OPENAI_BASE_URL=https://unified-endpoint-main.app.iu-it.org/openai/v1
IU_GEMINI_BASE_URL=https://unified-endpoint-main.app.iu-it.org/gemini/v1beta
IU_REPLICATE_BASE_URL=https://unified-endpoint-main.app.iu-it.org/replicate/v1

# --- Google AI Studio (control door for the cross-provider benchmark) ---
# Personal free-tier key: it is the only way to tell "the model is slow" apart from
# "IU is slow". Free tier refuses Gemini Pro outright — see docs/decisions/iu-vs-ai-studio.md.
GOOGLE_AI_STUDIO_KEY=op://hermes/google-ai-studio/api-key

# --- External leaderboard APIs ---
OPENROUTER_API_KEY=op://vps/modelpick/OPENROUTER_API_KEY
ARTIFICIALANALYSIS_API_KEY=op://vps/modelpick/ARTIFICIALANALYSIS_API_KEY

# --- Local SQLite DB (non-secret) ---
DATABASE_URL=file:modelpick.db
