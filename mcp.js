import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { runCli } from "./modules/cli-process.js";

async function createServer() {
  let manifest = await runCli("--tool-manifest");
  const server = new Server(manifest.serverInfo, {
    instructions: manifest.serverInfo.description,
    capabilities: { tools: { listChanged: true } },
  });
  server.setRequestHandler("tools/list", async () => {
    const latest = await runCli("--tool-manifest");
    const changed = JSON.stringify(latest.tools) !== JSON.stringify(manifest.tools);
    manifest = latest;
    if (changed) await server.sendToolListChanged();
    return { tools: manifest.tools };
  });
  server.setRequestHandler("tools/call", async ({ params }) => {
    try {
      return await runCli("--execute-tool", {
        protocol: 1, name: params.name, arguments: params.arguments ?? {},
      });
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ message: error.message }) }] };
    }
  });
  return server;
}

serveStdio(createServer);
