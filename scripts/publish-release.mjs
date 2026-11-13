import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (process.env.RELEASE_TAG !== `v${pkg.version}`) throw new Error("Release tag must match package.json.");
const repository = `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`;
if (pkg.repository.url !== repository) throw new Error("Publishing repository mismatch.");
const prerelease = pkg.version.includes("-");
if (String(prerelease) !== process.env.RELEASE_PRERELEASE) throw new Error("Prerelease flag mismatch.");
const archive = process.env.PACKAGE_ARCHIVE;
if (!archive) throw new Error("PACKAGE_ARCHIVE is required.");
const integrity = "sha512-" + createHash("sha512").update(await readFile(archive)).digest("base64");
const response = await fetch(`https://registry.npmjs.org/${pkg.name}/${pkg.version}`);
if (response.ok) {
  if ((await response.json()).dist?.integrity !== integrity) throw new Error("This version has different published contents.");
  console.log("This archive is already published.");
} else {
  if (response.status !== 404) throw new Error(`npm HTTP ${response.status}`);
  execFileSync(process.execPath, [
    process.env.npm_execpath, "publish", archive, "--access", "public",
    "--tag", prerelease ? "next" : "latest", "--provenance",
  ], { stdio: "inherit" });
}
