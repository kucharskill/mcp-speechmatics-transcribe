# Speechmatics Transcribe

CLI i lokalny serwer MCP do transkrypcji plików audio i wideo przez Speechmatics Batch API.

## Uruchomienie

Wymagany Node.js >=22.12.0. Opcjonalna konwersja do MP3 wymaga FFmpeg w PATH.

```powershell
npm ci
Copy-Item .env.example .env
```

Wpisz klucze API w `.env` jako `SPEECHMATICS_TOKENS="login:token,token"`.
Login jest opcjonalny. Plik `.env` jest ignorowany przez Git.

```powershell
node cli.js --help
node cli.js "E:\nagrania\rozmowa.mp4"
node cli.js "E:\nagrania\rozmowa.mp4" --convert-to-mp3
```

Serwer MCP uruchamia się przez `node mcp.js` i udostępnia narzędzie `transcribe` przez stdio.
W kliencie MCP ustaw polecenie `node` i bezwzględną ścieżkę do `mcp.js` jako argument.
Wymaganym parametrem narzędzia jest `file`, zawierający ścieżkę do nagrania.

## Konfiguracja i wyniki

Wzór ustawień zawiera `.env.example`. Pierwszeństwo mają argumenty CLI/MCP, zmienne środowiskowe procesu, projektowy `.env`, a następnie wartości wbudowane.

Wyniki trafiają do `%TEMP%\transcription\<nazwa pliku>\` jako surowy JSON, JSON segmentów, WebVTT i Markdown. Konwersja zapisuje tam również MP3. Wspólny log `%TEMP%\transcription\logs.json` służy do rotacji tokenów i rejestruje ich SHA-256.

## Struktura

- `cli.js` i `mcp.js` uruchamiają interfejsy.
- `modules/` zawiera konfigurację, komunikację z API, rotację tokenów i eksport wyników.
