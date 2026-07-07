export const CODEX_MCP_TOOL_GROUPS = Object.freeze({
  bigbrain: Object.freeze({
    server: 'bigbrain',
    label: 'BigBrain page and task tools',
    tools: Object.freeze([
      'me',
      'search',
      'query',
      'list',
      'read',
      'filing_rules',
      'create_page',
      'update_page',
      'get_page_visibility',
      'set_page_visibility',
      'tasks/list',
      'tasks/create',
      'tasks/update',
      'list_raw_files',
      'read_raw_file',
      'create_raw_file',
      'create_raw_file_with_page',
      'update_raw_file',
      'delete_raw_file',
    ]),
  }),
  icaire: Object.freeze({
    server: 'icaire',
    label: 'ICAIRE read, write, task, and raw-file tools',
    tools: Object.freeze([
      'me',
      'search',
      'query',
      'list',
      'read',
      'filing_rules',
      'create_page',
      'update_page',
      'tasks/list',
      'tasks/create',
      'tasks/update',
      'list_raw_files',
      'read_raw_file',
      'create_raw_file',
      'create_raw_file_with_page',
      'update_raw_file',
      'delete_raw_file',
    ]),
  }),
  granola: Object.freeze({
    server: 'granola',
    label: 'Granola folder-aware meeting tools',
    tools: Object.freeze([
      'get_account_info',
      'list_meeting_folders',
      'list_meetings',
      'get_meetings',
      'get_meeting_transcript',
    ]),
  }),
  icaire_board: Object.freeze({
    server: 'icaire_board',
    label: 'ICAIRE Board read and update tools',
    tools: Object.freeze([
      'board_snapshot',
      'initiative_list',
      'initiative_update',
      'milestone_list',
      'milestone_update',
      'task_list',
      'task_update',
      'step_list',
      'step_update',
    ]),
  }),
});

export function toolDiscoveryChecklist(group = CODEX_MCP_TOOL_GROUPS.bigbrain) {
  return [
    `Check Codex MCP registration for ${group.server}.`,
    `If only some ${group.label} are visible, treat it as partial exposure and run targeted discovery by exact tool name before falling back.`,
    ...group.tools.map((tool) => `Search for ${codexMcpToolName(group.server, tool)}.`),
    `If discovery still fails, separate the cause: disabled server, not logged in, missing tool, or live server error.`,
    `Only use local files or manual recovery after the required ${group.label} are genuinely unavailable.`,
  ];
}

export function resolveCodexMcpTools({
  group,
  visibleTools = [],
  discoveredTools = [],
  disabledServers = [],
  unauthenticatedServers = [],
} = {}) {
  if (!group?.server || !Array.isArray(group.tools)) {
    throw new TypeError('resolveCodexMcpTools requires a tool group with server and tools.');
  }
  const server = group.server;
  if (disabledServers.includes(server)) {
    return resolutionResult(group, 'server_disabled', group.tools, [], []);
  }
  if (unauthenticatedServers.includes(server)) {
    return resolutionResult(group, 'not_logged_in', group.tools, [], []);
  }

  const visible = normalizeToolSet(visibleTools);
  const discovered = normalizeToolSet(discoveredTools);
  const resolved = [];
  const discoveryRequired = [];
  const missing = [];

  for (const tool of group.tools) {
    const candidates = toolNameCandidates(server, tool);
    if (candidates.some((candidate) => visible.has(candidate))) {
      resolved.push(tool);
    } else if (candidates.some((candidate) => discovered.has(candidate))) {
      resolved.push(tool);
      discoveryRequired.push(tool);
    } else {
      missing.push(tool);
    }
  }

  const status = missing.length === 0
    ? (discoveryRequired.length > 0 ? 'resolved_after_discovery' : 'resolved')
    : (resolved.length > 0 ? 'partial' : 'missing');

  return resolutionResult(group, status, missing, resolved, discoveryRequired);
}

export function codexMcpToolName(server, tool) {
  return `mcp__${server}.${tool}`;
}

export function toolNameCandidates(server, tool) {
  const slashless = tool.replaceAll('/', '_');
  return [
    tool,
    slashless,
    codexMcpToolName(server, tool),
    codexMcpToolName(server, slashless),
    `mcp__${server}__${slashless}`,
  ];
}

function normalizeToolSet(tools) {
  return new Set(tools.flatMap((tool) => {
    if (typeof tool === 'string') return [tool];
    if (typeof tool?.name === 'string') return [tool.name];
    return [];
  }));
}

function resolutionResult(group, status, missing, resolved, discoveryRequired) {
  return {
    server: group.server,
    label: group.label,
    status,
    resolved,
    discovery_required: discoveryRequired,
    missing,
    discovery_queries: missing.map((tool) => codexMcpToolName(group.server, tool)),
  };
}
