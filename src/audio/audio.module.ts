import { Module } from '@nestjs/common';
import { BriefingModule } from '../briefing/briefing.module';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';

@Module({
  imports: [BriefingModule],
  controllers: [AudioController],
  providers: [AudioService],
})
export class AudioModule {}
