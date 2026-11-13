#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { defaults, optionFields } from "./modules/options.js";
import { transcribe } from "./modules/transcribe.js";

const { version } = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const program = new Command()
  .name("speechmatics-transcribe")
  .version(version)
  .description("Transcribe audio and video files to JSON, WebVTT, and Markdown.")
  .option("--env-file <path>", "Load an explicit .env file (also supported through SPEECHMATICS_ENV_FILE)")
  .argument("<file>", "Path to an audio or video file")
  .addOption(new Option("--model <model>", `Model (default: ${defaults.model})`).choices(optionFields.model.options))
  .option("--language <code>", `Language (default: ${defaults.language}); use multi with multilingual models`)
  .addOption(new Option("--diarization <mode>", `Diarization (default: ${defaults.diarization})`).choices(optionFields.diarization.options))
  .option("--audio-events", "Detect laughter, music, and applause with Standard or Enhanced (enabled by default)")
  .option("--no-audio-events", "Disable audio event detection")
  .option("--convert-to-mp3", "Convert non-MP3 input using FFmpeg")
  .option("--no-convert-to-mp3", "Disable MP3 conversion")
  .option("--timeout-seconds <seconds>", `API timeout (default: ${defaults.timeoutSeconds} seconds)`, Number)
  .addHelpText("after", "\nPrecedence: CLI arguments, process environment, .env, built-in defaults.")
  .hook("preAction", () => {
    const { envFile } = program.opts();
    if (envFile) process.env.SPEECHMATICS_ENV_FILE = resolve(envFile);
  })
  .action(async (file, { envFile, ...options }) => {
    try {
      console.log(JSON.stringify(await transcribe(file, options), null, 2));
    } catch (error) {
      console.error(JSON.stringify(error.result ?? { message: error.message }, null, 2));
      process.exitCode = 1;
    }
  });

program.command("mcp")
  .description("Start the MCP server over stdio")
  .action(async () => { await import("./mcp.js"); });

await program.parseAsync();
