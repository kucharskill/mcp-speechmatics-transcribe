import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { readFile } from "node:fs/promises";
import { createTools, description } from "./modules/tools.js";
import { loadConfig } from "./modules/config.js";
import { runWorker } from "./modules/worker.js";

const { options: configuredDefaults } = await loadConfig({}, { requireTokens: false });
const { version } = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));

function createServer() {
  const server = new McpServer({
    name: "mcp-speechmatics-transcribe",
    title: "Speechmatics Transcribe",
    version,
    description,
  }, { instructions: description });
  for (const [name, { definition }] of Object.entries(createTools(configuredDefaults))) {
    server.registerTool(name, definition, async (args) => {
      try {
        return await runWorker(name, args);
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ message: error.message }) }] };
      }
    });
  }
  return server;
}

serveStdio(createServer);
