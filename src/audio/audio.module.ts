import { Module } from '@nestjs/common';
import { openAIProvider } from '../openai/openai.provider';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';

@Module({
  controllers: [AudioController],
  providers: [AudioService, openAIProvider],
})
export class AudioModule {}
