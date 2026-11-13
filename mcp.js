import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { optionFields } from "./modules/options.js";
import { loadConfig } from "./modules/config.js";
import { transcribe } from "./modules/transcribe.js";

const { options: configuredDefaults } = await loadConfig({}, { requireTokens: false });
const { version } = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

function createServer() {
  const description = "Transcribe local audio and video files through the Speechmatics Batch API.";
  const server = new McpServer({
    name: "mcp-speechmatics-transcribe",
    title: "Speechmatics Transcribe",
    version,
    description,
  }, { instructions: description });
  server.registerTool("transcribe", {
    description: `${description} Return paths to raw JSON, segments, WebVTT subtitles, and Markdown.`,
    inputSchema: z.strictObject({
      file: z.string().min(1).describe("Absolute path to a local audio or video file."),
      model: optionFields.model.optional().describe(`Configured default: ${configuredDefaults.model}. enhanced: highest accuracy for a selected language. standard: faster processing and archival transcription. melia-1: MULTILANGUAGE, language switching within recordings. oak-1: MULTILANGUAGE, healthcare recordings. Use language=multi for melia-1 and oak-1; neither supports audio events.`),
      language: optionFields.language.optional().describe(`Configured default: ${configuredDefaults.language}. Language code such as pl or en for enhanced/standard. Use multi for MULTILANGUAGE models melia-1 and oak-1.`),
      disableDiarization: z.boolean().optional().describe(`Configured speaker diarization: ${configuredDefaults.diarization === "none" ? "disabled" : "enabled"}. Set true to disable it. Omit or pass false to use the server setting.`),
      audioEvents: optionFields.audioEvents.optional().describe(`Configured default: ${configuredDefaults.audioEvents}. Detect laughter, music, and applause with Standard/Enhanced. Automatically disabled for melia-1/oak-1. Set false to disable.`),
      convertToMp3: optionFields.convertToMp3.optional().describe(`Configured default: ${configuredDefaults.convertToMp3}. Convert non-MP3 files with system FFmpeg before uploading.`),
      timeoutSeconds: optionFields.timeoutSeconds.optional().describe(`Configured default: ${configuredDefaults.timeoutSeconds} seconds. Upload and API processing timeout, independent of recording duration.`),
    }),
  }, async ({ file, disableDiarization, ...options }) => {
    try {
      const result = await transcribe(file, {
        ...options,
        ...(disableDiarization && { diarization: "none" }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const result = error.result ?? { message: error.message };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  });
  return server;
}

serveStdio(createServer);
