import { Injectable } from '@nestjs/common';
import { AudioService } from '../audio/audio.service';
import { renderWhatsAppBriefing } from '../briefing/briefing.renderer';
import { BriefingService } from '../briefing/briefing.service';
import type { WhatsAppAudioMessage } from './whatsapp-webhook.types';
import {
  WhatsAppService,
  type WhatsAppDownloadTelemetry,
  type WhatsAppReplyTelemetry,
} from './whatsapp.service';

export interface VoiceBriefingTelemetry {
  audio?: {
    download_duration_ms: number;
    mime_type: string;
    size_bytes: number;
  };
  briefing?: {
    commitments: number;
    context_items: number;
    duration_ms: number;
    language: 'de' | 'en';
    open_questions: number;
    reminders: number;
    tasks: number;
  };
  reply?: {
    duration_ms: number;
    message_length_chars: number;
    outbound_message_id: string;
  };
  transcription?: {
    character_count: number;
    duration_ms: number;
  };
  whatsapp_download?: WhatsAppDownloadTelemetry;
  whatsapp_reply?: WhatsAppReplyTelemetry;
}

@Injectable()
export class VoiceBriefingProcessor {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly audioService: AudioService,
    private readonly briefingService: BriefingService,
  ) {}

  async process(
    message: WhatsAppAudioMessage,
    telemetry: VoiceBriefingTelemetry,
  ): Promise<string> {
    let stageStartedAt = Date.now();
    const downloadTelemetry: WhatsAppDownloadTelemetry = {};
    telemetry.whatsapp_download = downloadTelemetry;
    const audioFile = await this.whatsAppService.downloadAudio(
      message,
      downloadTelemetry,
    );
    telemetry.audio = {
      download_duration_ms: Date.now() - stageStartedAt,
      mime_type: audioFile.mimetype,
      size_bytes: audioFile.size,
    };

    stageStartedAt = Date.now();
    const transcription = await this.audioService.transcribe(audioFile);
    telemetry.transcription = {
      character_count: transcription.length,
      duration_ms: Date.now() - stageStartedAt,
    };

    stageStartedAt = Date.now();
    const briefing = await this.briefingService.createBriefing(transcription);
    telemetry.briefing = {
      commitments: briefing.commitments.length,
      context_items: briefing.context.length,
      duration_ms: Date.now() - stageStartedAt,
      language: briefing.language,
      open_questions: briefing.openQuestions.length,
      reminders: briefing.reminders.length,
      tasks: briefing.tasks.length,
    };
    const reply = renderWhatsAppBriefing(briefing);

    stageStartedAt = Date.now();
    const replyTelemetry: WhatsAppReplyTelemetry = {};
    telemetry.whatsapp_reply = replyTelemetry;
    const outboundMessageId = await this.whatsAppService.reply(
      message,
      reply,
      replyTelemetry,
    );
    telemetry.reply = {
      duration_ms: Date.now() - stageStartedAt,
      message_length_chars: reply.length,
      outbound_message_id: outboundMessageId,
    };

    return outboundMessageId;
  }
}
