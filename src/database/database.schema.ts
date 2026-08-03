import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { PersistedBriefing } from '../briefing/briefing.schema';

export const scheduledBriefingStatuses = [
  'pending',
  'processing',
  'delivered',
  'failed',
] as const;

export type ScheduledBriefingStatus =
  (typeof scheduledBriefingStatuses)[number];

export const scheduledBriefings = pgTable(
  'scheduled_briefings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inboundMessageId: text('inbound_message_id').notNull().unique(),
    recipient: text('recipient').notNull(),
    phoneNumberId: text('phone_number_id').notNull(),
    briefing: jsonb('briefing').$type<PersistedBriefing>().notNull(),
    scheduledAt: timestamp('scheduled_at', {
      mode: 'string',
      withTimezone: true,
    }).notNull(),
    status: text('status')
      .$type<ScheduledBriefingStatus>()
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', {
      mode: 'string',
      withTimezone: true,
    }),
    deliveredAt: timestamp('delivered_at', {
      mode: 'string',
      withTimezone: true,
    }),
    outboundMessageIds: jsonb('outbound_message_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    lastErrorType: text('last_error_type'),
    createdAt: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'scheduled_briefings_status_check',
      sql`${table.status} in ('pending', 'processing', 'delivered', 'failed')`,
    ),
    index('scheduled_briefings_due_idx').on(table.status, table.scheduledAt),
  ],
);

export type ScheduledBriefingRecord = typeof scheduledBriefings.$inferSelect;
