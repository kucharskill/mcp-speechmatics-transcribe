import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { selectAudioEvents } from "./audio-events.js";
import { logPath, outputRoot, reserveToken, updateRecord } from "./history.js";
import { buildMarkdown } from "./markdown.js";
import { loadConfig } from "./config.js";
import { buildSegments } from "./segments.js";
import { ApiError, getTranscript, submitJob } from "./speechmatics.js";
import { buildWebVtt } from "./subtitles.js";
import { initializeUsage, refreshUsage, roundHours } from "./usage.js";

const ffmpeg = promisify(execFile);

async function convertAudio(input, output) {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0:a:0"];
  try {
    await ffmpeg("ffmpeg", [...args, "-c:a", "copy", output], { windowsHide: true });
    return "copy";
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("FFmpeg was not found in PATH.");
  }
  try {
    await ffmpeg("ffmpeg", [...args, "-c:a", "libmp3lame", "-q:a", "2", output], { windowsHide: true });
    return "encoded";
  } catch (error) {
    await rm(output, { force: true });
    throw new Error(`FFmpeg could not convert the file: ${error.stderr?.trim() || error.message}`);
  }
}

function writeJson(file, data) {
  return writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
}

export async function transcribe(file, overrides = {}) {
  const input = resolve(file);
  const inputName = basename(input);
  if (!(await stat(input)).isFile()) throw new Error(`Expected an audio or video file: ${input}`);
  const { tokens, options } = await loadConfig(overrides);
  options.audioEvents &&= ["standard", "enhanced"].includes(options.model);

  const started = Date.now();
  const id = randomUUID();
  const directory = join(outputRoot, inputName);
  const record = {
    id,
    fileName: inputName,
    startedAt: new Date(started).toISOString(),
    tokenSha256: null,
    model: options.model,
    language: options.language,
  };
  let candidate;
  let result;
  try {
    await mkdir(directory, { recursive: true });
    let convertedFile = null;
    let conversion = null;
    if (options.convertToMp3 && extname(input).toLowerCase() !== ".mp3") {
      convertedFile = join(directory, `audio-${id}.mp3`);
      conversion = await convertAudio(input, convertedFile);
    }
    await initializeUsage(tokens).catch(() => {});
    record.reservationExpiresAt = new Date(Date.now() + options.timeoutSeconds * 1000).toISOString();
    candidate = await reserveToken(tokens, record);
    if (!candidate) throw new Error("No active tokens remain. Check the log and SPEECHMATICS_TOKENS.");
    record.tokenSha256 = candidate.sha;

    const signal = AbortSignal.timeout(options.timeoutSeconds * 1000);
    record.jobId = await submitJob(convertedFile ?? input, candidate.token, options, signal);
    await updateRecord(record);
    const transcript = await getTranscript(record.jobId, candidate.token, signal);
    const transcriptFile = join(directory, `transcript-${id}.json`);
    const segmentsFile = join(directory, `segments-${id}.json`);
    const subtitlesFile = join(directory, `subtitles-${id}.vtt`);
    const markdownFile = join(directory, `transcript-${id}.md`);
    await writeJson(transcriptFile, transcript);
    const segments = buildSegments(transcript);
    const audioEvents = options.audioEvents ? selectAudioEvents(transcript) : [];
    await writeJson(segmentsFile, segments);
    await writeFile(subtitlesFile, buildWebVtt(transcript, audioEvents), { encoding: "utf8", flag: "wx" });
    await writeFile(markdownFile, buildMarkdown(input, transcript, audioEvents), { encoding: "utf8", flag: "wx" });
    record.audioDurationSeconds = transcript.job?.duration ?? null;
    record.audioDurationHours = record.audioDurationSeconds === null ? null : roundHours(record.audioDurationSeconds / 3600);
    result = {
      jobId: record.jobId, directory, transcriptFile, segmentsFile, subtitlesFile, markdownFile,
      convertedFile, conversion, speakers: segments.speakers, logPath,
    };
  } catch (error) {
    const redact = (value) => candidate ? value.replaceAll(candidate.token, "[token]") : value;
    record.status = "error";
    record.tokenDisabled = error instanceof ApiError && error.tokenDisabled;
    record.error = {
      message: redact(error.message),
      ...(error instanceof ApiError && {
        httpStatus: error.httpStatus,
        apiErrors: error.apiErrors.map(redact),
      }),
    };
  }
  record.finishedAt = new Date().toISOString();
  record.durationSeconds = (Date.now() - started) / 1000;
  record.status ??= "success";

  let logError;
  try {
    await updateRecord(record);
  } catch (error) {
    logError = error.message;
  }
  if (candidate) await refreshUsage(candidate).catch(() => {});
  if (record.error || logError) {
    const failure = record.error ?? { message: "Could not save the log." };
    throw Object.assign(new Error(failure.message), {
      result: {
        ...failure, ...(logError && { logError }), jobId: record.jobId,
        tokenSha256: record.tokenSha256, tokenDisabled: record.tokenDisabled ?? false, logPath,
      },
    });
  }
  return result;
}
