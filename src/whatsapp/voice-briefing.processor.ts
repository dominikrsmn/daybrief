import { Injectable } from '@nestjs/common';
import { AudioService } from '../audio/audio.service';
import { renderWhatsAppBriefing } from '../briefing/briefing.renderer';
import { BriefingService } from '../briefing/briefing.service';
import type { WhatsAppAudioMessage } from './whatsapp-webhook.types';
import { WhatsAppService } from './whatsapp.service';

@Injectable()
export class VoiceBriefingProcessor {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly audioService: AudioService,
    private readonly briefingService: BriefingService,
  ) {}

  async process(message: WhatsAppAudioMessage): Promise<string> {
    const audioFile = await this.whatsAppService.downloadAudio(message);
    const transcription = await this.audioService.transcribe(audioFile);
    const briefing = await this.briefingService.createBriefing(transcription);
    const reply = renderWhatsAppBriefing(briefing);

    return this.whatsAppService.reply(message, reply);
  }
}
