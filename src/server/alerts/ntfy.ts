// ntfy publishing for release alerts, after home/tools/climate/ntfy.ts.
// Env: NTFY_URL (private host, injected into the refresh plist by `make refresh-setup`),
// NTFY_TOKEN (.env.tpl), NTFY_TOPIC (default "models"), MODELPICK_NOTIFY_DRY=1 prints instead.

export interface Push {
  title: string;
  message: string;
  priority: "default" | "high";
  tags: string[];
}

/** `sent` = delivered, `dry` = printed only, `skipped` = no NTFY_URL/TOKEN (nothing left the machine). */
export type PublishOutcome = "sent" | "dry" | "skipped";

// JSON publishing keeps UTF-8 titles intact (headers would need RFC 2047).
export async function publish(push: Push): Promise<PublishOutcome> {
  if (process.env["MODELPICK_NOTIFY_DRY"] === "1") {
    console.log(`[alerts] DRY ${push.priority} ${push.title}: ${push.message.replaceAll("\n", " | ")}`);
    return "dry";
  }
  const url = process.env["NTFY_URL"];
  const token = process.env["NTFY_TOKEN"];
  if (!url || !token) {
    console.warn("[alerts] NTFY_URL or NTFY_TOKEN not set — skipping publish");
    return "skipped";
  }
  const res = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: process.env["NTFY_TOPIC"] ?? "models",
      title: push.title,
      message: push.message,
      priority: push.priority === "high" ? 4 : 3,
      tags: push.tags,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
  return "sent";
}
