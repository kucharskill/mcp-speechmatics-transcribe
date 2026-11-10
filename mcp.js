import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { defaults, optionFields } from "./options.js";
import { transcribe } from "./transcribe.js";

function createServer() {
  const server = new McpServer({ name: "speechmatics-tools", version: "0.1.0" });
  server.registerTool("transcribe", {
    description: "Transkrybuje lokalny plik przez Speechmatics Batch API. Zwraca ścieżki do surowego JSON, segmentów, napisów WebVTT i transkrypcji Markdown.",
    inputSchema: z.strictObject({
      file: z.string().min(1).describe("Ścieżka do lokalnego pliku audio lub wideo. Użyj ścieżki bezwzględnej."),
      model: optionFields.model.optional().describe(`Model, domyślnie ${defaults.model}.`),
      language: optionFields.language.optional().describe(`Kod języka, domyślnie ${defaults.language}.`),
      disableDiarization: z.boolean().optional().describe("Domyślnie serwer rozróżnia mówców. Ustaw true, aby wyłączyć diarizację. Pominięcie lub false stosuje ustawienie serwera."),
      audioEvents: optionFields.audioEvents.optional().describe("Wykrywaj śmiech, muzykę i oklaski w modelach Standard i Enhanced. Domyślnie true, false wyłącza wykrywanie."),
      convertToMp3: optionFields.convertToMp3.optional().describe("Konwertuj wejście inne niż MP3 za pomocą ffmpeg, domyślnie false."),
      timeoutSeconds: optionFields.timeoutSeconds.optional().describe(`Limit czasu API w sekundach, domyślnie ${defaults.timeoutSeconds}.`),
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
