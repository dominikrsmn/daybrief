import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Briefing } from '../briefing/briefing.schema';
import {
  scheduledBriefings,
  type ScheduledBriefingRecord,
} from '../database/database.schema';
import { DatabaseService } from '../database/database.service';

export interface ScheduleBriefingInput {
  briefing: Briefing;
  inboundMessageId: string;
  phoneNumberId: string;
  recipient: string;
  scheduledAt: string;
}

@Injectable()
export class ScheduledBriefingRepository {
  constructor(private readonly database: DatabaseService) {}

  async schedule(
    input: ScheduleBriefingInput,
  ): Promise<ScheduledBriefingRecord> {
    const [created] = await this.database.db
      .insert(scheduledBriefings)
      .values(input)
      .onConflictDoNothing({ target: scheduledBriefings.inboundMessageId })
      .returning();

    if (created) {
      return created;
    }

    const [existing] = await this.database.db
      .select()
      .from(scheduledBriefings)
      .where(eq(scheduledBriefings.inboundMessageId, input.inboundMessageId))
      .limit(1);

    if (!existing) {
      throw new Error('The scheduled briefing could not be persisted.');
    }

    return existing;
  }

  async claimNextDue(): Promise<ScheduledBriefingRecord | null> {
    return this.database.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(scheduledBriefings)
        .where(
          and(
            eq(scheduledBriefings.status, 'pending'),
            sql`${scheduledBriefings.scheduledAt} <= now()`,
          ),
        )
        .orderBy(asc(scheduledBriefings.scheduledAt))
        .limit(1)
        .for('update', { skipLocked: true });

      if (!candidate) {
        return null;
      }

      const [claimed] = await transaction
        .update(scheduledBriefings)
        .set({
          attemptCount: sql`${scheduledBriefings.attemptCount} + 1`,
          lastAttemptAt: sql`now()`,
          status: 'processing',
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(scheduledBriefings.id, candidate.id),
            eq(scheduledBriefings.status, 'pending'),
          ),
        )
        .returning();

      return claimed ?? null;
    });
  }

  async markDelivered(id: string, outboundMessageIds: string[]): Promise<void> {
    await this.database.db
      .update(scheduledBriefings)
      .set({
        deliveredAt: sql`now()`,
        lastErrorType: null,
        outboundMessageIds,
        status: 'delivered',
        updatedAt: sql`now()`,
      })
      .where(eq(scheduledBriefings.id, id));
  }

  async markFailed(id: string, errorType: string): Promise<void> {
    await this.database.db
      .update(scheduledBriefings)
      .set({
        lastErrorType: errorType.slice(0, 120),
        status: 'failed',
        updatedAt: sql`now()`,
      })
      .where(eq(scheduledBriefings.id, id));
  }
}
