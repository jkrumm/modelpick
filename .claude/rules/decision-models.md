---
description: Decision models: typed-answer classifiers, the systemone route, probe rules. Read when changing src/db/decision-models.ts, the probe or the IU decision client.
paths: ["src/db/decision-models.ts","scripts/probe.ts","src/server/iu/probe.ts","src/server/iu/decision-client.ts"]
---

# Decision models

`decision` is a model modality (`MODALITY`): typed-answer classifiers (Clef,
Decision-1, Jev, PPLX Decider, Luna's Decisions API: yes/no, choice and score answers with
probabilities, no text generation). No leaderboard scores them; the verdict lives in the decision record.
All but Luna are called on UE's native **systemone** API (`IU_DECISIONS_BASE_URL` +
`/systemone`); Luna's Decisions route is its own catalog entry, `gpt-6-luna:decisions`, on the
OpenAI leg. The ids live in `src/db/decision-models.ts`; the probe reads UE's decision list
(`/decisions/v1/models`) and warns about — and catalogs — any id missing there. They are never
probed with a chat "hi" (`probe.ts` sends a minimal decision request). Record:
[`docs/decisions/decision-model.md`](docs/decisions/decision-model.md); wire formats in
`model-configs.md`.
