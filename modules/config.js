import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import { defaults, optionsSchema } from "./options.js";

const booleanSetting = z.enum(["true", "false"]).transform((value) => value === "true");
const environmentSchema = z.object({
  SPEECHMATICS_MODEL: z.string().optional(),
  SPEECHMATICS_LANGUAGE: z.string().optional(),
  SPEECHMATICS_DIARIZATION: z.string().optional(),
  SPEECHMATICS_AUDIO_EVENTS: booleanSetting.optional(),
  SPEECHMATICS_CONVERT_TO_MP3: booleanSetting.optional(),
  SPEECHMATICS_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
});
const tokenSchema = z.array(z.object({
  login: z.string().optional(),
  token: z.string().trim().min(1),
})).min(1);

export function parseTokens(source) {
  const tokens = source.split(",").map((entry) => {
    const separator = entry.indexOf(":");
    return separator === -1
      ? { token: entry.trim() }
      : { login: entry.slice(0, separator).trim(), token: entry.slice(separator + 1).trim() };
  });
  const parsed = tokenSchema.safeParse(tokens);
  if (!parsed.success) throw new Error("SPEECHMATICS_TOKENS contains an empty token. Use token or login:token, separated by commas.");
  return parsed.data;
}

export async function loadConfig(overrides = {}, { requireTokens = true } = {}) {
  const environment = { ...process.env };
  const loaded = dotenv.config({
    path: process.env.SPEECHMATICS_ENV_FILE ?? fileURLToPath(new URL("../.env", import.meta.url)),
    processEnv: environment,
    quiet: true,
  });
  if (loaded.error && loaded.error.code !== "ENOENT") throw loaded.error;

  if (requireTokens && environment.SPEECHMATICS_TOKENS === undefined) {
    throw new Error("Set SPEECHMATICS_TOKENS in the process environment or .env file.");
  }
  const tokens = requireTokens ? parseTokens(environment.SPEECHMATICS_TOKENS) : [];
  const env = environmentSchema.parse(environment);
  const environmentOptions = {
    model: env.SPEECHMATICS_MODEL,
    language: env.SPEECHMATICS_LANGUAGE,
    diarization: env.SPEECHMATICS_DIARIZATION,
    audioEvents: env.SPEECHMATICS_AUDIO_EVENTS,
    convertToMp3: env.SPEECHMATICS_CONVERT_TO_MP3,
    timeoutSeconds: env.SPEECHMATICS_TIMEOUT_SECONDS,
  };
  const defined = (values) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  const options = optionsSchema.parse({
    ...defaults, ...defined(environmentOptions), ...defined(overrides),
  });
  return { tokens, options };
}
