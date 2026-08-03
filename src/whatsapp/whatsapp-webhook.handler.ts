import { Injectable } from '@nestjs/common';
import { describeError } from '../observability/canonical-event';
import { CanonicalLogger } from '../observability/canonical-logger.service';
import {
  VoiceBriefingProcessor,
  type VoiceBriefingTelemetry,
} from './voice-briefing.processor';
import {
  BriefingClarificationProcessor,
  type BriefingClarificationTelemetry,
} from './briefing-clarification.processor';
import { classifyWhatsAppWebhook } from './whatsapp-webhook.parser';
import type {
  WhatsAppAudioMessage,
  WhatsAppTextMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

const PROCESSED_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class WhatsAppWebhookHandler {
  private readonly processingMessageIds = new Set<string>();
  private readonly processedMessageExpirations = new Map<string, number>();

  constructor(
    private readonly voiceBriefingProcessor: VoiceBriefingProcessor,
    private readonly briefingClarificationProcessor: BriefingClarificationProcessor,
    private readonly canonicalLogger: CanonicalLogger,
  ) {}

  /**
   * Dispatches complete voice notes and clarification replies without delaying
   * Meta's webhook acknowledgement. Successful deliveries are retained briefly
   * to suppress webhook retries; failed attempts remain eligible for reprocessing.
   */
  handle(payload: WhatsAppWebhookPayload, requestId?: string): void {
    this.removeExpiredProcessedMessageIds();

    const { audioMessages, deliveryStatuses, textMessages, unknownEvents } =
      classifyWhatsAppWebhook(payload);

    for (const deliveryStatus of deliveryStatuses) {
      this.canonicalLogger.emit({
        duration_ms: 0,
        event: 'whatsapp.message.delivery_status',
        message: {
          id: deliveryStatus.messageId,
          provider_timestamp: deliveryStatus.timestamp,
          status: deliveryStatus.status,
        },
        outcome: 'success',
        ...(requestId ? { request_id: requestId } : {}),
        timestamp: new Date().toISOString(),
      });
    }

    for (const unknownEvent of unknownEvents) {
      this.canonicalLogger.emit({
        duration_ms: 0,
        event: 'whatsapp.webhook.unsupported',
        outcome: 'ignored',
        ...(requestId ? { request_id: requestId } : {}),
        timestamp: new Date().toISOString(),
        webhook: unknownEvent,
      });
    }

    for (const message of audioMessages) {
      if (this.isDuplicate(message.id)) {
        this.canonicalLogger.emit({
          duration_ms: 0,
          event: 'whatsapp.voice_briefing',
          message: { inbound_message_id: message.id },
          outcome: 'ignored',
          reason: 'duplicate',
          ...(requestId ? { request_id: requestId } : {}),
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      this.startProcessing(message, requestId);
    }

    for (const message of textMessages) {
      if (this.isDuplicate(message.id)) {
        continue;
      }

      this.startClarificationProcessing(message, requestId);
    }
  }

  private isDuplicate(messageId: string): boolean {
    return (
      this.processingMessageIds.has(messageId) ||
      this.processedMessageExpirations.has(messageId)
    );
  }

  private startProcessing(
    message: WhatsAppAudioMessage,
    requestId?: string,
  ): void {
    const startedAt = Date.now();
    const telemetry: VoiceBriefingTelemetry = {};

    this.processingMessageIds.add(message.id);
    void this.voiceBriefingProcessor
      .process(message, telemetry)
      .then(({ briefingId, scheduledAt }) => {
        this.processedMessageExpirations.set(
          message.id,
          Date.now() + PROCESSED_MESSAGE_RETENTION_MS,
        );
        this.canonicalLogger.emit({
          duration_ms: Date.now() - startedAt,
          event: 'whatsapp.voice_briefing',
          message: {
            inbound_message_id: message.id,
            media_id: message.mediaId,
            phone_number_id: message.phoneNumberId,
            provider_timestamp: message.timestamp,
            scheduled_briefing_id: briefingId,
            scheduled_at: scheduledAt,
            voice: message.voice,
          },
          outcome: 'success',
          ...(requestId ? { request_id: requestId } : {}),
          stages: telemetry,
          timestamp: new Date(startedAt).toISOString(),
        });
      })
      .catch((error: unknown) => {
        this.canonicalLogger.emit({
          duration_ms: Date.now() - startedAt,
          error: describeError(error),
          event: 'whatsapp.voice_briefing',
          message: {
            inbound_message_id: message.id,
            media_id: message.mediaId,
            phone_number_id: message.phoneNumberId,
            provider_timestamp: message.timestamp,
            voice: message.voice,
          },
          outcome: 'error',
          ...(requestId ? { request_id: requestId } : {}),
          stages: telemetry,
          timestamp: new Date(startedAt).toISOString(),
        });
      })
      .finally(() => {
        this.processingMessageIds.delete(message.id);
      });
  }

  private startClarificationProcessing(
    message: WhatsAppTextMessage,
    requestId?: string,
  ): void {
    const startedAt = Date.now();
    const telemetry: BriefingClarificationTelemetry = {};

    this.processingMessageIds.add(message.id);
    void this.briefingClarificationProcessor
      .process(message, telemetry)
      .then(() => {
        this.processedMessageExpirations.set(
          message.id,
          Date.now() + PROCESSED_MESSAGE_RETENTION_MS,
        );
        this.canonicalLogger.emit({
          clarification: telemetry,
          duration_ms: Date.now() - startedAt,
          event: 'whatsapp.briefing_clarification',
          message: {
            inbound_message_id: message.id,
            provider_timestamp: message.timestamp,
          },
          outcome: telemetry.outcome === 'ignored' ? 'ignored' : 'success',
          ...(requestId ? { request_id: requestId } : {}),
          timestamp: new Date(startedAt).toISOString(),
        });
      })
      .catch((error: unknown) => {
        this.canonicalLogger.emit({
          clarification: telemetry,
          duration_ms: Date.now() - startedAt,
          error: describeError(error),
          event: 'whatsapp.briefing_clarification',
          message: {
            inbound_message_id: message.id,
            provider_timestamp: message.timestamp,
          },
          outcome: 'error',
          ...(requestId ? { request_id: requestId } : {}),
          timestamp: new Date(startedAt).toISOString(),
        });
      })
      .finally(() => {
        this.processingMessageIds.delete(message.id);
      });
  }

  private removeExpiredProcessedMessageIds(): void {
    const now = Date.now();

    for (const [messageId, expiresAt] of this.processedMessageExpirations) {
      if (expiresAt <= now) {
        this.processedMessageExpirations.delete(messageId);
      }
    }
  }
}
