import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep arguments and credentials on stdin/environment, outside the shell command.
export function runCli(mode, request) {
  return new Promise((done, reject) => {
    if (!["--tool-manifest", "--execute-tool"].includes(mode)) throw new Error("Unsupported CLI mode.");
    const launchArgs = ["-y", "--prefer-online", "mcp-speechmatics-transcribe@latest", mode];
    const windows = process.platform === "win32";
    const child = spawn(windows ? "npx " + launchArgs.join(" ") : "npx", windows ? [] : launchArgs, {
      shell: windows,
      windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        SPEECHMATICS_ENV_FILE: process.env.SPEECHMATICS_ENV_FILE
          ? resolve(process.env.SPEECHMATICS_ENV_FILE)
          : fileURLToPath(new URL("../.env", import.meta.url)),
      },
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) {
        child.kill();
        reject(new Error("CLI process response exceeded 1 MiB."));
      }
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`CLI process exited with ${signal ?? code}.`));
        return;
      }
      try {
        const result = JSON.parse(output);
        if (mode === "--tool-manifest") {
          if (result.protocol !== 1 || !Array.isArray(result.tools) || !result.serverInfo) throw new Error("Invalid tool manifest.");
        } else if (!Array.isArray(result?.content)) {
          throw new Error("Missing tool content.");
        }
        done(result);
      } catch {
        reject(new Error("CLI process returned an invalid response. Check npm connectivity and the published package version."));
      }
    });
    child.stdin.end(request ? JSON.stringify(request) : undefined);
  });
}

