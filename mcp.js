import { Server, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { runCli, resolveCliLaunch, dumpStartupEnvironment } from "./modules/cli-process.js";
import { createDiscoveryCache } from "./modules/discovery-cache.js";

dumpStartupEnvironment();
const launch = resolveCliLaunch();
const discovery = createDiscoveryCache(launch, () => runCli("--tool-manifest", undefined, { launch }));
let era;
let invalidation = Promise.resolve();
class LocalTransport extends StdioServerTransport {
  async start() {
    const dispatch = this.onmessage;
    this.onmessage = (message, extra) => {
      const modern = message.params?._meta && Object.hasOwn(message.params._meta, PROTOCOL_VERSION_META_KEY);
      if (era !== "modern" && !modern && message.jsonrpc === "2.0" && message.method === "ping"
        && (typeof message.id === "string" || typeof message.id === "number")) {
        this.send({ jsonrpc: "2.0", id: message.id, result: {} }).catch((error) => this.onerror?.(error));
        return;
      }
      if (message.method === "notifications/tools/list_changed" && message.id === undefined) {
        invalidation = discovery.invalidate();
        return;
      }
      dispatch?.(message, extra);
    };
    return super.start();
  }
}

async function createServer(context) {
  era = context.era;
  await invalidation;
  let manifest = await discovery.get();
  const server = new Server(manifest.serverInfo, {
    instructions: manifest.serverInfo.description,
    capabilities: { tools: { listChanged: true } },
  });
  server.setRequestHandler("tools/list", async () => {
    await invalidation;
    const latest = await discovery.get();
    const changed = JSON.stringify(latest.tools) !== JSON.stringify(manifest.tools);
    manifest = latest;
    if (changed) {
      await discovery.invalidate();
      await server.sendToolListChanged();
    }
    const { protocol, serverInfo, ...result } = manifest;
    return result;
  });
  server.setRequestHandler("tools/call", async ({ params }, context) => {
    try {
      return await runCli("--execute-tool", {
        protocol: 1, name: params.name, arguments: params.arguments ?? {},
      }, { signal: context?.mcpReq.signal });
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ message: error.message }) }] };
    }
  });
  return server;
}

serveStdio(createServer, { transport: new LocalTransport() });
