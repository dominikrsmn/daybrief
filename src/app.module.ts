import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AudioModule } from './audio/audio.module';
import { openAIConfig } from './openai/openai.config';
import { OpenAIModule } from './openai/openai.module';
import { ObservabilityModule } from './observability/observability.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [openAIConfig],
    }),
    ScheduleModule.forRoot(),
    OpenAIModule,
    ObservabilityModule,
    AudioModule,
    WhatsAppModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
