import { z } from "zod";

export const defaults = {
  model: "enhanced",
  language: "pl",
  diarization: "speaker",
  audioEvents: true,
  convertToMp3: false,
  timeoutSeconds: 900,
};

export const optionFields = {
  model: z.enum(["standard", "enhanced", "melia-1", "oak-1"]),
  language: z.string().trim().min(1),
  diarization: z.enum(["none", "speaker", "channel"]),
  audioEvents: z.boolean(),
  convertToMp3: z.boolean(),
  timeoutSeconds: z.int().positive().max(86400),
};

export const optionsSchema = z.strictObject(optionFields);
