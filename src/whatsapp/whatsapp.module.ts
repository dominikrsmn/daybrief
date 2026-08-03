import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AudioModule } from '../audio/audio.module';
import { BriefingModule } from '../briefing/briefing.module';
import { whatsappConfig } from './whatsapp.config';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [
    ConfigModule.forFeature(whatsappConfig),
    AudioModule,
    BriefingModule,
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
