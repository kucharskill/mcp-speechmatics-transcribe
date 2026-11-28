import { createHash } from "node:crypto";
import { getUsage } from "./speechmatics.js";
import { readLog, updateUsage } from "./history.js";

export const lifetimeSince = "1970-01-01";
export const roundHours = (hours) => Math.round(hours * 10) / 10;
export function roundedUsage(usage) {
  return { ...usage, summary: usage.summary.map((row) => ({ ...row, duration_hrs: roundHours(row.duration_hrs) })), details: (usage.details ?? []).map((row) => ({ ...row, duration_hrs: roundHours(row.duration_hrs) })) };
}

export async function refreshUsage({ token, login }, since = lifetimeSince, until = new Date().toISOString().slice(0, 10)) {
  const requestedAt = new Date().toISOString();
  const result = await getUsage(token, since, until, AbortSignal.timeout(15000));
  if (result.since?.slice(0, 10) !== since || result.until?.slice(0, 10) !== until) throw new Error("Usage response does not cover the requested dates.");
  if (!Array.isArray(result.summary) || !result.summary.every((row) => Number.isFinite(row.duration_hrs) && row.duration_hrs >= 0 && Number.isInteger(row.count) && row.count >= 0)) throw new Error("Invalid usage statistics.");
  const durationSeconds = result.summary.reduce((total, row) => total + row.duration_hrs * 3600, 0);
  const snapshot = {
    ...(login ? { login } : {}), tokenSha256: createHash("sha256").update(token).digest("hex"),
    since: result.since?.slice(0, 10) ?? since, until: result.until?.slice(0, 10) ?? until,
    requestedAt, updatedAt: new Date().toISOString(), count: result.summary.reduce((total, row) => total + row.count, 0),
    durationHours: roundHours(durationSeconds / 3600), durationSeconds, ...roundedUsage(result),
  };
  // Persist normalized scope dates even when the provider returns timestamps.
  snapshot.since = snapshot.since.slice(0, 10);
  snapshot.until = snapshot.until.slice(0, 10);
  await updateUsage(snapshot).catch(() => {});
  return roundedUsage(result);
}

export async function initializeUsage(tokens) {
  const { transcriptions, usage } = await readLog();
  const blocked = new Set(transcriptions.filter((entry) => entry.tokenDisabled).map((entry) => entry.tokenSha256));
  const today = new Date().toISOString().slice(0, 10);
  await Promise.all(tokens.map(async (entry) => {
    const sha = createHash("sha256").update(entry.token).digest("hex");
    if (!blocked.has(sha) && !usage.some((item) => item.tokenSha256 === sha && item.since === lifetimeSince && item.until === today)) {
      await refreshUsage(entry).catch(() => {});
    }
  }));
}
