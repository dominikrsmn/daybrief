import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  MAX_AUDIO_FILE_SIZE_BYTES,
  type UploadedAudioFile,
} from '../audio/audio-file.interface';
import { AudioService } from '../audio/audio.service';
import { BriefingService } from '../briefing/briefing.service';
import { whatsappConfig } from './whatsapp.config';
import type {
  WhatsAppAudioMessage,
  WhatsAppMessageReference,
  WhatsAppWebhookPayload,
} from './whatsapp-webhook.types';

interface WhatsAppSendMessageResponse {
  messages?: Array<{ id?: string }>;
}

interface WhatsAppApiErrorResponse {
  error?: {
    code?: number;
    error_data?: {
      details?: string;
      messaging_product?: string;
    };
    error_subcode?: number;
    fbtrace_id?: string;
    message?: string;
    type?: string;
  };
}

interface WhatsAppMediaMetadataResponse {
  file_size?: number;
  id?: string;
  mime_type?: string;
  sha256?: string;
  url?: string;
}

const AUDIO_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/x-wav': 'wav',
};

const PROCESSED_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1_000;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly processingMessageIds = new Set<string>();
  private readonly processedMessageExpirations = new Map<string, number>();

  constructor(
    @Inject(whatsappConfig.KEY)
    private readonly config: ConfigType<typeof whatsappConfig>,
    private readonly audioService: AudioService,
    private readonly briefingService: BriefingService,
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
   * Resolves and downloads audio attached to an inbound WhatsApp message.
   *
   * Meta's media URL is short-lived and still requires bearer authentication,
   * so both requests happen within this method. The returned object can be
   * passed directly to AudioService.transcribe().
   */
  async downloadAudio(
    message: WhatsAppAudioMessage,
  ): Promise<UploadedAudioFile> {
    this.assertCloudApiConfigured();

    const metadataEndpoint = new URL(
      `${this.config.graphApiVersion}/${encodeURIComponent(message.mediaId)}`,
      'https://graph.facebook.com',
    );
    const metadataResponse = await this.fetchFromWhatsApp(
      metadataEndpoint,
      'metadata',
      message,
    );
    const metadata =
      await this.parseJsonResponse<WhatsAppMediaMetadataResponse>(
        metadataResponse,
        'WhatsApp returned invalid audio metadata.',
      );

    if (!metadata.url || !metadata.mime_type?.startsWith('audio/')) {
      throw new BadGatewayException(
        'WhatsApp returned incomplete audio metadata.',
      );
    }

    if (
      metadata.file_size !== undefined &&
      metadata.file_size > MAX_AUDIO_FILE_SIZE_BYTES
    ) {
      throw new BadGatewayException(
        'The WhatsApp audio file exceeds the 25 MiB limit.',
      );
    }

    const mediaUrl = this.parseTrustedMediaUrl(metadata.url);
    const mediaResponse = await this.fetchFromWhatsApp(
      mediaUrl,
      'content',
      message,
    );
    const buffer = await this.readBoundedMediaBody(mediaResponse);

    if (metadata.sha256 && !this.matchesSha256(buffer, metadata.sha256)) {
      throw new BadGatewayException(
        'The downloaded WhatsApp audio failed its integrity check.',
      );
    }

    const mimeType = metadata.mime_type;
    const baseMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
    const extension = AUDIO_FILE_EXTENSIONS[baseMimeType] ?? 'audio';
    const safeMediaId = message.mediaId.replace(/[^a-zA-Z0-9_-]/g, '_');

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp.audio.downloaded',
        mediaId: message.mediaId,
        messageId: message.id,
        mimeType,
        size: buffer.length,
      }),
    );

    return {
      buffer,
      mimetype: mimeType,
      originalname: `whatsapp-${safeMediaId}.${extension}`,
      size: buffer.length,
    };
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

    this.assertCloudApiConfigured();

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
      const providerError = await this.parseWhatsAppApiError(response);

      this.logger.error(
        JSON.stringify({
          event: 'whatsapp.reply.rejected',
          messageId: message.id,
          providerError,
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
    this.removeExpiredProcessedMessageIds();

    for (const message of this.extractAudioMessages(payload)) {
      if (
        this.processingMessageIds.has(message.id) ||
        this.processedMessageExpirations.has(message.id)
      ) {
        this.logger.log(
          JSON.stringify({
            event: 'whatsapp.audio.duplicate_ignored',
            messageId: message.id,
          }),
        );
        continue;
      }

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
      void this.processAudioMessage(message)
        .then(() => {
          this.processedMessageExpirations.set(
            message.id,
            Date.now() + PROCESSED_MESSAGE_RETENTION_MS,
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

  /**
   * Runs the user-visible voice-message flow in strict order. A reply is sent
   * only after every prior stage has completed successfully, preventing a
   * partial or misleading briefing from reaching the user.
   */
  private async processAudioMessage(
    message: WhatsAppAudioMessage,
  ): Promise<void> {
    const startedAt = Date.now();
    const audioFile = await this.downloadAudio(message);
    const transcription = await this.audioService.transcribe(audioFile);
    const briefing = await this.briefingService.createBriefing(transcription);
    const outboundMessageId = await this.reply(message, briefing.text);

    this.logger.log(
      JSON.stringify({
        event: 'whatsapp.audio.processing_completed',
        durationMs: Date.now() - startedAt,
        inboundMessageId: message.id,
        outboundMessageId,
      }),
    );
  }

  private removeExpiredProcessedMessageIds(): void {
    const now = Date.now();

    for (const [messageId, expiresAt] of this.processedMessageExpirations) {
      if (expiresAt <= now) {
        this.processedMessageExpirations.delete(messageId);
      }
    }
  }

  private assertCloudApiConfigured(): void {
    if (!this.config.accessToken || !this.config.graphApiVersion) {
      throw new ServiceUnavailableException(
        'The WhatsApp Cloud API is not configured.',
      );
    }
  }

  private async fetchFromWhatsApp(
    url: URL,
    resource: 'content' | 'metadata',
    message: WhatsAppAudioMessage,
  ): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp.audio.download_failed',
          mediaId: message.mediaId,
          messageId: message.id,
          reason: error instanceof Error ? error.message : 'request_failed',
          resource,
        }),
      );
      throw new BadGatewayException('WhatsApp media could not be reached.');
    }

    if (!response.ok) {
      this.logger.error(
        JSON.stringify({
          event: 'whatsapp.audio.download_rejected',
          mediaId: message.mediaId,
          messageId: message.id,
          resource,
          status: response.status,
        }),
      );
      throw new BadGatewayException('WhatsApp rejected the media download.');
    }

    return response;
  }

  private async parseJsonResponse<T>(
    response: Response,
    errorMessage: string,
  ): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException(errorMessage);
    }
  }

  private async parseWhatsAppApiError(
    response: Response,
  ): Promise<WhatsAppApiErrorResponse | { unavailable: true }> {
    try {
      return (await response.json()) as WhatsAppApiErrorResponse;
    } catch {
      return { unavailable: true };
    }
  }

  private parseTrustedMediaUrl(value: string): URL {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new BadGatewayException('WhatsApp returned an invalid media URL.');
    }

    const trustedHost = ['facebook.com', 'fbcdn.net', 'fbsbx.com'].some(
      (domain) =>
        url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    );

    if (url.protocol !== 'https:' || !trustedHost) {
      throw new BadGatewayException(
        'WhatsApp returned an untrusted media URL.',
      );
    }

    return url;
  }

  private async readBoundedMediaBody(response: Response): Promise<Buffer> {
    const contentLength = Number(response.headers.get('content-length'));

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_AUDIO_FILE_SIZE_BYTES
    ) {
      throw new BadGatewayException(
        'The WhatsApp audio file exceeds the 25 MiB limit.',
      );
    }

    if (!response.body) {
      throw new BadGatewayException('WhatsApp returned an empty audio file.');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;
      if (size > MAX_AUDIO_FILE_SIZE_BYTES) {
        await reader.cancel();
        throw new BadGatewayException(
          'The WhatsApp audio file exceeds the 25 MiB limit.',
        );
      }
      chunks.push(value);
    }

    if (size === 0) {
      throw new BadGatewayException('WhatsApp returned an empty audio file.');
    }

    return Buffer.concat(chunks, size);
  }

  private matchesSha256(buffer: Buffer, expected: string): boolean {
    const digestEncoding = /^[a-f\d]{64}$/i.test(expected) ? 'hex' : 'base64';
    const actual = createHash('sha256').update(buffer).digest(digestEncoding);

    return this.safeEqual(actual, expected);
  }
}
