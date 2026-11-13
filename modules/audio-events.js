const minimumConfidence = 0.9;
const labels = new Map([
  ["applause", "Oklaski"],
  ["laughter", "\u015amiech"],
  ["music", "Muzyka"],
]);

export function selectAudioEvents(transcript) {
  if (!Array.isArray(transcript.audio_events)) return [];

  return transcript.audio_events
    .filter(({ type, start_time, end_time, confidence }) =>
      typeof type === "string" && type.trim().length > 0
      && Number.isFinite(start_time) && start_time >= 0
      && Number.isFinite(end_time) && end_time > start_time
      && Number.isFinite(confidence) && confidence >= minimumConfidence && confidence <= 1)
    .map(({ type, start_time, end_time }) => ({
      startTime: start_time,
      endTime: end_time,
      text: `[${labels.get(type) ?? type}]`,
    }));
}
