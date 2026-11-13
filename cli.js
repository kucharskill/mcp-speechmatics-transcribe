import { Command, Option } from "commander";
import { defaults, optionFields } from "./options.js";
import { transcribe } from "./transcribe.js";

const program = new Command()
  .name("speechmatics")
  .description("Transkrybuje plik przez Speechmatics Batch API. Zapisuje JSON, WebVTT i Markdown.")
  .argument("<plik>", "Ścieżka do pliku audio lub wideo")
  .addOption(new Option("--model <model>", `Model (domyślnie ${defaults.model})`).choices(optionFields.model.options))
  .option("--language <kod>", `Język (domyślnie ${defaults.language})`)
  .addOption(new Option("--diarization <tryb>", `Diarizacja (domyślnie ${defaults.diarization})`).choices(optionFields.diarization.options))
  .option("--audio-events", "Wykrywaj śmiech, muzykę i oklaski w modelach Standard i Enhanced (domyślnie włączone)")
  .option("--no-audio-events", "Wyłącz wykrywanie zdarzeń dźwiękowych")
  .option("--convert-to-mp3", "Konwertuj wejście inne niż MP3 za pomocą ffmpeg")
  .option("--no-convert-to-mp3", "Wyłącz konwersję do MP3")
  .option("--timeout-seconds <sekundy>", `Limit czasu API (domyślnie ${defaults.timeoutSeconds} s)`, Number)
  .addHelpText("after", "\nKonfiguracja .env z katalogu projektu. Pierwszeństwo: flagi CLI, środowisko procesu, .env, wartości wbudowane.")
  .action(async (file, options) => {
    try {
      console.log(JSON.stringify(await transcribe(file, options), null, 2));
    } catch (error) {
      console.error(JSON.stringify(error.result ?? { message: error.message }, null, 2));
      process.exitCode = 1;
    }
  });

await program.parseAsync();
