import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeTool } from "./tools.js";

// Keep arguments and credentials on stdin/environment, outside the shell command.
export function runWorker(name, args) {
  return new Promise((done, reject) => {
    const launchArgs = ["-y", "--prefer-online", "mcp-speechmatics-transcribe@latest", "--worker"];
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
        reject(new Error("Worker response exceeded 1 MiB."));
      }
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`Worker exited with ${signal ?? code}.`));
        return;
      }
      try {
        const result = JSON.parse(output);
        if (!Array.isArray(result?.content)) throw new Error("Missing tool content.");
        done(result);
      } catch {
        reject(new Error("Worker returned an invalid response. Check npm connectivity and the published package version."));
      }
    });
    child.stdin.end(JSON.stringify({ protocol: 1, name, arguments: args }));
  });
}

export async function serveWorker() {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024 * 1024) throw new Error("Worker request exceeded 1 MiB.");
    }
    const request = JSON.parse(input);
    if (request.protocol !== 1) throw new Error("Unsupported worker protocol.");
    const result = await executeTool(request.name, request.arguments);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({
      isError: true,
      content: [{ type: "text", text: JSON.stringify(error.result ?? { message: error.message }) }],
    }) + "\n");
  }
}
