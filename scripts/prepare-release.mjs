import { execFileSync } from "node:child_process";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const destination = "work/releases";
await mkdir(destination, { recursive: true });
const packedResult = JSON.parse(execFileSync(process.execPath, [
  process.env.npm_execpath, "pack", "--json", "--ignore-scripts", "--pack-destination", destination,
], { encoding: "utf8" }));
const packed = Array.isArray(packedResult) ? packedResult[0] : packedResult[pkg.name];
const expected = [
  "package.json", "cli.js", "mcp.js", "README.md", "LICENSE", ".env.example",
  "modules/audio-events.js", "modules/config.js", "modules/history.js", "modules/markdown.js",
  "modules/options.js", "modules/segments.js", "modules/speechmatics.js",
  "modules/subtitles.js", "modules/transcribe.js",
].sort();
const actual = packed.files.map(({ path }) => path).sort();
if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Unexpected files in the npm archive.");
if (packed.name !== pkg.name || packed.version !== pkg.version) throw new Error("Package metadata mismatch.");
const archive = join(destination, packed.filename);
const integrity = "sha512-" + createHash("sha512").update(await readFile(archive)).digest("base64");
if (integrity !== packed.integrity) throw new Error("Archive integrity mismatch.");
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `archive=${archive}\n`);
console.log(JSON.stringify({ archive, integrity, files: actual }, null, 2));
