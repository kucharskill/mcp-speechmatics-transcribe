import { spawn, execFile } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";

export function dumpStartupEnvironment(directory = join(tmpdir(), "transcription", "discovery")) {
  const file = join(directory, "env-startup.jsonl");
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    appendFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), env: process.env }) + "\n", { mode: 0o600 });
    return file;
  } catch { /* A diagnostic snapshot must not prevent MCP startup. */ }
}

// Keep arguments and credentials on stdin/environment, outside the shell command.
export function resolveCliLaunch() {
  const modulePath = fileURLToPath(import.meta.url);
  const cachedPackage = /[\\/]_npx[\\/][^\\/]+[\\/]node_modules[\\/]mcp-speechmatics-transcribe[\\/]/i.test(modulePath);
  const npmExec = process.env.npm_command === "exec"
    || (!process.env.npm_command && process.env.npm_lifecycle_event === "npx");
  const useNpx = cachedPackage && npmExec;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_(package|call)$/i.test(key)));
  env.SPEECHMATICS_ENV_FILE = process.env.SPEECHMATICS_ENV_FILE
    ? resolve(process.env.SPEECHMATICS_ENV_FILE) : fileURLToPath(new URL("../.env", import.meta.url));
  return {
    command: useNpx ? "npx" : process.execPath,
    args: useNpx ? ["-y", "--prefer-online", "--package=mcp-speechmatics-transcribe@latest", "--", "mcp-speechmatics-transcribe"]
      : [fileURLToPath(new URL("../cli.js", import.meta.url))],
    cwd: process.cwd(), env, shell: useNpx && process.platform === "win32",
  };
}

export function runCli(mode, request, { launch = resolveCliLaunch(), signal } = {}) {
  return new Promise((done, reject) => {
    if (!["--tool-manifest", "--execute-tool"].includes(mode)) throw new Error("Unsupported CLI mode.");
    signal?.throwIfAborted();
    const launchArgs = [...launch.args, mode];
    const child = spawn(launch.shell ? launch.command + " " + launchArgs.join(" ") : launch.command, launch.shell ? [] : launchArgs, {
      shell: launch.shell, cwd: launch.cwd, windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"], env: launch.env,
    });
    const abort = () => {
      if (launch.shell && process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      } else child.kill();
      reject(new DOMException("CLI operation was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
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
    child.once("close", () => signal?.removeEventListener("abort", abort));
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

