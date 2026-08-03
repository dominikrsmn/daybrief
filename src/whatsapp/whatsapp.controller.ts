import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { WhatsAppWebhookPayload } from './whatsapp-webhook.types';
import { WhatsAppWebhookAuthenticator } from './whatsapp-webhook.authenticator';
import { WhatsAppWebhookHandler } from './whatsapp-webhook.handler';

@Controller('webhooks/whatsapp')
export class WhatsAppController {
  constructor(
    private readonly webhookAuthenticator: WhatsAppWebhookAuthenticator,
    private readonly webhookHandler: WhatsAppWebhookHandler,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (!this.webhookAuthenticator.isVerificationConfigured()) {
      throw new ServiceUnavailableException(
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured.',
      );
    }

    if (
      mode !== 'subscribe' ||
      challenge === undefined ||
      !this.webhookAuthenticator.isValidVerifyToken(verifyToken)
    ) {
      throw new ForbiddenException('Webhook verification failed.');
    }

    return challenge;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  receiveWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() payload: WhatsAppWebhookPayload,
  ): { received: true } {
    if (!this.webhookAuthenticator.isSignatureConfigured()) {
      throw new ServiceUnavailableException(
        'WHATSAPP_APP_SECRET is not configured.',
      );
    }

    if (
      !this.webhookAuthenticator.isValidSignature(request.rawBody, signature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }

    this.webhookHandler.handle(payload, requestId);

    return { received: true };
  }
}
