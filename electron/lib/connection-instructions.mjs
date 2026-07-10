export function connectionInstructions(brain) {
  const endpoint = `http://${brain.host || '127.0.0.1'}:${brain.port}/mcp`;
  return {
    endpoint,
    generic: `Add an HTTP MCP server named "${brain.name}" with URL:\n${endpoint}`,
    codex: `codex mcp add ${safeAlias(brain.name)} --url ${endpoint}`,
    claude: `claude mcp add --transport http ${safeAlias(brain.name)} ${endpoint}`,
    json: JSON.stringify({ mcpServers: { [safeAlias(brain.name)]: { type: 'http', url: endpoint } } }, null, 2),
  };
}

function safeAlias(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bigbrain';
}
