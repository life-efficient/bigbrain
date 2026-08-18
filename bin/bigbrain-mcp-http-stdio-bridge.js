#!/usr/bin/env node
import { StdioHttpMcpBridge } from '../src/bigbrain/mcp-http-stdio-bridge.js';

const [endpoint, tokenPath] = process.argv.slice(2);

try {
  const bridge = new StdioHttpMcpBridge({ endpoint, tokenPath });
  await bridge.run();
} catch (error) {
  // Keep stderr diagnostic-only. Token contents and remote bodies are never
  // included in bridge errors.
  process.stderr.write(`BigBrain MCP bridge failed: ${String(error?.message || 'Unknown error')}\n`);
  process.exitCode = 1;
}
