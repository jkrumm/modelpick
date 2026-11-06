// Local id → the dated AA slug its route verifiably serves. The resolver never strips a
// 4-digit snapshot suffix (`-1017`) — that would collapse every DeepSeek snapshot onto one
// id — so a route that silently moved to a new snapshot needs an explicit pin.
// deepseek-v4.1-flash: IU → Requesty deepseek/deepseek-v4.1-flash, updated to 1017 on
// 2026-10-17 (docs/decisions/agent-gateway-tiers.md, 2026-10-19).
export const SNAPSHOT_PINS: Readonly<Record<string, string>> = {
  "deepseek-v4.1-flash": "deepseek-v4-1-flash-1017",
};
