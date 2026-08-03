import { Injectable } from '@nestjs/common';
import { AudioService } from '../audio/audio.service';
import { renderWhatsAppBriefingMessages } from '../briefing/briefing.renderer';
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
    message_count: number;
    outbound_message_ids: string[];
    total_length_chars: number;
  };
  transcription?: {
    character_count: number;
    duration_ms: number;
  };
  whatsapp_download?: WhatsAppDownloadTelemetry;
  whatsapp_replies?: WhatsAppReplyTelemetry[];
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
  ): Promise<readonly string[]> {
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
    const replies = renderWhatsAppBriefingMessages(briefing);

    stageStartedAt = Date.now();
    const replyTelemetry = replies.map((): WhatsAppReplyTelemetry => ({}));
    telemetry.whatsapp_replies = replyTelemetry;
    const outboundMessageIds: string[] = [];

    // Awaiting each send preserves the briefing's section order in WhatsApp.
    for (const [index, reply] of replies.entries()) {
      outboundMessageIds.push(
        await this.whatsAppService.reply(message, reply, replyTelemetry[index]),
      );
    }

    telemetry.reply = {
      duration_ms: Date.now() - stageStartedAt,
      message_count: replies.length,
      outbound_message_ids: outboundMessageIds,
      total_length_chars: replies.reduce(
        (total, reply) => total + reply.length,
        0,
      ),
    };

    return outboundMessageIds;
  }
}
