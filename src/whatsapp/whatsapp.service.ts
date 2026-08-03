import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { whatsappConfig } from './whatsapp.config';
import type {
  WhatsAppAudioMessage,
  WhatsAppMessageReference,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

interface WhatsAppSendMessageResponse {
  messages?: Array<{ id?: string }>;
}

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

  /**
   * Sends a plain-text WhatsApp reply linked to an inbound message.
   *
   * The receiving phone-number ID comes from the webhook payload so this also
   * works when the app is connected to more than one business phone number.
   * Returns the provider-assigned ID of the outbound message.
   */
  async reply(
    message: WhatsAppMessageReference,
    body: string,
  ): Promise<string> {
    const normalizedBody = body.trim();

    if (normalizedBody.length === 0) {
      throw new BadRequestException('A WhatsApp reply body is required.');
    }

    if (normalizedBody.length > 4_096) {
      throw new BadRequestException(
        'A WhatsApp reply body cannot exceed 4096 characters.',
      );
    }

    if (!message.phoneNumberId) {
      throw new BadRequestException(
        'The inbound WhatsApp message has no receiving phone-number ID.',
      );
    }

    if (!this.config.accessToken || !this.config.graphApiVersion) {
      throw new ServiceUnavailableException(
        'WhatsApp message sending is not configured.',
      );
    }

    const endpoint = new URL(
      `${this.config.graphApiVersion}/${encodeURIComponent(message.phoneNumberId)}/messages`,
      'https://graph.facebook.com',
    );

    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.from,
          context: { message_id: message.id },
          type: 'text',
          text: {
            body: normalizedBody,
            preview_url: false,
          },
        }),
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp.reply.failed',
          messageId: message.id,
          reason: error instanceof Error ? error.message : 'request_failed',
        }),
      );
      throw new BadGatewayException('WhatsApp could not be reached.');
    }

    if (!response.ok) {
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp.reply.rejected',
          messageId: message.id,
          status: response.status,
        }),
      );
      throw new BadGatewayException('WhatsApp rejected the reply.');
    }

    let result: WhatsAppSendMessageResponse;

    try {
      result = (await response.json()) as WhatsAppSendMessageResponse;
    } catch {
      throw new BadGatewayException(
        'WhatsApp returned an invalid reply response.',
      );
    }
    const replyMessageId = result.messages?.[0]?.id;

    if (!replyMessageId) {
      throw new BadGatewayException(
        'WhatsApp did not return an outbound message ID.',
      );
    }

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp.reply.sent',
        inboundMessageId: message.id,
        outboundMessageId: replyMessageId,
      }),
    );

    return replyMessageId;
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
      this.logger.log("payload.object !== 'whatsapp_business_account'");
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
    this.logger.log('got ' + audioMessages.length + ' audio messages');

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
