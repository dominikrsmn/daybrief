import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Briefing, PersistedBriefing } from '../briefing/briefing.schema';
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
  transcript: string;
}

@Injectable()
export class ScheduledBriefingRepository {
  constructor(private readonly database: DatabaseService) {}

  async schedule(
    input: ScheduleBriefingInput,
  ): Promise<ScheduledBriefingRecord> {
    const [created] = await this.database.db
      .insert(scheduledBriefings)
      .values({
        briefing: withClarificationState(input.briefing, input.transcript),
        inboundMessageId: input.inboundMessageId,
        phoneNumberId: input.phoneNumberId,
        recipient: input.recipient,
        scheduledAt: input.scheduledAt,
      })
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

  async findPendingClarification(input: {
    contextMessageId?: string;
    phoneNumberId: string;
    recipient: string;
  }): Promise<ScheduledBriefingRecord | null> {
    const candidates = await this.database.db
      .select()
      .from(scheduledBriefings)
      .where(
        and(
          eq(scheduledBriefings.status, 'pending'),
          eq(scheduledBriefings.recipient, input.recipient),
          eq(scheduledBriefings.phoneNumberId, input.phoneNumberId),
        ),
      )
      .orderBy(desc(scheduledBriefings.createdAt))
      .limit(10);

    return (
      candidates.find(({ briefing }) => {
        if (!briefing.clarification || briefing.openQuestions.length === 0) {
          return false;
        }

        return input.contextMessageId
          ? briefing.clarification.questionMessageId === undefined ||
              briefing.clarification.questionMessageId ===
                input.contextMessageId
          : true;
      }) ?? null
    );
  }

  async updatePendingBriefing(
    id: string,
    briefing: Briefing,
    transcript: string,
  ): Promise<ScheduledBriefingRecord | null> {
    const [updated] = await this.database.db
      .update(scheduledBriefings)
      .set({
        briefing: withClarificationState(briefing, transcript),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(scheduledBriefings.id, id),
          eq(scheduledBriefings.status, 'pending'),
        ),
      )
      .returning();

    return updated ?? null;
  }

  async recordClarificationQuestion(
    id: string,
    questionMessageId: string,
  ): Promise<void> {
    await this.database.db
      .update(scheduledBriefings)
      .set({
        briefing: sql<PersistedBriefing>`jsonb_set(
          ${scheduledBriefings.briefing},
          '{clarification,questionMessageId}',
          to_jsonb(${questionMessageId}::text),
          true
        )`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(scheduledBriefings.id, id),
          eq(scheduledBriefings.status, 'pending'),
        ),
      );
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

      const deliveryBriefing = { ...candidate.briefing };
      delete deliveryBriefing.clarification;

      const [claimed] = await transaction
        .update(scheduledBriefings)
        .set({
          attemptCount: sql`${scheduledBriefings.attemptCount} + 1`,
          briefing: deliveryBriefing,
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

function withClarificationState(
  briefing: Briefing,
  transcript: string,
): PersistedBriefing {
  return {
    ...briefing,
    ...(briefing.openQuestions.length > 0
      ? { clarification: { transcript } }
      : {}),
  };
}
