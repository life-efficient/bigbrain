export function connectionInstructions(brain) {
  const endpoint = brain.mcpUrl || `http://${brain.host || '127.0.0.1'}:${brain.port}/mcp`;
  const alias = safeAlias(brain.name);
  return {
    endpoint,
    generic: `Add an HTTP MCP server named "${brain.name}" with URL:\n${endpoint}`,
    codex: `codex mcp add ${alias} --url ${endpoint}`,
    claude: `claude mcp add --transport http ${alias} ${endpoint}`,
    json: JSON.stringify({ mcpServers: { [alias]: { type: 'http', url: endpoint } } }, null, 2),
    handoff: `Connect to my private local BigBrain brain named "${brain.name}" using the HTTP MCP server at:\n${endpoint}\n\nFirst call initialize and confirm that the server identifies itself as "${brain.name}". Use this brain only for the knowledge and work I explicitly ask you to store here. Do not connect to, copy from, or write to another brain unless I explicitly instruct you to.\n\nIf you are using Codex CLI, add it with:\n${`codex mcp add ${alias} --url ${endpoint}`}`,
  };
}

function safeAlias(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bigbrain';
}
