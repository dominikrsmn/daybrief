import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { whatsappConfig } from './whatsapp.config';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [ConfigModule.forFeature(whatsappConfig)],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
})
export class WhatsAppModule {}
