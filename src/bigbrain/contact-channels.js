import { randomUUID } from 'node:crypto';

import { readBrainPage, updateBrainPage } from './page-ops.js';

const CONTACT_CHANNEL_KEY = 'contact_channels';
const CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CHANNEL_TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const PHONE_LIKE_TYPES = new Set(['phone', 'whatsapp', 'signal']);

export async function listContactChannels({ config, pagePath }) {
  const page = await readContactPage(config, pagePath);
  return {
    path: page.path,
    channels: normalizeContactChannels(page.frontmatter?.[CONTACT_CHANNEL_KEY]),
    legacy_channels: legacyContactChannels(page.frontmatter),
  };
}

export async function readContactChannel({ config, pagePath, channelId }) {
  const listed = await listContactChannels({ config, pagePath });
  const id = normalizeChannelId(channelId);
  const channel = listed.channels.find((candidate) => candidate.id === id);
  if (!channel) throw new Error(`Contact channel not found: ${id}`);
  return { path: listed.path, channel };
}

export async function upsertContactChannel({
  config,
  pagePath,
  channel,
  timelineEntry,
  timelineSignificance,
}) {
  const page = await readContactPage(config, pagePath);
  const channels = normalizeContactChannels(page.frontmatter?.[CONTACT_CHANNEL_KEY]);
  const normalizedInput = normalizeContactChannel(channel, { requireId: false });
  const comparisonKey = contactChannelComparisonKey(normalizedInput);
  const index = normalizedInput.id
    ? channels.findIndex((candidate) => candidate.id === normalizedInput.id)
    : channels.findIndex((candidate) => contactChannelComparisonKey(candidate) === comparisonKey);
  const id = normalizedInput.id || (index >= 0 ? channels[index].id : generateUniqueChannelId(normalizedInput.type, channels));
  const nextChannel = { ...normalizedInput, id };

  const duplicate = channels.find((candidate, candidateIndex) => (
    candidateIndex !== index && contactChannelComparisonKey(candidate) === comparisonKey
  ));
  if (duplicate) {
    throw new Error(`A ${nextChannel.type} contact channel with this value already exists as ${duplicate.id}.`);
  }

  let nextChannels = index >= 0
    ? channels.map((candidate, candidateIndex) => candidateIndex === index ? nextChannel : candidate)
    : [...channels, nextChannel];
  if (nextChannel.primary) {
    nextChannels = nextChannels.map((candidate) => (
      candidate.type === nextChannel.type && candidate.id !== nextChannel.id
        ? omitFalsePrimary(candidate)
        : candidate
    ));
  }

  const updatedPage = await updateBrainPage({
    config,
    pagePath: page.path,
    timelineEntry,
    timelineSignificance,
    frontmatterValues: { [CONTACT_CHANNEL_KEY]: nextChannels },
  });
  return {
    path: updatedPage.path,
    channel: nextChannels.find((candidate) => candidate.id === id),
    channels: nextChannels,
    page: updatedPage,
  };
}

export async function removeContactChannel({
  config,
  pagePath,
  channelId,
  timelineEntry,
  timelineSignificance,
}) {
  const page = await readContactPage(config, pagePath);
  const channels = normalizeContactChannels(page.frontmatter?.[CONTACT_CHANNEL_KEY]);
  const id = normalizeChannelId(channelId);
  const removed = channels.find((candidate) => candidate.id === id);
  if (!removed) throw new Error(`Contact channel not found: ${id}`);
  const nextChannels = channels.filter((candidate) => candidate.id !== id);
  const updatedPage = await updateBrainPage({
    config,
    pagePath: page.path,
    timelineEntry,
    timelineSignificance,
    frontmatterValues: { [CONTACT_CHANNEL_KEY]: nextChannels },
  });
  return {
    path: updatedPage.path,
    removed,
    channels: nextChannels,
    page: updatedPage,
  };
}

export function normalizeContactChannels(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('contact_channels must be an array.');
  if (value.length > 100) throw new Error('contact_channels cannot contain more than 100 entries.');
  const channels = value.map((channel) => normalizeContactChannel(channel));
  const ids = new Set();
  const values = new Set();
  const primaryTypes = new Set();
  for (const channel of channels) {
    if (ids.has(channel.id)) throw new Error(`Duplicate contact channel id: ${channel.id}`);
    ids.add(channel.id);
    const key = contactChannelComparisonKey(channel);
    if (values.has(key)) throw new Error(`Duplicate ${channel.type} contact channel value.`);
    values.add(key);
    if (channel.primary) {
      if (primaryTypes.has(channel.type)) throw new Error(`Only one primary ${channel.type} contact channel is allowed.`);
      primaryTypes.add(channel.type);
    }
  }
  return channels;
}

export function normalizeContactChannel(value, { requireId = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each contact channel must be an object.');
  }
  const allowedKeys = new Set(['id', 'type', 'value', 'label', 'primary', 'verified_at']);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unknown contact channel field: ${unknownKey}`);

  const type = normalizeChannelType(value.type);
  const channelValue = normalizeChannelValue(type, value.value);
  const id = value.id === undefined || value.id === null || value.id === ''
    ? null
    : normalizeChannelId(value.id);
  if (requireId && !id) throw new Error('Contact channel id is required.');
  const label = optionalString(value.label, 'Contact channel label', 80);
  const verifiedAt = normalizeVerifiedAt(value.verified_at);
  if (value.primary !== undefined && typeof value.primary !== 'boolean') {
    throw new Error('Contact channel primary must be a boolean.');
  }
  return {
    ...(id ? { id } : {}),
    type,
    value: channelValue,
    ...(label ? { label } : {}),
    ...(value.primary === true ? { primary: true } : {}),
    ...(verifiedAt ? { verified_at: verifiedAt } : {}),
  };
}

export function contactChannelComparisonKey(channel) {
  const type = normalizeChannelType(channel.type);
  let value = normalizeChannelValue(type, channel.value).toLowerCase();
  if (PHONE_LIKE_TYPES.has(type)) value = value.replace(/[^0-9a-z+]/g, '');
  if (type === 'telegram') value = value.replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '');
  return `${type}:${value}`;
}

export function legacyContactChannels(frontmatter = {}) {
  const mappings = [
    ['email', 'email'],
    ['phone', 'phone'],
    ['mobile', 'phone'],
    ['whatsapp', 'whatsapp'],
    ['signal', 'signal'],
    ['telegram', 'telegram'],
    ['linkedin', 'linkedin'],
    ['linkedin_url', 'linkedin'],
    ['website', 'website'],
  ];
  const canonicalKeys = new Set(normalizeContactChannels(frontmatter?.[CONTACT_CHANNEL_KEY]).map(contactChannelComparisonKey));
  const legacy = [];
  for (const [field, type] of mappings) {
    const rawValues = Array.isArray(frontmatter?.[field]) ? frontmatter[field] : [frontmatter?.[field]];
    for (const rawValue of rawValues) {
      if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;
      try {
        const channel = normalizeContactChannel({ type, value: String(rawValue) }, { requireId: false });
        if (canonicalKeys.has(contactChannelComparisonKey(channel))) continue;
        legacy.push({ type: channel.type, value: channel.value, legacy_field: field, read_only: true });
      } catch {
        // Preserve compatibility with old free-form metadata without presenting malformed values as validated channels.
      }
    }
  }
  return legacy;
}

async function readContactPage(config, pagePath) {
  const normalizedPath = requirePeoplePagePath(pagePath);
  return readBrainPage({ config, pagePath: normalizedPath });
}

function requirePeoplePagePath(value) {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\.md$/i, '');
  if (!normalized.startsWith('people/') || normalized === 'people/' || normalized.includes('/.raw/') || normalized.split('/').includes('..')) {
    throw new Error('Contact channels can only be stored on a people page.');
  }
  return normalized;
}

function normalizeChannelType(value) {
  const type = String(value || '').trim().toLowerCase().replace(/[\s/]+/g, '-');
  if (!CHANNEL_TYPE_PATTERN.test(type)) {
    throw new Error('Contact channel type must be a lowercase slug such as email, phone, whatsapp, linkedin, signal, telegram, or website.');
  }
  return type;
}

function normalizeChannelId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!CHANNEL_ID_PATTERN.test(id)) throw new Error('Contact channel id must be a lowercase slug of at most 64 characters.');
  return id;
}

function normalizeChannelValue(type, value) {
  let normalized = String(value || '').trim();
  if (!normalized) throw new Error('Contact channel value is required.');
  if (normalized.length > 500) throw new Error('Contact channel value cannot exceed 500 characters.');
  if (type === 'email') {
    normalized = normalized.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Email contact channels must contain a valid email address.');
  }
  if (PHONE_LIKE_TYPES.has(type) && normalized.replace(/\D/g, '').length < 3) {
    throw new Error(`${type} contact channels must contain a phone number or account value.`);
  }
  return normalized;
}

function normalizeVerifiedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new Error('Contact channel verified_at must be an ISO date or timestamp.');
  return new Date(timestamp).toISOString();
}

function optionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} cannot exceed ${maxLength} characters.`);
  return normalized;
}

function generateChannelId(type) {
  return `${type}-${randomUUID().slice(0, 8)}`;
}

function generateUniqueChannelId(type, channels) {
  let id = generateChannelId(type);
  const existing = new Set(channels.map((channel) => channel.id));
  while (existing.has(id)) id = generateChannelId(type);
  return id;
}

function omitFalsePrimary(channel) {
  const { primary, ...rest } = channel;
  return rest;
}
