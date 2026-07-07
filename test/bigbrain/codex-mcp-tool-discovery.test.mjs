import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODEX_MCP_TOOL_GROUPS,
  codexMcpToolName,
  resolveCodexMcpTools,
  toolDiscoveryChecklist,
} from '../../src/bigbrain/codex-mcp-tool-discovery.js';

test('resolver covers the expected BigBrain-style MCP tool groups', () => {
  assert.deepEqual(Object.keys(CODEX_MCP_TOOL_GROUPS), [
    'bigbrain',
    'icaire',
    'granola',
    'icaire_board',
  ]);
  assertToolGroup('bigbrain', [
    'read',
    'create_page',
    'update_page',
    'tasks/list',
    'tasks/create',
    'tasks/update',
  ]);
  assertToolGroup('icaire', [
    'filing_rules',
    'read',
    'create_page',
    'update_page',
    'tasks/list',
    'list_raw_files',
    'create_raw_file_with_page',
  ]);
  assertToolGroup('granola', [
    'list_meeting_folders',
    'list_meetings',
    'get_meeting_transcript',
  ]);
  assertToolGroup('icaire_board', [
    'board_snapshot',
    'initiative_update',
    'milestone_update',
    'task_update',
    'step_update',
  ]);
});

test('resolver treats partial exposure as resolved after targeted discovery', () => {
  const group = CODEX_MCP_TOOL_GROUPS.icaire;
  const visibleTools = [
    'mcp__icaire.search',
    'mcp__icaire.query',
    'mcp__icaire.list',
  ];
  const discoveredTools = group.tools
    .filter((tool) => !['search', 'query', 'list'].includes(tool))
    .map((tool) => codexMcpToolName(group.server, tool));

  const result = resolveCodexMcpTools({ group, visibleTools, discoveredTools });

  assert.equal(result.status, 'resolved_after_discovery');
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.resolved, group.tools);
  assert(result.discovery_required.includes('tasks/list'));
  assert(result.discovery_required.includes('create_raw_file_with_page'));
});

test('resolver accepts slash aliases and underscore aliases for task tools', () => {
  const result = resolveCodexMcpTools({
    group: {
      server: 'bigbrain',
      label: 'alias check',
      tools: ['tasks/list', 'tasks/create', 'tasks/update'],
    },
    visibleTools: [
      'mcp__bigbrain.tasks_list',
      'mcp__bigbrain__tasks_create',
      'tasks/update',
    ],
  });

  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.missing, []);
});

test('resolver reports disabled server before suggesting missing tools', () => {
  const result = resolveCodexMcpTools({
    group: CODEX_MCP_TOOL_GROUPS.icaire_board,
    disabledServers: ['icaire_board'],
  });

  assert.equal(result.status, 'server_disabled');
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.missing, CODEX_MCP_TOOL_GROUPS.icaire_board.tools);
  assert.equal(result.discovery_queries[0], 'mcp__icaire_board.board_snapshot');
});

test('resolver reports not logged in as separate from missing tools', () => {
  const result = resolveCodexMcpTools({
    group: CODEX_MCP_TOOL_GROUPS.granola,
    unauthenticatedServers: ['granola'],
  });

  assert.equal(result.status, 'not_logged_in');
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.missing, CODEX_MCP_TOOL_GROUPS.granola.tools);
});

test('resolver reports truly missing tools after targeted discovery is exhausted', () => {
  const group = CODEX_MCP_TOOL_GROUPS.granola;
  const result = resolveCodexMcpTools({
    group,
    visibleTools: ['mcp__granola.get_account_info'],
    discoveredTools: [
      'mcp__granola.list_meetings',
      'mcp__granola.get_meetings',
      'mcp__granola.get_meeting_transcript',
    ],
  });

  assert.equal(result.status, 'partial');
  assert.deepEqual(result.missing, ['list_meeting_folders']);
  assert.deepEqual(result.discovery_queries, ['mcp__granola.list_meeting_folders']);
});

test('checklist names exact targeted discovery queries', () => {
  const checklist = toolDiscoveryChecklist(CODEX_MCP_TOOL_GROUPS.icaire_board);

  assert.match(checklist.join('\n'), /partial/);
  assert(checklist.includes('Search for mcp__icaire_board.board_snapshot.'));
  assert(checklist.includes('Search for mcp__icaire_board.task_update.'));
});

function assertToolGroup(name, expectedTools) {
  const group = CODEX_MCP_TOOL_GROUPS[name];
  assert(group, `missing group ${name}`);
  for (const expectedTool of expectedTools) {
    assert(
      group.tools.includes(expectedTool),
      `expected ${name} to include ${expectedTool}`,
    );
  }
}
