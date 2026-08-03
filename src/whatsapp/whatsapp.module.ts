import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AudioModule } from '../audio/audio.module';
import { BriefingModule } from '../briefing/briefing.module';
import { VoiceBriefingProcessor } from './voice-briefing.processor';
import { whatsappConfig } from './whatsapp.config';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookAuthenticator } from './whatsapp-webhook.authenticator';
import { WhatsAppWebhookHandler } from './whatsapp-webhook.handler';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [
    ConfigModule.forFeature(whatsappConfig),
    AudioModule,
    BriefingModule,
  ],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppWebhookAuthenticator,
    WhatsAppWebhookHandler,
    VoiceBriefingProcessor,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
