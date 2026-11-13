import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { parseTokens } from "../modules/config.js";
import { buildMarkdown } from "../modules/markdown.js";
import { selectAudioEvents } from "../modules/audio-events.js";

test("token entries support optional logins and reject empty tokens", () => {
  assert.deepEqual(parseTokens("user:key:part,bare,:third"), [
    { login: "user", token: "key:part" }, { token: "bare" }, { login: "", token: "third" },
  ]);
  for (const entry of ["", "user:", "one,,two"]) assert.throws(() => parseTokens(entry), /empty token/);
});

test("CLI and MCP use an explicit env file and export a mocked transcription", { timeout: 20000 }, async () => {
  await mkdir("work", { recursive: true });
  const root = resolve(".");
  const directory = await mkdtemp(join(root, "work", "check-"));
  const environment = { ...process.env, TEMP: directory, TMP: directory, TMPDIR: directory };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("SPEECHMATICS_")) delete environment[key];
  }
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
    const child = spawn(process.execPath, [...childArgs, "mcp"], { cwd: directory, env: environment });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    let errors = "";
    child.stderr.on("data", (chunk) => { errors += chunk; });
    let id = 0;
    async function call(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n");
      const { value, done } = await lines.next();
      assert.equal(done, false, errors);
      return JSON.parse(value);
    }
    try {
      const init = await call("initialize", {
        protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "integration-test", version: "1" },
      });
      assert.equal(init.result.serverInfo.title, "Speechmatics Transcribe");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const listed = await call("tools/list", {});
      assert.equal(listed.result.tools[0].name, "transcribe");
      assert.equal(listed.result.tools[0].inputSchema.properties.diarization, undefined);
      const failed = await call("tools/call", { name: "transcribe", arguments: { file: input } });
      assert.equal(failed.result.isError, true);
      assert.match(failed.result.content[0].text, /SPEECHMATICS_TOKENS/);
      await writeFile(envFile, "SPEECHMATICS_TOKENS=synthetic-token\nSPEECHMATICS_LANGUAGE=en\n");
      const recovered = await call("tools/call", { name: "transcribe", arguments: { file: input } });
      assert.equal(recovered.result.structuredContent.jobId, "synthetic-job");
    } finally {
      const closed = new Promise((done) => child.once("close", done));
      child.stdin.end();
      await closed;
    }
  } finally {
    assert.equal(dirname(directory), join(root, "work"));
    await rm(directory, { recursive: true, force: true });
  }
});
