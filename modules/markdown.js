import { basename, dirname } from "node:path";
import { buildSegments } from "./segments.js";

function splitParagraph(segment, _nextEndTime, _nextWord, sentenceEnd) {
  if (!(sentenceEnd ?? /[.!?…][”"’')\]]*\s*$/u.test(segment.text))) return false;
  const duration = segment.endTime - segment.startTime;
  return duration >= 30 || segment.text.trim().split(/\s+/u).length >= 80;
}

function plainMarkdown(text) {
  return text.replace(/\s+/gu, " ").trim()
    .replace(/[\\`*_{}\[\]<>~$^|&#]/g, "\\$&")
    .replace(/^[+:%=\-]/, "\\$&")
    .replace(/^(\d+)([.)])(?=\s)/, "$1\\$2");
}

function startLabel(time) {
  if (!Number.isFinite(time) || time < 0) return "";
  const total = Math.floor(time);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return (hours ? `${hours}:` : "") + `${minutes}:${seconds}`;
}

export function buildMarkdown(input, transcript, audioEvents = []) {
  const folder = dirname(input);
  const { segments } = buildSegments(transcript, splitParagraph);
  const timeline = audioEvents.length
    ? [...segments, ...audioEvents].sort((first, second) => (first.startTime ?? Infinity) - (second.startTime ?? Infinity))
    : segments;
  const blocks = [
    `# ${plainMarkdown(basename(input))}`,
    `## ${plainMarkdown(basename(folder) || folder)}`,
  ];
  for (const { speaker, startTime, text } of timeline) {
    const body = plainMarkdown(text);
    if (!body) continue;
    const label = plainMarkdown(speaker?.replace(/^S([0-9]+)$/, "Rozm\u00f3wca $1") ?? "");
    const prefix = [label, startLabel(startTime)].filter(Boolean).join(" · ");
    blocks.push(prefix ? `**${prefix}** ${body}` : body);
  }
  return blocks.join("\n\n") + "\n";
}
