import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const object = z.record(z.string(), z.json());
const manifestSchema = z.object({
  protocol: z.literal(1),
  serverInfo: z.object({ name: z.string().min(1), version: z.string().min(1), title: z.string().optional(), description: z.string().optional() }).passthrough(),
  tools: z.array(z.object({
    name: z.string().min(1), title: z.string().optional(), description: z.string().optional(),
    inputSchema: object.refine((value) => value.type === "object"),
    outputSchema: object.optional(),
    annotations: z.object({ title: z.string().optional(), readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional(), idempotentHint: z.boolean().optional(), openWorldHint: z.boolean().optional() }).passthrough().optional(),
  }).passthrough()).refine((tools) => new Set(tools.map((tool) => tool.name)).size === tools.length),
}).passthrough();

function validateManifest(value) {
  z.json().parse(value);
  manifestSchema.parse(value);
  return value;
}

// Request/session-bound discovery is returned intact but cannot be replayed.
function hasRequestState(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, child]) =>
    /(?:^|\/)(?:sessionId|session_id|progressToken|requestId|requestState|inputRequests|relatedTask|related-task)$/i.test(name)
    || (name === "cacheScope" && child === "session")
    || hasRequestState(child));
}

export function discoveryKey(launch, platform = process.platform) {
  const normalize = (key) => platform === "win32" ? key.toUpperCase() : key;
  const excluded = new Set(["CODEX_TOOL_CALL_ID", ...(launch.env.SPEECHMATICS_DISCOVERY_CACHE_KEY_EXCLUDE ?? "").split(",").map((key) => key.trim()).filter(Boolean)].map(normalize));
  const env = Object.entries(launch.env).map(([key, value]) => [normalize(key), value])
    .filter(([key]) => !excluded.has(key) && !/^(?:CODEX_TOOL_CALL_ID$|PATH$|INIT_|NPM_)/i.test(key)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return createHash("sha256").update(JSON.stringify({ version: 1, command: launch.command, args: launch.args, cwd: launch.cwd, shell: launch.shell, env })).digest("hex");
}

export function createDiscoveryCache(launch, load, { directory = join(tmpdir(), "transcription", "discovery"), now = Date.now } = {}) {
  const raw = launch.env.SPEECHMATICS_DISCOVERY_CACHE_TTL_MS ?? "600000";
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("SPEECHMATICS_DISCOVERY_CACHE_TTL_MS must be a nonnegative integer.");
  const ttl = Number(raw), key = discoveryKey(launch), file = join(directory, key + ".json");
  let pending, generation = 0;
  const invalidate = async () => { generation++; await rm(file, { force: true }).catch(() => {}); };
  return {
    file, invalidate,
    async get() {
      if (ttl) {
        try {
          const bytes = await readFile(file);
          if (bytes.length > 1024 * 1024) throw new Error("Oversized cache.");
          const entry = JSON.parse(bytes);
          if (entry.version !== 1 || entry.key !== key || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.expiresAt)
            || entry.createdAt > now() || entry.expiresAt <= now() || entry.expiresAt - entry.createdAt > ttl) throw new Error("Expired cache.");
          if (hasRequestState(entry.manifest)) throw new Error("Request-bound discovery.");
          return validateManifest(entry.manifest);
        } catch { /* Invalid or unavailable cache entries are misses. */ }
      }
      if (pending) return pending;
      const revision = generation;
      pending = (async () => {
        const manifest = validateManifest(await load());
        const serialized = JSON.stringify(manifest);
        const privateValues = Object.entries(launch.env).filter(([name]) => /token|secret|password|session|CODEX_TOOL_CALL_ID/i.test(name))
          .flatMap(([name, value]) => /SPEECHMATICS_TOKENS/i.test(name)
            ? [value, ...value.split(",").flatMap((entry) => entry.includes(":") ? [entry.slice(entry.indexOf(":") + 1)] : [entry])]
            : [value]).filter((value) => value.length >= 8);
        if (ttl && revision === generation && !hasRequestState(manifest) && !privateValues.some((value) => serialized.includes(value))) {
          const temporary = file + "." + randomUUID() + ".tmp";
          try {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const createdAt = now();
            await writeFile(temporary, JSON.stringify({ version: 1, key, createdAt, expiresAt: createdAt + ttl, manifest }), { mode: 0o600 });
            if (revision === generation) await rename(temporary, file);
          } catch { /* Discovery remains available when the cache is unwritable. */ }
          finally { await rm(temporary, { force: true }).catch(() => {}); }
        }
        return manifest;
      })();
      try { return await pending; } finally { pending = undefined; }
    },
  };
}
