import { buildSegments } from "./segments.js";

function splitCue(cue, nextEndTime, nextWord) {
  return nextEndTime - cue.startTime > 6 || cue.text.length + 1 + nextWord.length > 84;
}

function timestamp(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
    + "." + String(milliseconds % 1000).padStart(3, "0");
}

function escapeCueText(text) {
  return text.replace(/\s+/g, " ").trim()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildWebVtt(transcript, audioEvents = []) {
  const { segments } = buildSegments(transcript, splitCue);
  const cues = [...segments, ...audioEvents]
    .filter(({ startTime, endTime }) =>
      Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime && endTime >= 0)
    .sort((first, second) => first.startTime - second.startTime)
    .map(({ startTime, endTime, speaker, text }) => {
      const start = Math.max(0, Math.round(startTime * 1000));
      const end = Math.max(start + 1, Math.round(endTime * 1000));
      const payload = escapeCueText(text);
      if (!payload) return "";
      const voice = escapeCueText(speaker ?? "");
      return `${timestamp(start)} --> ${timestamp(end)}\n${voice ? `<v.speaker ${voice}>${payload}</v>` : payload}`;
    })
    .filter(Boolean);
  return "WEBVTT\n\n" + (cues.length ? cues.join("\n\n") + "\n" : "");
}
