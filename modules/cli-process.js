import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep arguments and credentials on stdin/environment, outside the shell command.
export function runCli(mode, request) {
  return new Promise((done, reject) => {
    if (!["--tool-manifest", "--execute-tool"].includes(mode)) throw new Error("Unsupported CLI mode.");
    const modulePath = fileURLToPath(import.meta.url);
    const cachedPackage = /[\\/]_npx[\\/][^\\/]+[\\/]node_modules[\\/]mcp-speechmatics-transcribe[\\/]/i.test(modulePath);
    const npmExec = process.env.npm_command === "exec"
      || (!process.env.npm_command && process.env.npm_lifecycle_event === "npx");
    const useNpx = cachedPackage && npmExec;
    const launchArgs = useNpx
      ? ["-y", "--prefer-online", "--package=mcp-speechmatics-transcribe@latest", "--", "mcp-speechmatics-transcribe", mode]
      : [fileURLToPath(new URL("../cli.js", import.meta.url)), mode];
    const windowsShell = useNpx && process.platform === "win32";
    const environment = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !/^npm_config_(package|call)$/i.test(key)));
    const command = useNpx ? "npx" : process.execPath;
    const child = spawn(windowsShell ? command + " " + launchArgs.join(" ") : command, windowsShell ? [] : launchArgs, {
      shell: windowsShell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...environment,
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

