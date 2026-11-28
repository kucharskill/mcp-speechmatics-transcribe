import { createHash } from "node:crypto";
import { loadConfig } from "./config.js";
import { readLog } from "./history.js";
import { ApiError } from "./speechmatics.js";
import { refreshUsage, lifetimeSince } from "./usage.js";

export async function tokenStatus({ since, until } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  since ??= lifetimeSince;
  until ??= today;
  if (until < since) throw new Error("until must be on or after since.");
  const { tokens } = await loadConfig();
  const excluded = new Set((await readLog()).transcriptions
    .filter((entry) => entry.tokenDisabled)
    .map((entry) => entry.tokenSha256));
  const results = [];
  for (const { login, token } of tokens) {
    const identity = login ? { login } : {
      token: token.length > 12 ? token.slice(0, 4) + "****" + token.slice(-4) : "****",
    };
    const sha = createHash("sha256").update(token).digest("hex");
    if (excluded.has(sha)) {
      results.push({ ...identity, status: "excluded" });
      continue;
    }
    try {
      const { since: start, until: end, summary, details } = await refreshUsage({ token, login }, since, until);
      results.push({ ...identity, status: "active", usage: { since: start, until: end, summary, details } });
    } catch (error) {
      results.push({
        ...identity, status: "error",
        error: {
          message: error.message.replaceAll(token, "[token]"),
          ...(error instanceof ApiError && error.httpStatus !== null && { httpStatus: error.httpStatus }),
        },
      });
    }
  }
  return { tokens: results };
}
