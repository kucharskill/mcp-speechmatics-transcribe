import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export const outputRoot = join(tmpdir(), "transcription");
export const logPath = join(outputRoot, "logs.json");

async function updateLog(update) {
  await mkdir(outputRoot, { recursive: true });
  const release = await lockfile.lock(logPath, {
    realpath: false,
    retries: { retries: 60, minTimeout: 100, maxTimeout: 250 },
  });
  try {
    const source = await readFile(logPath, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "[]";
      throw error;
    });
    const entries = JSON.parse(source);
    if (!Array.isArray(entries)) throw new Error("logs.json musi zawierać tablicę rekordów.");
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
  const candidates = tokens.map(({ token }) => ({
    token,
    sha: createHash("sha256").update(token).digest("hex"),
  }));
  return updateLog((entries) => {
    const used = entries.filter((entry) => entry.tokenSha256);
    const last = used.at(-1);
    const blocked = new Set(used.filter((entry) => entry.tokenDisabled).map((entry) => entry.tokenSha256));
    const lastIndex = candidates.findIndex(({ sha }) => sha === last?.tokenSha256);
    const start = lastIndex === -1 ? used.length % candidates.length : (lastIndex + 1) % candidates.length;
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const candidate = candidates[(start + offset) % candidates.length];
      if (blocked.has(candidate.sha)) continue;
      entries.push({ ...record, tokenSha256: candidate.sha, status: "running" });
      return candidate;
    }
    return null;
  });
}

export async function updateRecord(record) {
  await updateLog((entries) => {
    const index = entries.findIndex(({ id }) => id === record.id);
    if (index === -1) entries.push(record);
    else entries[index] = { ...entries[index], ...record };
  });
}
