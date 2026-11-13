# Speechmatics Tools

- Node.js project using ESM and Node.js >=22.12 for batch transcription of local audio and video files through the Speechmatics Batch API v2 in EU1.
- The CLI uses Commander. Run `node cli.js --help` for usage. Run `node mcp.js` to expose the `transcribe` tool over stdio.
- MCP supports `disableDiarization: true` to disable speaker diarization. Omitting this option or passing false uses the server setting. The diarization mode is configured through the CLI or local environment.
- Both interfaces use `modules/transcribe.js`. Built-in defaults in `modules/options.js` are enhanced, pl, speaker diarization, a 900-second API timeout, and MP3 conversion disabled. Configuration is loaded by dotenv and validated by Zod in `modules/config.js`. Precedence is invocation arguments, process environment, project .env, and built-in defaults. See `.env.example` for supported variables.
- Output files are written to `%TEMP%\transcription\<input filename>\` as raw json-v2, segment JSON, WebVTT, and Markdown. WebVTT uses voice spans such as `<v.speaker S1>`. Markdown uses the filename as H1, the source folder as H2, and paragraphs prefixed with speaker labels and start times. Labels matching `^S[0-9]+$` receive a localized speaker label. Paragraphs split at sentence boundaries after 30 seconds or 80 words, or immediately when the speaker changes.
- Optional MP3 conversion uses FFmpeg from PATH. Existing MP3 audio streams are copied when possible; other audio is encoded.
- `SPEECHMATICS_TOKENS` is required for transcription and accepts `login:token,token,:token`. Logins are optional and tokens must be nonempty. The first colon separates login from token; commas separate entries. The local .env contains secrets and is ignored by Git. MCP can list tools without tokens and reports missing credentials when transcription is called.
- `%TEMP%\transcription\logs.json` records token SHA-256, execution status, duration, and errors. Rotation skips tokens disabled after authentication, entitlement, or exhausted-account-limit errors.
- Audio events are enabled by default for Standard and Enhanced. Markdown and WebVTT include events with confidence >=0.90. Known event types receive localized labels; other types retain the API value. Disable events with `--no-audio-events` or `audioEvents: false`.

## GitHub content

Use English for all content published to GitHub, including source code strings, comments, documentation, configuration examples, filenames, commit messages, pull requests, and issues. Review changes for Polish text before publishing.

Public content must describe the software and its behavior without references to AI-assisted development, coding assistants, chat sessions, or conversation history. Keep implementation notes and change descriptions focused on the technical result.

## Git

Maintain an up-to-date project history by committing completed changes in logical increments, following the global Git rules. Preserve existing commit history.

## Questions and decisions

Answer questions about approaches, formats, or alternatives with a concise proposal. Implement after acceptance or an explicit instruction. When a request combines an implementation instruction with an unresolved design question, complete the independent work and leave that design choice for confirmation.
