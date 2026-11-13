import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { optionFields } from "./modules/options.js";
import { loadConfig } from "./modules/config.js";
import { transcribe } from "./modules/transcribe.js";

const { options: configuredDefaults } = await loadConfig({}, { requireTokens: false });

function createServer() {
  const description = "Transkrybuje lokalne pliki audio i wideo przez Speechmatics Batch API.";
  const server = new McpServer({
    name: "speechmatics-transcribe",
    title: "Speechmatics Transcribe",
    version: "0.1.0",
    description,
  }, { instructions: description });
  server.registerTool("transcribe", {
    description: `${description} Zwraca ścieżki do surowego JSON, segmentów, napisów WebVTT i transkrypcji Markdown.`,
    inputSchema: z.strictObject({
      file: z.string().min(1).describe("Ścieżka do lokalnego pliku audio lub wideo. Użyj ścieżki bezwzględnej."),
      model: optionFields.model.optional().describe(`Domyślny model z konfiguracji: ${configuredDefaults.model}. enhanced: najwyższa dokładność dla wybranego języka. standard: szybsze przetwarzanie i archiwizacja. melia-1: MULTILANGUAGE, nagrania ze zmianą języka. oak-1: MULTILANGUAGE, wielojęzyczne nagrania medyczne. Dla melia-1 i oak-1 podaj language=multi. Te dwa modele nie obsługują zdarzeń dźwiękowych.`),
      language: optionFields.language.optional().describe(`Domyślny język z konfiguracji: ${configuredDefaults.language}. Kod języka, np. pl lub en, dla enhanced i standard. Dla modeli MULTILANGUAGE melia-1 i oak-1 ustaw multi.`),
      disableDiarization: z.boolean().optional().describe(`Domyślne rozróżnianie mówców z konfiguracji: ${configuredDefaults.diarization === "none" ? "wyłączone" : "włączone"}. true wyłącza diarizację. Pominięcie lub false stosuje ustawienie serwera.`),
      audioEvents: optionFields.audioEvents.optional().describe(`Domyślna wartość z konfiguracji: ${configuredDefaults.audioEvents}. Wykrywaj śmiech, muzykę i oklaski w Standard i Enhanced. W melia-1 i oak-1 funkcja jest automatycznie wyłączana. false wyłącza wykrywanie.`),
      convertToMp3: optionFields.convertToMp3.optional().describe(`Domyślna wartość z konfiguracji: ${configuredDefaults.convertToMp3}. Konwertuj pliki inne niż MP3 przez systemowy FFmpeg przed wysłaniem.`),
      timeoutSeconds: optionFields.timeoutSeconds.optional().describe(`Domyślny limit z konfiguracji: ${configuredDefaults.timeoutSeconds} sekund. Czas oczekiwania na wysłanie pliku i wynik API, niezależny od długości nagrania.`),
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
