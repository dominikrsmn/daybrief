import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { whatsappConfig } from './whatsapp.config';

@Injectable()
export class WhatsAppWebhookAuthenticator {
  constructor(
    @Inject(whatsappConfig.KEY)
    private readonly config: ConfigType<typeof whatsappConfig>,
  ) {}

  isVerificationConfigured(): boolean {
    return this.config.verifyToken.length > 0;
  }

  isValidVerifyToken(token?: string): boolean {
    if (!this.isVerificationConfigured() || token === undefined) {
      return false;
    }

    return this.safeEqual(token, this.config.verifyToken);
  }

  isSignatureConfigured(): boolean {
    return this.config.appSecret.length > 0;
  }

  isValidSignature(rawBody: Buffer | undefined, signature?: string): boolean {
    if (
      !this.isSignatureConfigured() ||
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

  private safeEqual(value: string, expected: string): boolean {
    const valueBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);

    return (
      valueBuffer.length === expectedBuffer.length &&
      timingSafeEqual(valueBuffer, expectedBuffer)
    );
  }
}
