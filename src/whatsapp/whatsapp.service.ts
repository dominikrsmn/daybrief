import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { whatsappConfig } from './whatsapp.config';
import type {
  WhatsAppAudioMessage,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(whatsappConfig.KEY)
    private readonly config: ConfigType<typeof whatsappConfig>,
  ) {}

  isWebhookVerificationConfigured(): boolean {
    return this.config.verifyToken.length > 0;
  }

  isValidVerifyToken(token?: string): boolean {
    if (!this.isWebhookVerificationConfigured() || token === undefined) {
      return false;
    }

    return this.safeEqual(token, this.config.verifyToken);
  }

  isWebhookSignatureConfigured(): boolean {
    return this.config.appSecret.length > 0;
  }

  isValidSignature(rawBody: Buffer | undefined, signature?: string): boolean {
    if (
      !this.isWebhookSignatureConfigured() ||
      !rawBody ||
      !signature?.startsWith('sha256=')
    ) {
      return false;
    }

    const expectedSignature = `sha256=${createHmac(
      'sha256',
      this.config.appSecret,
    )
      .update(rawBody)
      .digest('hex')}`;

    return this.safeEqual(signature, expectedSignature);
  }

  handleWebhook(payload: WhatsAppWebhookPayload): void {
    for (const message of this.extractAudioMessages(payload)) {
      // Media download, transcription and reply orchestration will live here.
      this.logger.log(
        JSON.stringify({
          event: 'whatsapp.audio.received',
          mediaId: message.mediaId,
          messageId: message.id,
          phoneNumberId: message.phoneNumberId,
          voice: message.voice,
        }),
      );
    }
  }

  extractAudioMessages(
    payload: WhatsAppWebhookPayload,
  ): WhatsAppAudioMessage[] {
    if (payload.object !== 'whatsapp_business_account') {
      return [];
    }

    const audioMessages: WhatsAppAudioMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') {
          continue;
        }

        for (const message of change.value?.messages ?? []) {
          if (
            message.type !== 'audio' ||
            !message.audio?.id ||
            !message.from ||
            !message.id
          ) {
            continue;
          }

          audioMessages.push({
            from: message.from,
            id: message.id,
            mediaId: message.audio.id,
            mimeType: message.audio.mime_type,
            phoneNumberId: change.value?.metadata?.phone_number_id,
            timestamp: message.timestamp,
            voice: message.audio.voice === true,
          });
        }
      }
    }

    return audioMessages;
  }

  private safeEqual(value: string, expected: string): boolean {
    const valueBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);

    return (
      valueBuffer.length === expectedBuffer.length &&
      timingSafeEqual(valueBuffer, expectedBuffer)
    );
  }
}
