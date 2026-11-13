# Speechmatics Transcribe

Transcribe local audio and video files with Speechmatics using a CLI or MCP server.
Requires Node.js 22.12+. Optional MP3 conversion requires FFmpeg in PATH.

## Quick start

Set SPEECHMATICS_TOKENS in your environment, then run:

```sh
npx -y --prefer-online mcp-speechmatics-transcribe@latest recording.mp4
npx -y --prefer-online mcp-speechmatics-transcribe@latest --help
```

Alternatively, copy .env.example to a local .env, enter your tokens, and pass its path:

```sh
npx -y --prefer-online mcp-speechmatics-transcribe@latest --env-file /path/to/.env recording.mp4
```

Token entries are comma-separated. Each entry is a token or login:token.
Logins are optional. Keep credentials outside the repository.

## MCP

```json
{
  "mcpServers": {
    "mcp-speechmatics-transcribe": {
      "command": "npx",
      "args": ["-y", "--prefer-online", "mcp-speechmatics-transcribe@latest", "mcp"],
      "env": {
        "SPEECHMATICS_TOKENS": "YOUR_API_TOKEN"
      }
    }
  }
}
```

On Windows, clients that require an executable path can use npx.cmd.
For a local env file, insert --env-file and its absolute path before mcp.
Restart the MCP server to pick up a new package version. Allow enough tool time for
uploads and processing; the built-in API timeout is 900 seconds.

The transcribe tool requires an absolute file path. Optional parameters are model,
language, disableDiarization, audioEvents, convertToMp3, and timeoutSeconds.
Missing credentials are reported when the tool is called; tool discovery remains available.

## Configuration

Invocation arguments override process environment, followed by the selected env file
and built-in defaults. SPEECHMATICS_ENV_FILE or --env-file selects an env file.
Source installations otherwise load .env from the package directory.

| Variable | Default | Purpose |
| --- | --- | --- |
| SPEECHMATICS_TOKENS | Required | Comma-separated API tokens, optionally prefixed with login: |
| SPEECHMATICS_MODEL | enhanced | Transcription model |
| SPEECHMATICS_LANGUAGE | pl | Language code; use multi for multilingual models |
| SPEECHMATICS_DIARIZATION | speaker | Speaker attribution; MCP only exposes disabling it |
| SPEECHMATICS_AUDIO_EVENTS | true | Enable events for Standard and Enhanced |
| SPEECHMATICS_CONVERT_TO_MP3 | false | Convert non-MP3 input through FFmpeg |
| SPEECHMATICS_TIMEOUT_SECONDS | 900 | Upload and processing timeout in seconds |

Boolean environment variables accept true or false.

| Model | Use case |
| --- | --- |
| enhanced | Highest accuracy for a selected language |
| standard | Faster processing and archival transcription |
| melia-1 | Multilingual recordings and language switching; use language=multi |
| oak-1 | Multilingual healthcare recordings; use language=multi |

Melia 1 and Oak 1 support speaker diarization in Batch but do not support audio events.
Model capabilities are described in the [Speechmatics documentation](https://docs.speechmatics.com/speech-to-text/models).

## Output

Files are written under the operating system's temporary directory in
transcription/<input filename>/:

- Raw json-v2 transcript and segment JSON.
- WebVTT subtitles with voice spans such as <v.speaker S1>.
- Markdown with the filename, source folder, speaker labels, and paragraph start times.
- An MP3 copy when conversion is requested.

Markdown paragraphs split at sentence boundaries after 30 seconds or 80 words, or
when the speaker changes. Polish speaker and known event labels are retained for
the existing output format. Unknown speaker labels and event types are preserved.
Audio events appear in Markdown and WebVTT at confidence >=0.90.

The shared transcription/logs.json records status, elapsed time, job ID, and
token SHA-256. Token rotation skips credentials disabled after authentication,
entitlement, or exhausted-account-limit errors. HTTP 429 rate limits alone do not
disable a token. API errors are returned to the caller.

Audio is uploaded to Speechmatics in EU1. Transcription usage is billed by Speechmatics.
An API timeout can leave a remote job running; its ID is retained when available.

## Development and releases

```sh
npm ci
npm run check
npm run release:prepare
```

Source entry points are cli.js and mcp.js; shared code is under modules/.
A published GitHub Release triggers .github/workflows/release.yml. The tag must
match the package version. npm publishing uses GitHub OIDC after a trusted
publisher is configured for this repository and release.yml.

For the first publication, authenticate with npm login and publish the checked archive
from work/releases/ using npm publish with --access public.
The release workflow publishes stable versions under latest and prereleases under next.

## License

MIT. This project is an independent client and is not affiliated with Speechmatics.
