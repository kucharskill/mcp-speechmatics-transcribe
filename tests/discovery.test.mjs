import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDiscoveryCache, discoveryKey } from "../modules/discovery-cache.js";
import { runCli, dumpStartupEnvironment } from "../modules/cli-process.js";

test("startup snapshots append the original wrapper environment to one local JSONL file", async () => {
  const directory = await temporary();
  try {
    const first = dumpStartupEnvironment(directory);
    const second = dumpStartupEnvironment(directory);
    assert.equal(first, second);
    const records = (await readFile(first, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.equal(record.pid, process.pid);
      assert.ok(Number.isFinite(Date.parse(record.startedAt)));
      assert.ok(JSON.stringify(record.env) === JSON.stringify({ ...process.env }));
    }
    assert.equal(first, join(directory, "env-startup.jsonl"));
    assert.equal(dumpStartupEnvironment(first), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const manifest = { protocol: 1, serverInfo: { name: "fixture", version: "1", title: "Fixture" }, tools: [{ name: "echo", inputSchema: { type: "object" } }] };
const launch = { command: "node", args: ["cli.js"], cwd: "fixture", shell: false, env: { KEY: "value", CODEX_TOOL_CALL_ID: "session-one" } };
async function temporary() { await mkdir(".tmp", { recursive: true }); return mkdtemp(resolve(".tmp", "discovery-")); }

test("cache keys include complete configuration, normalize Windows names, and exclude only configured names", () => {
  const key = discoveryKey(launch);
  for (const patch of [{ command: "other" }, { args: ["other"] }, { cwd: "other" }, { env: { ...launch.env, KEY: "other" } }, { env: { ...launch.env, EXTRA: "other" } }]) assert.notEqual(discoveryKey({ ...launch, ...patch }), key);
  assert.equal(discoveryKey({ ...launch, env: { CODEX_TOOL_CALL_ID: "session-two", KEY: "value" } }), key);
  assert.equal(discoveryKey({ ...launch, env: { key: "value", codex_tool_call_id: "other" } }, "win32"), discoveryKey(launch, "win32"));
  const env = { ...launch.env, SPEECHMATICS_DISCOVERY_CACHE_KEY_EXCLUDE: "CUSTOM", CUSTOM: "one" };
  assert.equal(discoveryKey({ ...launch, env }), discoveryKey({ ...launch, env: { ...env, CUSTOM: "two" } }));
});

test("cache validates entries, expires without extending hits, invalidates and stores no environment", async () => {
  const directory = await temporary(); let time = 1000, loads = 0;
  const cache = createDiscoveryCache(launch, async () => { loads++; return manifest; }, { directory, now: () => time });
  try {
    await cache.get(); const bytes = await readFile(cache.file, "utf8");
    assert.equal(JSON.parse(bytes).expiresAt, 601000);
    assert.ok(!bytes.includes("session-one")); assert.ok(!bytes.includes('"KEY"'));
    time++; await cache.get(); assert.equal(loads, 1); assert.equal(await readFile(cache.file, "utf8"), bytes);
    time = 601001; await cache.get(); assert.equal(loads, 2);
    await writeFile(cache.file, "broken"); await cache.get(); assert.equal(loads, 3);
    const entry = JSON.parse(await readFile(cache.file, "utf8")); entry.manifest.tools[0].inputSchema = null;
    await writeFile(cache.file, JSON.stringify(entry)); await cache.get(); assert.equal(loads, 4);
    await cache.invalidate(); await cache.get(); assert.equal(loads, 5);
    assert.throws(() => createDiscoveryCache({ ...launch, env: { SPEECHMATICS_DISCOVERY_CACHE_TTL_MS: "bad" } }, () => manifest));
    const invalid = createDiscoveryCache(launch, () => ({ ...manifest, sessionId: "private" }), { directory: join(directory, "invalid") });
    await assert.rejects(invalid.get());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("legacy ping is local; a second process initializes and lists from shared cache; calls still run CLI", { timeout: 20000 }, async () => {
  const directory = await temporary(), root = resolve(".");
  const fixture = join(directory, "cli.mjs"), preload = join(directory, "preload.mjs"), log = join(directory, "workers.jsonl"), blocked = join(directory, "blocked");
  await writeFile(fixture, `import {appendFileSync,existsSync} from 'node:fs';
    const mode=process.argv.at(-1);
    if(mode==='--tool-manifest' && existsSync(${JSON.stringify(blocked)})) process.exit(9);
    appendFileSync(${JSON.stringify(log)},JSON.stringify({mode,id:process.env.CODEX_TOOL_CALL_ID})+'\\n');
    if(mode==='--tool-manifest') console.log(JSON.stringify(${JSON.stringify(manifest)}));
    else {let body='';for await(const chunk of process.stdin)body+=chunk;console.log(JSON.stringify({content:[{type:'text',text:body}]}));}`);
  await writeFile(preload, `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
    const original=cp.spawn;cp.spawn=(command,args,options)=>original(process.execPath,[${JSON.stringify(fixture)},args.at(-1)],options);syncBuiltinESMExports();`);
  const env = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory, npm_config_package: "synthetic-original-wrapper-value", CODEX_TOOL_CALL_ID: "first-session", SPEECHMATICS_DISCOVERY_CACHE_TTL_MS: "600000" };
  async function session(id, warm, modern = false) {
    const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, join(root, "mcp.js")], { cwd: directory, env: { ...env, CODEX_TOOL_CALL_ID: id } });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator](); let errors = "", nextId = 0;
    child.stderr.on("data", (chunk) => { errors += chunk; });
    async function call(method, params = {}) {
      const requestId = ++nextId; child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
      for (;;) { const line = await lines.next(); assert.equal(line.done, false, errors); const message = JSON.parse(line.value); if (message.id === requestId) return message; }
    }
    try {
      if (modern) {
        const params = { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" } } };
        const discovery = await call("server/discover", params);
        assert.ok(discovery.result, JSON.stringify(discovery));
        assert.deepEqual((await call("tools/list", params)).result.tools, manifest.tools);
        assert.ok((await call("ping", params)).error, "Modern protocol must not gain legacy ping");
        return;
      }
      assert.deepEqual((await call("ping")).result, {});
      if (!warm) await assert.rejects(readFile(log));
      const init = await call("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture-client", version: "1" } });
      assert.equal(init.result.serverInfo.name, "fixture"); assert.equal(init.result.protocolVersion, "2025-11-25");
      assert.deepEqual(Object.keys(init.result.capabilities), ["tools"]);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      assert.deepEqual((await call("tools/list")).result.tools, manifest.tools);
      assert.deepEqual((await call("ping")).result, {});
      if (warm) {
        const response = await call("tools/call", { name: "echo", arguments: { value: "delegated" } });
        assert.equal(JSON.parse(response.result.content[0].text).arguments.value, "delegated");
        await rm(blocked);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n");
        assert.deepEqual((await call("tools/list")).result.tools, manifest.tools);
      }
    } finally { const closed = new Promise((done) => child.once("close", done)); child.stdin.end(); await closed; }
  }
  try {
    await session("first-session", false); await writeFile(blocked, "");
    await session("modern-session", true, true); await session("second-session", true);
    const workers = (await readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(workers, [{ mode: "--tool-manifest", id: "first-session" }, { mode: "--execute-tool", id: "second-session" }, { mode: "--tool-manifest", id: "second-session" }]);
    const snapshots = (await readFile(join(directory, "transcription", "discovery", "env-startup.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(snapshots.length, 3);
    assert.equal(new Set(snapshots.map((record) => record.pid)).size, 3);
    assert.ok(snapshots.every((record) => record.env.npm_config_package === "synthetic-original-wrapper-value"));
    assert.deepEqual(snapshots.map((record) => record.env.CODEX_TOOL_CALL_ID), ["first-session", "modern-session", "second-session"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI delegation supports cancellation", async () => {
  const controller = new AbortController();
  const operation = runCli("--execute-tool", {}, { launch: { command: process.execPath, args: ["-e", "setTimeout(()=>{},30000)", "--"], env: process.env, cwd: process.cwd(), shell: false }, signal: controller.signal });
  controller.abort(); await assert.rejects(operation, { name: "AbortError" });
});
