export function buildSegments(transcript, splitBeforeWord) {
  if (!Array.isArray(transcript.results)) throw new Error("Missing results array in the json-v2 transcript.");

  const segments = [];
  let current;
  let joinNext = false;
  let sentenceEnd;
  for (const result of transcript.results) {
    const { type, start_time: startTime, end_time: endTime } = result;
    const alternative = result.alternatives?.[0];
    if (!alternative?.content || !["word", "punctuation"].includes(type)) continue;

    const speaker = alternative.speaker ?? current?.speaker ?? null;
    if (!current || (type === "word" && (
      current.speaker !== speaker || (!joinNext && splitBeforeWord?.(current, endTime, alternative.content, sentenceEnd))
    ))) {
      current = { speaker, startTime: startTime ?? null, endTime: endTime ?? null, text: "" };
      segments.push(current);
      joinNext = false;
    }
    const punctuation = type === "punctuation";
    const attachesTo = result.attaches_to ?? "previous";
    const joinPrevious = punctuation && ["previous", "both"].includes(attachesTo);
    const space = current.text && !joinNext && !joinPrevious ? " " : "";
    current.text += space + alternative.content;
    if (Number.isFinite(endTime)) current.endTime = Math.max(current.endTime ?? endTime, endTime);
    joinNext = punctuation && ["next", "both"].includes(attachesTo);
    if (!punctuation) sentenceEnd = undefined;
    else if (sentenceEnd !== true && typeof result.is_eos === "boolean") sentenceEnd = result.is_eos;
  }
  return { speakers: [...new Set(segments.map(({ speaker }) => speaker).filter(Boolean))], segments };
}
