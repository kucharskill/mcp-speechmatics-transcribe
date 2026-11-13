import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";

for (const file of ["cli.js", "mcp.js", ...(await readdir("modules")).map((name) => "modules/" + name)]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
execFileSync(process.execPath, ["--test", "tests/integration.test.mjs"], { stdio: "inherit" });
