# Speechmatics Tools

- Projekt Node.js (ESM, Node.js >=22.12) do transkrypcji wsadowej lokalnych plików audio i wideo przez Speechmatics Batch API v2 w regionie EU1.
- CLI korzysta z Commandera. Pomoc jest dostępna przez `node cli.js --help`. Lokalny serwer MCP uruchamia się przez `node mcp.js` i udostępnia narzędzie `transcribe` przez stdio.
- W MCP agent może wyłączyć diarizację przez `disableDiarization: true`. Pominięcie flagi albo `false` stosuje ustawienie serwera. Tryb diarizacji wybiera się przez CLI lub ustawienia lokalne.
- CLI i MCP korzystają ze wspólnej funkcji w `transcribe.js`. Domyślne ustawienia w `options.js` to model `enhanced`, język `pl`, diarizacja `speaker`, limit oczekiwania na API 900 sekund i wyłączona konwersja MP3. Konfigurację wczytuje `config.js` przez dotenv i waliduje Zod. Pierwszeństwo mają argumenty wywołania, środowisko procesu, projektowy `.env`, a następnie wartości wbudowane. Wzór zmiennych zawiera `.env.example`.
- Wyniki trafiają do `%TEMP%\transcription\<nazwa pliku>\` jako surowy `json-v2`, JSON segmentów, napisy WebVTT ze znacznikiem `<v.speaker S1>` i Markdown. Markdown ma H1 z nazwą pliku, H2 z nazwą folderu źródłowego i zwykłe akapity z mówcą oraz czasem początku. Tylko etykiety pasujące do `^S[0-9]+$` są wyświetlane jako `Rozmówca <liczba>`. Opcjonalna konwersja korzysta z FFmpeg w PATH. Kopiuje ścieżkę audio, jeśli jest już w formacie MP3, a w przeciwnym razie ją koduje.
- Klucze są w zmiennej `SPEECHMATICS_TOKENS` w formacie `login:token,token,:token`. Login jest opcjonalny, token musi być niepusty. Pierwszy dwukropek rozdziela login od tokena, a przecinki rozdzielają wpisy. Zmienna jest wymagana. Plik `.env` zawiera sekrety i jest ignorowany przez Git. Wspólny log `%TEMP%\transcription\logs.json` przechowuje SHA-256 użytego tokena, stan i czas wykonania oraz ewentualny błąd. Rotacja pomija tokeny wykluczone po błędzie autoryzacji, uprawnień lub wyczerpaniu limitu konta.
- Wykrywanie zdarzeń dźwiękowych jest domyślnie włączone dla modeli Standard i Enhanced. Do Markdown i WebVTT trafiają zdarzenia z pewnością co najmniej 0,90. `laughter`, `music` i `applause` mają polskie etykiety, a pozostałe typy zachowują nazwę z API. Wyłączenie przez `--no-audio-events` w CLI lub `audioEvents: false` w MCP albo w ustawieniach domyślnych.

## Git

Repozytorium Git służy agentowi do prowadzenia historii pracy nad projektem. Agent odpowiada za jej aktualność i zapisuje trwałe zmiany w commicie po każdym zakończonym etapie pracy, zgodnie z globalnymi zasadami Git.

## Pytania i decyzje

Gdy użytkownik pyta o podejście, format, wariant albo prosi o opinię, odpowiedz zwięźle i przedstaw propozycję. Poczekaj z wdrożeniem na akceptację albo wyraźne polecenie. Jeśli wiadomość łączy polecenie z pytaniem o szczegół, wykonaj niezależną część polecenia, a szczegół pozostaw do decyzji.
