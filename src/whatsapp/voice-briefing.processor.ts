import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AudioService } from '../audio/audio.service';
import { BriefingService } from '../briefing/briefing.service';
import { briefingScheduleConfig } from '../scheduling/briefing-schedule.config';
import { resolveBriefingSchedule } from '../scheduling/briefing-schedule';
import { ScheduledBriefingRepository } from '../scheduling/scheduled-briefing.repository';
import type { WhatsAppAudioMessage } from './whatsapp-webhook.types';
import {
  WhatsAppService,
  type WhatsAppDownloadTelemetry,
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
  scheduling?: {
    duration_ms: number;
    source: 'default' | 'user';
  };
  transcription?: {
    character_count: number;
    duration_ms: number;
  };
  whatsapp_download?: WhatsAppDownloadTelemetry;
}

@Injectable()
export class VoiceBriefingProcessor {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly audioService: AudioService,
    private readonly briefingService: BriefingService,
    private readonly scheduledBriefings: ScheduledBriefingRepository,
    @Inject(briefingScheduleConfig.KEY)
    private readonly scheduleConfig: ConfigType<typeof briefingScheduleConfig>,
  ) {}

  async process(
    message: WhatsAppAudioMessage,
    telemetry: VoiceBriefingTelemetry,
  ): Promise<{ briefingId: string; scheduledAt: string }> {
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
    const relatedTasks = briefing.commitments.reduce(
      (total, commitment) => total + commitment.relatedTasks.length,
      0,
    );
    const relatedContextItems = briefing.commitments.reduce(
      (total, commitment) => total + commitment.relatedContext.length,
      0,
    );
    telemetry.briefing = {
      commitments: briefing.commitments.length,
      context_items: briefing.context.length + relatedContextItems,
      duration_ms: Date.now() - stageStartedAt,
      language: briefing.language,
      open_questions: briefing.openQuestions.length,
      reminders: briefing.reminders.length,
      tasks: briefing.tasks.length + relatedTasks,
    };
    stageStartedAt = Date.now();
    const schedule = resolveBriefingSchedule({
      defaultTime: this.scheduleConfig.defaultTime,
      providerTimestamp: message.timestamp,
      timeZone: this.scheduleConfig.timeZone,
      wakeupTime: briefing.wakeupTime,
    });
    const scheduledBriefing = await this.scheduledBriefings.schedule({
      briefing,
      inboundMessageId: message.id,
      phoneNumberId: message.phoneNumberId,
      recipient: message.from,
      scheduledAt: schedule.scheduledAt,
    });
    telemetry.scheduling = {
      duration_ms: Date.now() - stageStartedAt,
      source: schedule.source,
    };

    return {
      briefingId: scheduledBriefing.id,
      scheduledAt: scheduledBriefing.scheduledAt,
    };
  }
}
