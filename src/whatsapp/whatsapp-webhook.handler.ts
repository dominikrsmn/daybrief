import { Injectable, Logger } from '@nestjs/common';
import { VoiceBriefingProcessor } from './voice-briefing.processor';
import { extractWhatsAppAudioMessages } from './whatsapp-webhook.parser';
import type {
  WhatsAppAudioMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

const PROCESSED_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class WhatsAppWebhookHandler {
  private readonly logger = new Logger(WhatsAppWebhookHandler.name);
  private readonly processingMessageIds = new Set<string>();
  private readonly processedMessageExpirations = new Map<string, number>();

  constructor(
    private readonly voiceBriefingProcessor: VoiceBriefingProcessor,
  ) {}

  /**
   * Dispatches complete audio messages without delaying Meta's webhook
   * acknowledgement. Successful deliveries are retained briefly to suppress
   * webhook retries; failed attempts remain eligible for reprocessing.
   */
  handle(payload: WhatsAppWebhookPayload): void {
    this.removeExpiredProcessedMessageIds();

    const messages = extractWhatsAppAudioMessages(payload);
    this.logger.log(
      JSON.stringify({
        event: 'whatsapp.webhook.audio_messages_extracted',
        count: messages.length,
      }),
    );

    for (const message of messages) {
      if (this.isDuplicate(message.id)) {
        this.logger.log(
          JSON.stringify({
            event: 'whatsapp.audio.duplicate_ignored',
            messageId: message.id,
          }),
        );
        continue;
      }

      this.startProcessing(message);
    }
  }

  private isDuplicate(messageId: string): boolean {
    return (
      this.processingMessageIds.has(messageId) ||
      this.processedMessageExpirations.has(messageId)
    );
  }

  private startProcessing(message: WhatsAppAudioMessage): void {
    const startedAt = Date.now();

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp.audio.received',
        mediaId: message.mediaId,
        messageId: message.id,
        phoneNumberId: message.phoneNumberId,
        voice: message.voice,
      }),
    );

    this.processingMessageIds.add(message.id);
    void this.voiceBriefingProcessor
      .process(message)
      .then((outboundMessageId) => {
        this.processedMessageExpirations.set(
          message.id,
          Date.now() + PROCESSED_MESSAGE_RETENTION_MS,
        );
        this.logger.log(
          JSON.stringify({
            event: 'whatsapp.audio.processing_completed',
            durationMs: Date.now() - startedAt,
            inboundMessageId: message.id,
            outboundMessageId,
          }),
        );
      })
      .catch((error: unknown) => {
        this.logger.error(
          JSON.stringify({
            event: 'whatsapp.audio.processing_failed',
            messageId: message.id,
            reason:
              error instanceof Error ? error.message : 'processing_failed',
          }),
        );
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
