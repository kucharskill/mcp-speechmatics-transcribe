import { executeTool } from "./tools.js";

export async function serveExecution() {
  try {
    let input = "";
    process.stdin.setEncoding("utf8");
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
