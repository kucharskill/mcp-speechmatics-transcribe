import { z } from "zod";
import { optionFields } from "./options.js";
import { transcribe } from "./transcribe.js";
import { loadConfig } from "./config.js";
import { readFile } from "node:fs/promises";
import { tokenStatus } from "./token-status.js";

export const description = "Transcribe local audio and video files through the Speechmatics Batch API.";

export function createTools(configuredDefaults) {
  return {
    transcribe: {
      definition: {
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
      },
      execute: async ({ file, disableDiarization, ...options }) => {
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
      },
    },
    token_status: {
      definition: {
        description: "Check configured tokens and read Batch usage from Speechmatics. Excluded tokens are reported without API requests. Identity is the configured login or a masked token. API access does not guarantee funds for transcription. Usage is returned in the API's scope, not attributed exclusively to a key. This read-only check does not change rotation, exclusions, or logs.",
        inputSchema: z.strictObject({
          since: z.iso.date().optional().describe("Inclusive start date YYYY-MM-DD. Defaults to the first day of the current UTC month."),
          until: z.iso.date().optional().describe("Inclusive end date YYYY-MM-DD. Omit to use the API's current end date."),
        }),
        annotations: { readOnlyHint: true },
      },
      execute: async (options) => {
        try {
          const result = await tokenStatus(options);
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ message: error.message }) }] };
        }
      },
    },
  };
}

export async function executeTool(name, args) {
  const { options } = await loadConfig({}, { requireTokens: false });
  const tools = createTools(options);
  if (!Object.hasOwn(tools, name)) throw new Error("Unknown tool: " + name);
  const tool = tools[name];
  return tool.execute(tool.definition.inputSchema.parse(args));
}

export async function getToolManifest() {
  const { options } = await loadConfig({}, { requireTokens: false });
  const { name, version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  return {
    protocol: 1,
    serverInfo: { name, version, title: "Speechmatics Transcribe", description },
    tools: Object.entries(createTools(options)).map(([toolName, { definition }]) => ({
      ...definition,
      name: toolName,
      inputSchema: z.toJSONSchema(definition.inputSchema, { target: "draft-7" }),
    })),
  };
}
