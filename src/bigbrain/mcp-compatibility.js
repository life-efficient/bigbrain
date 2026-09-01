export const MCP_API_CONTRACT_VERSION = 1;
export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const DESKTOP_MCP_API_COMPATIBILITY = Object.freeze({
  minimum: MCP_API_CONTRACT_VERSION,
  maximum: MCP_API_CONTRACT_VERSION,
});
export const DESKTOP_MCP_PROTOCOL_VERSIONS = Object.freeze([MCP_PROTOCOL_VERSION]);

export function desktopMcpSupportMetadata() {
  return {
    api_contract: { ...DESKTOP_MCP_API_COMPATIBILITY },
    protocol_versions: [...DESKTOP_MCP_PROTOCOL_VERSIONS],
  };
}

export function assessMcpCompatibility(health) {
  const runtime = health?.runtime;
  const serverVersion = optionalString(runtime?.application?.version);
  const protocolVersion = optionalString(runtime?.contracts?.mcp_protocol);
  const apiContract = normalizeApiContract(runtime?.compatibility?.api_contract, runtime?.contracts?.api);

  if (!runtime || (!protocolVersion && !apiContract)) {
    return {
      state: 'legacy',
      server_version: serverVersion,
      api_contract: apiContract,
      protocol_version: protocolVersion,
      message: 'This MCP did not advertise compatibility metadata; the connection remains available for backward compatibility.',
    };
  }

  if (protocolVersion && !DESKTOP_MCP_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    return {
      state: 'incompatible',
      server_version: serverVersion,
      api_contract: apiContract,
      protocol_version: protocolVersion,
      message: `This MCP uses protocol ${protocolVersion}, which this desktop does not support.`,
    };
  }

  if (apiContract && !rangesOverlap(apiContract, DESKTOP_MCP_API_COMPATIBILITY)) {
    return {
      state: 'incompatible',
      server_version: serverVersion,
      api_contract: apiContract,
      protocol_version: protocolVersion,
      message: `This MCP exposes API contract ${formatRange(apiContract)}, while this desktop supports ${formatRange(DESKTOP_MCP_API_COMPATIBILITY)}.`,
    };
  }

  return {
    state: 'compatible',
    server_version: serverVersion,
    api_contract: apiContract,
    protocol_version: protocolVersion,
    message: serverVersion
      ? `MCP ${serverVersion} is compatible with this desktop.`
      : 'This MCP is compatible with the supported API and protocol versions.',
  };
}

function normalizeApiContract(value, fallbackVersion) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const minimum = positiveInteger(value.minimum);
    const maximum = positiveInteger(value.maximum);
    if (minimum && maximum && minimum <= maximum) return { minimum, maximum };
  }
  const version = positiveInteger(fallbackVersion);
  return version ? { minimum: version, maximum: version } : null;
}

function rangesOverlap(first, second) {
  return first.minimum <= second.maximum && second.minimum <= first.maximum;
}

function formatRange(range) {
  return range.minimum === range.maximum ? String(range.minimum) : `${range.minimum}-${range.maximum}`;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
