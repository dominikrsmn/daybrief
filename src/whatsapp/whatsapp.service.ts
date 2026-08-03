import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  MAX_AUDIO_FILE_SIZE_BYTES,
  type UploadedAudioFile,
} from '../audio/audio-file.interface';
import { whatsappConfig } from './whatsapp.config';
import type {
  WhatsAppAudioMessage,
  WhatsAppMessageReference,
} from './whatsapp-webhook.types';

interface WhatsAppSendMessageResponse {
  messages?: Array<{ id?: string }>;
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

const WHATSAPP_FETCH_MAX_ATTEMPTS = 3;
const WHATSAPP_FETCH_RETRY_BASE_DELAY_MS = 250;
const WHATSAPP_FETCH_RETRY_MAX_DELAY_MS = 5_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

interface WhatsAppFetchTelemetry {
  attempts?: number;
  last_network_error_code?: string;
  last_status_code?: number;
  retry_delay_ms?: number;
}

export interface WhatsAppDownloadTelemetry {
  content?: WhatsAppFetchTelemetry;
  metadata?: WhatsAppFetchTelemetry;
}

export interface WhatsAppReplyTelemetry {
  status_code?: number;
}

@Injectable()
export class WhatsAppService {
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
   * Resolves and downloads audio attached to an inbound WhatsApp message.
   *
   * Meta's media URL is short-lived and still requires bearer authentication,
   * so both requests happen within this method. The returned object can be
   * passed directly to AudioService.transcribe().
   */
  async downloadAudio(
    message: WhatsAppAudioMessage,
    telemetry: WhatsAppDownloadTelemetry = {},
  ): Promise<UploadedAudioFile> {
    this.assertCloudApiConfigured();

    const metadataEndpoint = new URL(
      `${this.config.graphApiVersion}/${encodeURIComponent(message.mediaId)}`,
      'https://graph.facebook.com',
    );
    const metadataResponse = await this.fetchFromWhatsApp(
      metadataEndpoint,
      'metadata',
      telemetry,
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
      telemetry,
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
    telemetry: WhatsAppReplyTelemetry = {},
  ): Promise<string> {
    return this.sendText(message, body, telemetry, message.id);
  }

  /** Sends a plain-text WhatsApp message without linking it as a reply. */
  async send(
    message: WhatsAppMessageReference,
    body: string,
    telemetry: WhatsAppReplyTelemetry = {},
  ): Promise<string> {
    return this.sendText(message, body, telemetry);
  }

  private async sendText(
    message: WhatsAppMessageReference,
    body: string,
    telemetry: WhatsAppReplyTelemetry,
    replyToMessageId?: string,
  ): Promise<string> {
    const normalizedBody = body.trim();

    if (normalizedBody.length === 0) {
      throw new BadRequestException('A WhatsApp message body is required.');
    }

    if (normalizedBody.length > 4_096) {
      throw new BadRequestException(
        'A WhatsApp message body cannot exceed 4096 characters.',
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
          ...(replyToMessageId
            ? { context: { message_id: replyToMessageId } }
            : {}),
          type: 'text',
          text: {
            body: normalizedBody,
            preview_url: false,
          },
        }),
      });
    } catch {
      throw new BadGatewayException('WhatsApp could not be reached.');
    }

    telemetry.status_code = response.status;

    if (!response.ok) {
      await this.discardResponseBody(response);
      throw new BadGatewayException('WhatsApp rejected the message.');
    }

    let result: WhatsAppSendMessageResponse;

    try {
      result = (await response.json()) as WhatsAppSendMessageResponse;
    } catch {
      throw new BadGatewayException(
        'WhatsApp returned an invalid message response.',
      );
    }
    const replyMessageId = result.messages?.[0]?.id;

    if (!replyMessageId) {
      throw new BadGatewayException(
        'WhatsApp did not return an outbound message ID.',
      );
    }

    return replyMessageId;
  }

  private safeEqual(value: string, expected: string): boolean {
    const valueBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);

    return (
      valueBuffer.length === expectedBuffer.length &&
      timingSafeEqual(valueBuffer, expectedBuffer)
    );
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
    downloadTelemetry: WhatsAppDownloadTelemetry,
  ): Promise<Response> {
    const telemetry = (downloadTelemetry[resource] ??= {});

    // Media retrieval is GET-only, so transient retries cannot duplicate a
    // provider-side mutation. Permanent client errors still fail immediately.
    for (let attempt = 1; attempt <= WHATSAPP_FETCH_MAX_ATTEMPTS; attempt++) {
      let response: Response;
      telemetry.attempts = attempt;

      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.config.accessToken}` },
        });
      } catch (error) {
        telemetry.last_network_error_code = this.getNetworkErrorCode(error);

        if (attempt < WHATSAPP_FETCH_MAX_ATTEMPTS) {
          const delayMs = this.calculateRetryDelay(attempt);
          telemetry.retry_delay_ms = (telemetry.retry_delay_ms ?? 0) + delayMs;
          await this.delay(delayMs);
          continue;
        }

        throw new BadGatewayException('WhatsApp media could not be reached.');
      }

      telemetry.last_status_code = response.status;

      if (response.ok) {
        return response;
      }

      if (
        RETRYABLE_HTTP_STATUSES.has(response.status) &&
        attempt < WHATSAPP_FETCH_MAX_ATTEMPTS
      ) {
        const delayMs = this.calculateRetryDelay(
          attempt,
          response.headers.get('retry-after'),
        );
        await this.discardResponseBody(response);
        telemetry.retry_delay_ms = (telemetry.retry_delay_ms ?? 0) + delayMs;
        await this.delay(delayMs);
        continue;
      }

      throw new BadGatewayException('WhatsApp rejected the media download.');
    }

    throw new BadGatewayException('WhatsApp media could not be reached.');
  }

  private calculateRetryDelay(
    failedAttempt: number,
    retryAfterHeader?: string | null,
  ): number {
    const exponentialDelay = Math.min(
      WHATSAPP_FETCH_RETRY_BASE_DELAY_MS * 2 ** (failedAttempt - 1),
      WHATSAPP_FETCH_RETRY_MAX_DELAY_MS,
    );
    const jitteredDelay = Math.round(
      exponentialDelay * (0.75 + Math.random() * 0.5),
    );
    const retryAfterDelay = this.parseRetryAfter(retryAfterHeader);

    return Math.min(
      Math.max(jitteredDelay, retryAfterDelay ?? 0),
      WHATSAPP_FETCH_RETRY_MAX_DELAY_MS,
    );
  }

  private parseRetryAfter(value?: string | null): number | undefined {
    if (!value) {
      return undefined;
    }

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1_000);
    }

    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  private async discardResponseBody(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // The retry is still safe if the remote peer already closed the body.
    }
  }

  private getNetworkErrorCode(error: unknown): string | undefined {
    if (
      !(error instanceof Error) ||
      !error.cause ||
      typeof error.cause !== 'object'
    ) {
      return undefined;
    }

    const cause = error.cause as Record<string, unknown>;
    return typeof cause.code === 'string' ? cause.code : undefined;
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
