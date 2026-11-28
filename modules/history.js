import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export const outputRoot = join(tmpdir(), "transcription");
export const logPath = join(outputRoot, "logs.json");

export async function readLog() {
  const source = await readFile(logPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return '{"transcriptions":[],"usage":[]}';
    throw error;
  });
  const entries = JSON.parse(source);
  if (Array.isArray(entries)) return { transcriptions: entries, usage: [] };
  if (!entries || !Array.isArray(entries.transcriptions) || !Array.isArray(entries.usage)) throw new Error("logs.json must contain transcriptions and usage arrays.");
  return entries;
}

async function updateLog(update) {
  await mkdir(outputRoot, { recursive: true });
  const release = await lockfile.lock(logPath, {
    realpath: false,
    retries: { retries: 60, minTimeout: 100, maxTimeout: 250 },
  });
  try {
    const entries = await readLog();
    const result = update(entries);
    const temporaryPath = join(outputRoot, `logs-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, JSON.stringify(entries, null, 2) + "\n", { flag: "wx" });
      await rename(temporaryPath, logPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return result;
  } finally {
    await release();
  }
}

export async function reserveToken(tokens, record) {
  const candidates = tokens.map(({ token, login }) => ({
    token, login,
    sha: createHash("sha256").update(token).digest("hex"),
  }));
  return updateLog(({ transcriptions: entries, usage }) => {
    const used = entries.filter((entry) => entry.tokenSha256);
    const last = used.at(-1);
    const blocked = new Set(used.filter((entry) => entry.tokenDisabled).map((entry) => entry.tokenSha256));
    const lastIndex = candidates.findIndex(({ sha }) => sha === last?.tokenSha256);
    const start = lastIndex === -1 ? used.length % candidates.length : (lastIndex + 1) % candidates.length;
    const ordered = Array.from({ length: candidates.length }, (_, offset) => candidates[(start + offset) % candidates.length]).filter(({ sha }) => !blocked.has(sha));
    if (!ordered.length) return null;
    const metrics = ordered.map((candidate) => {
      const snapshot = usage.find((item) => item.tokenSha256 === candidate.sha && item.since === "1970-01-01");
      const local = entries.filter((entry) => entry.tokenSha256 === candidate.sha);
      const pendingSeconds = local.filter((entry) => entry.status === "success" && entry.finishedAt > snapshot?.requestedAt)
        .reduce((total, entry) => total + (entry.audioDurationSeconds ?? 0), 0);
      return { candidate, known: !!snapshot, until: snapshot?.until, seconds: (snapshot?.durationSeconds ?? 0) + pendingSeconds, running: local.filter((entry) => entry.status === "running" && entry.reservationExpiresAt > new Date().toISOString()).length };
    });
    // Compare hours only when every eligible account has the same lifetime scope.
    const comparable = metrics.every((item) => item.known) && new Set(metrics.map((item) => item.until)).size === 1;
    const idle = metrics.filter((item) => item.running === 0);
    const pool = idle.length ? idle : metrics;
    pool.sort((a, b) => comparable ? a.seconds - b.seconds || a.running - b.running : a.running - b.running);
    const candidate = pool[0].candidate;
    entries.push({ ...record, reservationExpiresAt: record.reservationExpiresAt ?? new Date(Date.now() + 900000).toISOString(), tokenSha256: candidate.sha, status: "running" });
    return candidate;
  });
}

export async function updateRecord(record) {
  await updateLog(({ transcriptions: entries }) => {
    const index = entries.findIndex(({ id }) => id === record.id);
    if (index === -1) entries.push(record);
    else entries[index] = { ...entries[index], ...record };
  });
}

export async function updateUsage(snapshot) {
  return updateLog(({ usage }) => {
    const index = usage.findIndex((item) => item.tokenSha256 === snapshot.tokenSha256 && item.since === snapshot.since);
    const previous = usage[index];
    if (previous && (snapshot.until < previous.until || snapshot.durationSeconds < previous.durationSeconds || snapshot.count < previous.count || (snapshot.durationSeconds === previous.durationSeconds && snapshot.requestedAt < previous.requestedAt))) return false;
    if (previous && snapshot.durationSeconds === previous.durationSeconds) snapshot = { ...snapshot, requestedAt: previous.requestedAt };
    if (index < 0) usage.push(snapshot);
    else usage[index] = snapshot;
    return true;
  });
}
