import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const endpoint = "https://eu1.asr.api.speechmatics.com";

export class ApiError extends Error {
  constructor(message, httpStatus = null, apiErrors = []) {
    super(message);
    this.httpStatus = httpStatus;
    this.apiErrors = apiErrors;
    this.tokenDisabled = [401, 402, 403].includes(httpStatus)
      || /\b(?:quota|credits?|balance|usage limit|spend limit)\b.{0,55}\b(?:exceeded|exhausted|depleted|reached|insufficient)\b|\b(?:out of|insufficient|no remaining)\s+(?:credits?|balance)\b/i
        .test([message, ...apiErrors].join(" ").replaceAll("_", " "));
  }
}

async function request(path, token, signal, body) {
  let response;
  try {
    response = await fetch(endpoint + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}` },
      body,
      signal,
      redirect: "error",
    });
  } catch (error) {
    if (signal.aborted) throw new ApiError("Timed out waiting for Speechmatics.");
    throw new ApiError(`Could not connect to Speechmatics (${error.cause?.code ?? error.name}).`);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const details = [data?.error, data?.detail, data?.message, data?.type]
      .filter((value) => typeof value === "string");
    throw new ApiError(
      `Speechmatics HTTP ${response.status}: ${details.join(" | ") || response.statusText || "API error"}`,
      response.status,
    );
  }
  if (!data) {
    const message = signal.aborted
      ? "Timed out waiting for Speechmatics."
      : "Speechmatics returned invalid JSON.";
    throw new ApiError(message);
  }
  return data;
}

export async function submitJob(file, token, options, signal) {
  const form = new FormData();
  form.append("data_file", await openAsBlob(file), basename(file));
  form.append("config", JSON.stringify({
    type: "transcription",
    ...(options.audioEvents && { audio_events_config: {} }),
    transcription_config: {
      model: options.model,
      language: options.language,
      diarization: options.diarization,
    },
  }));
  const { id } = await request("/v2/jobs", token, signal, form);
  if (typeof id !== "string" || !id) throw new ApiError("Speechmatics did not return a job ID.");
  return id;
}

export async function getTranscript(id, token, signal) {
  const jobPath = `/v2/jobs/${encodeURIComponent(id)}`;
  while (!signal.aborted) {
    const { job } = await request(jobPath, token, signal);
    if (job?.status === "done") {
      return request(jobPath + "/transcript?format=json-v2", token, signal);
    }
    if (!["running", "created", "queued"].includes(job?.status)) {
      const errors = Array.isArray(job?.errors) ? job.errors.map((error) =>
        typeof error === "string" ? error : JSON.stringify(error)) : [];
      throw new ApiError(`Speechmatics finished the job with status ${job?.status ?? "unknown"}.`, null, errors);
    }
    await delay(3000, undefined, { signal }).catch((error) => {
      if (!signal.aborted) throw error;
    });
  }
  throw new ApiError("Timed out waiting for Speechmatics.");
}
