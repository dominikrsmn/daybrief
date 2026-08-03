import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { renderWhatsAppBriefingMessages } from '../briefing/briefing.renderer';
import { describeError } from '../observability/canonical-event';
import { CanonicalLogger } from '../observability/canonical-logger.service';
import { ScheduledBriefingRepository } from '../scheduling/scheduled-briefing.repository';
import {
  WhatsAppService,
  type WhatsAppReplyTelemetry,
} from './whatsapp.service';

@Injectable()
export class BriefingDeliveryScheduler {
  constructor(
    private readonly scheduledBriefings: ScheduledBriefingRepository,
    private readonly whatsAppService: WhatsAppService,
    private readonly canonicalLogger: CanonicalLogger,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { waitForCompletion: true })
  async deliverDueBriefings(): Promise<void> {
    while (await this.deliverNextDueBriefing()) {
      // Drain all currently due rows before waiting for the next scheduler tick.
    }
  }

  private async deliverNextDueBriefing(): Promise<boolean> {
    const briefing = await this.scheduledBriefings.claimNextDue();

    if (!briefing) {
      return false;
    }

    const startedAt = Date.now();
    let replies: readonly string[] = [];
    let replyTelemetry: WhatsAppReplyTelemetry[] = [];
    const outboundMessageIds: string[] = [];

    try {
      replies = renderWhatsAppBriefingMessages(briefing.briefing);
      replyTelemetry = replies.map((): WhatsAppReplyTelemetry => ({}));

      for (const [index, reply] of replies.entries()) {
        const outboundMessageId = await this.whatsAppService.send(
          {
            from: briefing.recipient,
            id: briefing.inboundMessageId,
            phoneNumberId: briefing.phoneNumberId,
          },
          reply,
          replyTelemetry[index],
        );
        outboundMessageIds.push(outboundMessageId);
      }

      await this.scheduledBriefings.markDelivered(
        briefing.id,
        outboundMessageIds,
      );
      this.canonicalLogger.emit({
        briefing: {
          attempt: briefing.attemptCount,
          id: briefing.id,
          scheduled_at: briefing.scheduledAt,
        },
        duration_ms: Date.now() - startedAt,
        event: 'whatsapp.briefing_delivery',
        outcome: 'success',
        reply: {
          message_count: replies.length,
          outbound_message_ids: outboundMessageIds,
          provider_responses: replyTelemetry,
        },
        timestamp: new Date(startedAt).toISOString(),
      });
    } catch (error: unknown) {
      const describedError = describeError(error);

      try {
        await this.scheduledBriefings.markFailed(
          briefing.id,
          describedError.type,
        );
      } catch (persistenceError: unknown) {
        this.canonicalLogger.emit({
          briefing: { id: briefing.id },
          duration_ms: Date.now() - startedAt,
          error: describeError(persistenceError),
          event: 'whatsapp.briefing_delivery_state_update',
          outcome: 'error',
          timestamp: new Date(startedAt).toISOString(),
        });
      }

      this.canonicalLogger.emit({
        briefing: {
          attempt: briefing.attemptCount,
          id: briefing.id,
          scheduled_at: briefing.scheduledAt,
        },
        duration_ms: Date.now() - startedAt,
        error: describedError,
        event: 'whatsapp.briefing_delivery',
        outcome: 'error',
        reply: {
          completed_message_count: outboundMessageIds.length,
          intended_message_count: replies.length,
          outbound_message_ids: outboundMessageIds,
          provider_responses: replyTelemetry,
        },
        timestamp: new Date(startedAt).toISOString(),
      });
    }

    return true;
  }
}
