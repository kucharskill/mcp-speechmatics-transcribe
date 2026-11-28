import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { parseTokens } from "../modules/config.js";
import { buildMarkdown } from "../modules/markdown.js";
import { selectAudioEvents } from "../modules/audio-events.js";

test("token entries support optional logins and reject empty tokens", () => {
  assert.deepEqual(parseTokens("user:key:part,bare,:third"), [
    { login: "user", token: "key:part" }, { token: "bare" }, { login: "", token: "third" },
  ]);
  for (const entry of ["", "user:", "one,,two"]) assert.throws(() => parseTokens(entry), /empty token/);
});

test("token status skips exclusions, masks keys, rounds hours, and persists usage", async () => {
  await mkdir(".tmp", { recursive: true });
  const root = resolve(".");
  const directory = await mkdtemp(join(root, ".tmp", "token-status-"));
  const envFile = join(directory, ".env");
  const mock = join(directory, "mock.mjs");
  const excludedToken = "synthetic-excluded";
  const log = JSON.stringify([{
    tokenSha256: createHash("sha256").update(excludedToken).digest("hex"), tokenDisabled: true,
  }]);
  const summary = [{ mode: "batch", type: "transcription", model: "enhanced", language: "en", count: 2, duration_hrs: 1.25 }];
  const usage = { since: "2026-01-01", until: "2026-01-31", summary, details: [] };
  const env = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory };
  for (const key of Object.keys(env)) if (key.startsWith("SPEECHMATICS_")) delete env[key];
  await mkdir(join(directory, "transcription"));
  await writeFile(join(directory, "transcription", "logs.json"), log);
  await writeFile(envFile, "SPEECHMATICS_TOKENS=account:synthetic-active,synthetic-anonymous,skip:synthetic-excluded,:tiny\n");
  await writeFile(mock, `
    import assert from "node:assert/strict";
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(init.method, "GET");
      const endpoint = new URL(url);
      assert.equal(endpoint.pathname, "/v2/usage");
      const today = new Date().toISOString().slice(0, 10);
      assert.equal(endpoint.searchParams.get("since"), process.env.STATUS_DEFAULT_DATES ? "1970-01-01" : "2026-01-01");
      assert.equal(endpoint.searchParams.get("until"), process.env.STATUS_DEFAULT_DATES ? today : "2026-01-31");
      assert.notEqual(init.headers.Authorization, "Bearer synthetic-excluded");
      calls++;
      if (init.headers.Authorization === "Bearer synthetic-anonymous") {
        return Response.json({ error: "synthetic-anonymous rejected" }, { status: 401 });
      }
      return Response.json({ ...${JSON.stringify(usage)}, since: endpoint.searchParams.get("since"), until: endpoint.searchParams.get("until") });
    };
    process.on("exit", () => assert.equal(calls, 3));
  `);
  try {
    const output = execFileSync(process.execPath, [
      "--import", pathToFileURL(mock).href, "cli.js", "--env-file", envFile, "--execute-tool",
    ], {
      env, encoding: "utf8",
      input: JSON.stringify({ protocol: 1, name: "token_status", arguments: { since: "2026-01-01", until: "2026-01-31" } }),
    });
    const result = JSON.parse(output);
    const rounded = { ...usage, summary: summary.map((row) => ({ ...row, duration_hrs: 1.3 })) };
    assert.deepEqual(result.structuredContent.tokens, [
      { login: "account", status: "active", usage: rounded },
      { token: "synt****mous", status: "error", error: { message: "Speechmatics HTTP 401: [token] rejected", httpStatus: 401 } },
      { login: "skip", status: "excluded" },
      { token: "****", status: "active", usage: rounded },
    ]);
    assert.ok(!output.includes("credits") && !output.includes("tokenSha256"));
    const stored = JSON.parse(await readFile(join(directory, "transcription", "logs.json"), "utf8"));
    assert.deepEqual(stored.transcriptions, JSON.parse(log));
    assert.equal(stored.usage.length, 2);
    assert.ok(stored.usage.every((entry) => entry.durationHours === 1.3 && entry.durationSeconds === 4500));
    const defaultDates = JSON.parse(execFileSync(process.execPath, [
      "--import", pathToFileURL(mock).href, "cli.js", "--env-file", envFile, "--execute-tool",
    ], {
      env: { ...env, STATUS_DEFAULT_DATES: "1" }, encoding: "utf8",
      input: JSON.stringify({ protocol: 1, name: "token_status", arguments: {} }),
    }));
    assert.equal(defaultDates.structuredContent.tokens[0].status, "active");
    const failed = JSON.parse(execFileSync(process.execPath, ["cli.js", "--env-file", envFile, "--execute-tool"], {
      env, encoding: "utf8",
      input: JSON.stringify({ protocol: 1, name: "token_status", arguments: { since: "2026-02-31" } }),
    }));
    assert.equal(failed.isError, true);
  } finally {
    assert.equal(dirname(directory), join(root, ".tmp"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI and MCP use an explicit env file and export a mocked transcription", { timeout: 20000 }, async () => {
  await mkdir(".tmp", { recursive: true });
  const root = resolve(".");
  const directory = await mkdtemp(join(root, ".tmp", "check-"));
  const environment = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("SPEECHMATICS_")) delete environment[key];
  }
  environment.SPEECHMATICS_DISCOVERY_CACHE_TTL_MS = "0";
  const envFile = join(directory, ".env");
  const input = join(directory, "sample.mp3");
  const transcript = {
    results: [
      { type: "word", start_time: 0, end_time: 31, alternatives: [{ content: "First", speaker: "S1" }] },
      { type: "punctuation", start_time: 31, end_time: 31, is_eos: true, alternatives: [{ content: "." }] },
      { type: "word", start_time: 32, end_time: 33, alternatives: [{ content: "Second", speaker: "S1" }] },
    ],
    audio_events: [
      { type: "door_slam", start_time: 34, end_time: 35, confidence: 0.95 },
      { type: "music", start_time: 36, end_time: 37, confidence: 0.2 },
    ],
  };
  const mock = join(directory, "mock.mjs");
  await writeFile(mock, `
    import assert from "node:assert/strict";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    import { appendFileSync } from "node:fs";
    const originalSpawn = childProcess.spawn;
    let workerCalls = 0;
    childProcess.spawn = (command, args, options) => {
      if (command !== process.execPath || args[0] !== ${JSON.stringify(join(root, "cli.js"))}) return originalSpawn(command, args, options);
      const mode = args.at(-1);
      assert.ok(["--tool-manifest", "--execute-tool"].includes(mode));
      assert.equal(options.shell, false);
      assert.deepEqual(args, [${JSON.stringify(join(root, "cli.js"))}, mode]);
      if (mode === "--execute-tool") appendFileSync(${JSON.stringify(join(directory, "workers.log"))}, "worker\\n");
      if (mode === "--execute-tool" && ++workerCalls === 3) return originalSpawn(process.execPath, ["-e", "process.exit(7)"], { ...options, shell: false });
      return originalSpawn(process.execPath, ["--import", import.meta.url, ${JSON.stringify(join(root, "cli.js"))}, mode], { ...options, shell: false });
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, init) => {
      if (init.method === "POST") {
        assert.equal(init.headers.Authorization, "Bearer synthetic-token");
        const config = JSON.parse(init.body.get("config"));
        assert.equal(config.transcription_config.language, "en");
        assert.deepEqual(config.audio_events_config, {});
        return Response.json({ id: "synthetic-job" }, { status: 201 });
      }
      return Response.json(url.includes("/transcript?")
        ? ${JSON.stringify(transcript)} : { job: { status: "done" } });
    };
  `);
  await writeFile(input, "synthetic fixture");
  await writeFile(envFile, "SPEECHMATICS_TOKENS=synthetic-token\nSPEECHMATICS_LANGUAGE=en\n");
  const childArgs = ["--import", pathToFileURL(mock).href, join(root, "cli.js"), "--env-file", envFile];
  try {
    const output = execFileSync(process.execPath, [...childArgs, input], {
      cwd: directory, env: environment, encoding: "utf8",
    });
    const result = JSON.parse(output);
    assert.equal(result.jobId, "synthetic-job");
    assert.equal(await readFile(result.markdownFile, "utf8"),
      buildMarkdown(input, transcript, selectAudioEvents(transcript)));
    assert.match(await readFile(result.subtitlesFile, "utf8"), /<v\.speaker S1>/);
    assert.ok(JSON.parse(await readFile(result.transcriptFile, "utf8")).audio_events.length === 2);

    // Missing credentials must not prevent tool discovery.
    await writeFile(envFile, "SPEECHMATICS_LANGUAGE=en\n");
    const child = spawn(process.execPath, childArgs, { cwd: directory, env: environment });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });
    let id = 0;
    const notifications = [];
    async function call(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
      for (;;) {
        const { value, done } = await lines.next();
        assert.equal(done, false, errors);
        const message = JSON.parse(value);
        if (message.method) { notifications.push(message); continue; }
        return message;
      }
    }
    try {
      const init = await call("initialize", {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integration-test", version: "1" },
      });
      assert.equal(init.result.serverInfo.title, "Speechmatics Transcribe");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const listed = await call("tools/list", {});
      const cliManifest = JSON.parse(execFileSync(process.execPath, [...childArgs, "--tool-manifest"], {
        cwd: directory, env: environment, encoding: "utf8",
      }));
      assert.deepEqual(listed.result.tools, cliManifest.tools);
      assert.equal(listed.result.tools[0].name, "transcribe");
      assert.equal(listed.result.tools[1].name, "token_status");
      assert.equal(listed.result.tools[0].inputSchema.properties.diarization, undefined);
      assert.equal(init.result.capabilities.tools.listChanged, true);
      await writeFile(envFile, "SPEECHMATICS_LANGUAGE=de\n");
      const refreshed = await call("tools/list", {});
      assert.match(refreshed.result.tools[0].inputSchema.properties.language.description, /default: de/);
      assert.equal(notifications.at(-1).method, "notifications/tools/list_changed");
      await writeFile(envFile, "SPEECHMATICS_LANGUAGE=en\n");
      const failed = await call("tools/call", { name: "transcribe", arguments: { file: input } });
      assert.equal(failed.result.isError, true);
      assert.match(failed.result.content[0].text, /SPEECHMATICS_TOKENS/);
      await writeFile(envFile, "SPEECHMATICS_TOKENS=synthetic-token\nSPEECHMATICS_LANGUAGE=en\n");
      const recovered = await call("tools/call", { name: "transcribe", arguments: { file: input } });
      assert.equal(recovered.result.structuredContent.jobId, "synthetic-job");
      const crashed = await call("tools/call", { name: "transcribe", arguments: { file: input } });
      assert.equal(crashed.result.isError, true);
      assert.match(crashed.result.content[0].text, /CLI process exited with 7/);
      const retry = await call("tools/call", { name: "transcribe", arguments: { file: input, disableDiarization: true } });
      assert.equal(retry.result.structuredContent.jobId, "synthetic-job");
      const unknown = await call("tools/call", { name: "new-cli-tool", arguments: {} });
      assert.match(unknown.result.content[0].text, /Unknown tool: new-cli-tool/);
      assert.equal((await readFile(join(directory, "workers.log"), "utf8")).trim().split("\n").length, 5);
    } finally {
      const closed = new Promise((done) => child.once("close", done));
      child.stdin.end();
      await closed;
    }
  } finally {
    assert.equal(dirname(directory), join(root, ".tmp"));
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker validates protocol, tool names, and arguments without starting MCP", () => {
  for (const [request, message] of [
    [{ protocol: 2 }, /Unsupported worker protocol/],
    [{ protocol: 1, name: "constructor", arguments: {} }, /Unknown tool/],
    [{ protocol: 1, name: "transcribe", arguments: {} }, /file/],
  ]) {
    const output = execFileSync(process.execPath, ["cli.js", "--execute-tool"], {
      input: JSON.stringify(request), encoding: "utf8",
    });
    const response = JSON.parse(output);
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, message);
  }
});

test("npx installation uses an explicit package and clears inherited npm arguments", async () => {
  const root = resolve(".");
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp", "launcher-"));
  try {
    const shim = join(directory, process.platform === "win32" ? "npx.cmd" : "npx");
    const expected = "-y --prefer-online --package=mcp-speechmatics-transcribe@latest -- mcp-speechmatics-transcribe --execute-tool";
    await writeFile(shim, process.platform === "win32" ? [
      "@echo off",
      'if not "%*"=="-y --prefer-online --package=mcp-speechmatics-transcribe@latest -- mcp-speechmatics-transcribe --execute-tool" exit /b 8',
      'if defined npm_config_package exit /b 9',
      'if defined npm_config_call exit /b 10',
      `"${process.execPath}" "${join(root, "cli.js")}" --execute-tool`,
      "",
    ].join("\r\n") : [
      "#!/bin/sh",
      `[ "$*" = "${expected}" ] || exit 8`,
      '[ -z "${npm_config_package+x}" ] || exit 9',
      '[ -z "${npm_config_call+x}" ] || exit 10',
      `exec "${process.execPath}" "${join(root, "cli.js")}" --execute-tool`,
      "",
    ].join("\n"));
    await chmod(shim, 0o755);
    const environment = { ...process.env };
    environment.npm_command = "exec";
    environment.npm_config_package = "other-package";
    environment.npm_config_call = "other-command";
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path");
    environment[pathKey] = directory + (process.platform === "win32" ? ";" : ":") + environment[pathKey];
    const installation = join(directory, "_npx", "synthetic", "node_modules", "mcp-speechmatics-transcribe", "modules");
    await mkdir(installation, { recursive: true });
    await writeFile(join(installation, "cli-process.js"), await readFile("modules/cli-process.js", "utf8"));
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { runCli } from ${JSON.stringify(pathToFileURL(join(installation, "cli-process.js")).href)};
      console.log(JSON.stringify(await runCli("--execute-tool", { protocol: 1, name: "unknown-tool", arguments: {} })));
    `], { env: environment, encoding: "utf8" });
    const response = JSON.parse(output);
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /Unknown tool/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local and ambiguous launches use the CLI from the same installation", async () => {
  const root = resolve(".");
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(join(root, ".tmp", "local launcher "));
  try {
    for (const cached of [false, true]) {
      const installation = cached
        ? join(directory, "_npx", "synthetic", "node_modules", "mcp-speechmatics-transcribe")
        : join(directory, "source checkout");
      await mkdir(join(installation, "modules"), { recursive: true });
      await writeFile(join(installation, "modules", "cli-process.js"), await readFile("modules/cli-process.js", "utf8"));
      await writeFile(join(installation, "cli.js"), `
        import assert from "node:assert/strict";
        assert.equal(process.env.npm_config_package, undefined);
        assert.equal(process.env.npm_config_call, undefined);
        assert.equal(process.env.SPEECHMATICS_TOKENS, "synthetic-token");
        console.log(JSON.stringify({ content: [{ type: "text", text: "same-installation" }] }));
      `);
      for (const npmCommand of cached ? ["", "run-script"] : ["", "exec", "run-script"]) {
        const environment = { ...process.env, SPEECHMATICS_TOKENS: "synthetic-token",
          npm_config_package: "inherited-package", npm_config_call: "inherited-command" };
        delete environment.npm_command;
        delete environment.npm_lifecycle_event;
        if (npmCommand) environment.npm_command = npmCommand;
        const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
          import { runCli } from ${JSON.stringify(pathToFileURL(join(installation, "modules", "cli-process.js")).href)};
          console.log(JSON.stringify(await runCli("--execute-tool", {})));
        `], { env: environment, encoding: "utf8" });
        assert.equal(JSON.parse(output).content[0].text, "same-installation");
      }
    }
  } finally {
    assert.equal(dirname(directory), join(root, ".tmp"));
    await rm(directory, { recursive: true, force: true });
  }
});
