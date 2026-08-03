import { Injectable } from '@nestjs/common';
import { renderWhatsAppUncertaintyMessage } from '../briefing/briefing.renderer';
import { BriefingService } from '../briefing/briefing.service';
import { ScheduledBriefingRepository } from '../scheduling/scheduled-briefing.repository';
import {
  WhatsAppService,
  type WhatsAppMessageActionTelemetry,
  type WhatsAppReplyTelemetry,
} from './whatsapp.service';
import type { WhatsAppTextMessage } from './whatsapp-webhook.types';

const PROCESSING_REACTION = '🔄';
const COMPLETED_REACTION = '👍';
const FAILED_REACTION = '❌';
const UNCERTAINTY_REACTION = '❓';

export interface BriefingClarificationTelemetry {
  briefing_id?: string;
  open_questions?: number;
  outcome?: 'ignored' | 'regenerated';
  reply?: WhatsAppReplyTelemetry & { outbound_message_id?: string };
  whatsapp_actions?: {
    reaction: WhatsAppMessageActionTelemetry;
    read_receipt: WhatsAppMessageActionTelemetry;
  };
}

@Injectable()
export class BriefingClarificationProcessor {
  constructor(
    private readonly briefingService: BriefingService,
    private readonly scheduledBriefings: ScheduledBriefingRepository,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  /** Regenerates only the latest still-pending briefing awaiting this reply. */
  async process(
    message: WhatsAppTextMessage,
    telemetry: BriefingClarificationTelemetry,
  ): Promise<void> {
    const actions = {
      reaction: {},
      read_receipt: {},
    } satisfies NonNullable<BriefingClarificationTelemetry['whatsapp_actions']>;
    telemetry.whatsapp_actions = actions;

    const scheduled = await this.scheduledBriefings.findPendingClarification({
      ...(message.contextMessageId
        ? { contextMessageId: message.contextMessageId }
        : {}),
      phoneNumberId: message.phoneNumberId,
      recipient: message.from,
    });

    if (!scheduled?.briefing.clarification) {
      telemetry.outcome = 'ignored';
      return;
    }

    telemetry.briefing_id = scheduled.id;
    await this.performBestEffortAction(() =>
      this.whatsAppService.markAsRead(message, actions.read_receipt),
    );
    await this.performBestEffortAction(() =>
      this.whatsAppService.react(
        message,
        PROCESSING_REACTION,
        actions.reaction,
      ),
    );

    try {
      const transcript = appendClarification(
        scheduled.briefing.clarification.transcript,
        message.body,
      );
      const briefing = await this.briefingService.createBriefing(transcript);
      const updated = await this.scheduledBriefings.updatePendingBriefing(
        scheduled.id,
        briefing,
        transcript,
      );

      if (!updated) {
        telemetry.outcome = 'ignored';
        return;
      }

      telemetry.open_questions = briefing.openQuestions.length;
      telemetry.outcome = 'regenerated';
      const uncertaintyMessage = renderWhatsAppUncertaintyMessage(briefing);

      if (uncertaintyMessage) {
        const replyTelemetry: WhatsAppReplyTelemetry & {
          outbound_message_id?: string;
        } = {};
        telemetry.reply = replyTelemetry;
        const outboundMessageId = await this.whatsAppService.reply(
          message,
          uncertaintyMessage,
          replyTelemetry,
        );
        replyTelemetry.outbound_message_id = outboundMessageId;
        await this.scheduledBriefings.recordClarificationQuestion(
          updated.id,
          outboundMessageId,
        );
        await this.performBestEffortAction(() =>
          this.whatsAppService.react(
            message,
            UNCERTAINTY_REACTION,
            actions.reaction,
          ),
        );
        return;
      }

      await this.performBestEffortAction(() =>
        this.whatsAppService.react(
          message,
          COMPLETED_REACTION,
          actions.reaction,
        ),
      );
    } catch (error) {
      await this.performBestEffortAction(() =>
        this.whatsAppService.react(message, FAILED_REACTION, actions.reaction),
      );
      throw error;
    }
  }

  private async performBestEffortAction(action: () => Promise<void>) {
    try {
      await action();
    } catch {
      // Clarification state remains valid when an optional UX action fails.
    }
  }
}

function appendClarification(transcript: string, answer: string): string {
  return `${transcript}\n\nUser clarification supplied after the original transcript:\n${answer}`;
}
