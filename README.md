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
      "args": ["-y", "--prefer-online", "mcp-speechmatics-transcribe@latest"],
      "env": {
        "SPEECHMATICS_TOKENS": "YOUR_API_TOKEN"
      }
    }
  }
}
```

On Windows, clients that require an executable path can use npx.cmd.
For a local env file, append --env-file and its absolute path.
With no file argument, the command starts the MCP server; the explicit mcp subcommand
remains supported. MCP is a thin adapter: it obtains tool definitions from the CLI
at startup and on every tools/list request, then forwards each tools/call to a
separate CLI process. An npx-managed installation resolves the latest published CLI
through npx, reusing npm's cache. Local launches, including npm scripts, use the CLI
from the same installation through the current Node.js executable. Ambiguous
launches use the same-installation CLI.
Changes detected during discovery emit notifications/tools/list_changed. Clients
must request the tool list to discover updates; no background polling is performed.
In-flight calls continue with their starting version. The CLI inherits the
environment and selected env-file path; execution arguments travel over stdin.
CLI startup or network failures are reported without stopping an established MCP
connection. Startup discovery must succeed before the MCP connection is initialized.
Allow enough tool time for npm startup,
uploads and processing; the built-in API timeout is 900 seconds.

The transcribe tool requires an absolute file path. Optional parameters are model,
language, disableDiarization, audioEvents, convertToMp3, and timeoutSeconds.
Missing credentials are reported when the tool is called; tool discovery remains available.

## Machine-readable CLI

`--tool-manifest` prints a JSON document containing `protocol: 1`,
`serverInfo`, and `tools` with MCP-compatible names, descriptions, and JSON Schemas.
It does not require API credentials. `--execute-tool` reads one JSON request from
stdin and prints one MCP-compatible tool result to stdout:

```json
{"protocol":1,"name":"transcribe","arguments":{"file":"/path/to/recording.mp3"}}
```

Execution validates arguments against the same definitions used by the manifest.
Tool failures return `isError: true` and text content. Human-facing file commands
retain their existing output and exit-code behavior. Internal `--worker` remains
an alias for execution. CLI and MCP are distributed together in the same package;
the adapter contains no transcription-specific schemas or execution logic.

## Configuration

The read-only `token_status` tool checks all configured tokens through the EU1
Batch usage endpoint. Optional `since` and `until` dates use YYYY-MM-DD; the default
start is the first day of the current UTC month and the default end is today in UTC,
explicitly including the current day's usage. Results identify each key by its
configured login or a masked token. Excluded keys return `excluded` without an API
request. Successful requests return `active` and the API's usage fields directly;
failures return `error` with available HTTP details. Short anonymous tokens are fully
masked. No raw token or token hash is returned.

Usage reflects the scope reported by Speechmatics and is not attributed exclusively
to an individual key. Successful access does not guarantee funds for another job.
Credits are omitted because the public usage API does not provide a balance.
Status checks do not update logs, rotation, or exclusions.

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
token SHA-256. Tokens are selected in round-robin order across transcription
requests. Token rotation skips credentials disabled after authentication,
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
from .tmp/releases/ using npm publish with --access public.
The release workflow publishes stable versions under latest and prereleases under next.

## License

MIT. This project is an independent client and is not affiliated with Speechmatics.
