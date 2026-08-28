import { z } from 'zod';

/**
 * Source types describe what triggered BigBrain to process a change. They do
 * not describe the transport used to deliver the event or the agent that
 * performed the write.
 */
export const SOURCE_TYPE_DEFINITIONS = Object.freeze({
  assistant_chat: {
    label: 'Assistant chat',
    description: 'A user message sent through an AI assistant harness. This is not a direct CLI command or a manual file edit.',
  },
  whatsapp: {
    label: 'WhatsApp',
    description: 'A WhatsApp message, group conversation, or WhatsApp-triggered event.',
  },
  gmail: {
    label: 'Gmail',
    description: 'An email or email-thread event received from Gmail.',
  },
  google_calendar: {
    label: 'Google Calendar',
    description: 'A calendar event or calendar-triggered event received from Google Calendar.',
  },
  granola: {
    label: 'Granola',
    description: 'A Granola meeting capture or Granola-triggered event.',
  },
  rss: {
    label: 'RSS',
    description: 'An item collected from an RSS or Atom feed.',
  },
  webhook: {
    label: 'Webhook',
    description: 'A webhook event where no more specific first-class source integration is known.',
  },
  cli: {
    label: 'CLI',
    description: 'A direct BigBrain command-line operation, not a user message sent through an assistant harness.',
  },
  direct_edit: {
    label: 'Direct edit',
    description: 'A page or raw file changed directly in the filesystem or Git provider outside an MCP write.',
  },
  unknown: {
    label: 'Unknown',
    description: 'The triggering source cannot be established. Maintenance may use this value when repairing incomplete metadata; producers must not use it as a convenience default when the source is known.',
  },
});

export const SOURCE_TYPE_VALUES = Object.freeze(Object.keys(SOURCE_TYPE_DEFINITIONS));

export const sourceTypeSchema = z.enum(SOURCE_TYPE_VALUES);

const nonEmptyText = (max) => z.string().trim().min(1).max(max);

export const commitMessageSchema = nonEmptyText(200)
  .refine((value) => !/[\r\n]/.test(value), 'commit_message must be a single line.');

export const provenanceSchema = z.object({
  event_id: nonEmptyText(500),
  source_type: sourceTypeSchema,
  source_label: nonEmptyText(240),
  origin_id: z.string().trim().max(500).nullable().optional(),
  listener_id: z.string().trim().max(240).nullable().optional(),
  source_icon: z.string().trim().max(80).nullable().optional(),
  source_url: z.string().trim().url().nullable().optional(),
  occurred_at: z.string().datetime({ offset: true }).nullable().optional(),
  received_at: z.string().datetime({ offset: true }).nullable().optional(),
  codex_execution_id: z.string().trim().max(500).nullable().optional(),
  codex_thread_id: z.string().trim().max(500).nullable().optional(),
  raw_ref: z.string().trim().max(1000).nullable().optional(),
  outcome: z.string().trim().max(80).optional(),
}).strict();

export const mutationMetadataSchema = z.object({
  commit_message: commitMessageSchema,
  provenance: provenanceSchema,
}).strict();

export function sourceTypeDescription(sourceType) {
  return SOURCE_TYPE_DEFINITIONS[sourceType]?.description || SOURCE_TYPE_DEFINITIONS.unknown.description;
}

export function sourceTypeLabel(sourceType) {
  return SOURCE_TYPE_DEFINITIONS[sourceType]?.label || SOURCE_TYPE_DEFINITIONS.unknown.label;
}

export function parseMutationMetadata(value) {
  return mutationMetadataSchema.parse(value);
}

export function normalizeSourceType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SOURCE_TYPE_VALUES.includes(normalized) ? normalized : 'unknown';
}
