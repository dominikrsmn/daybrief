import {
  BadRequestException,
  Controller,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Briefing } from '../briefing/briefing.schema';
import { BriefingService } from '../briefing/briefing.service';
import type { UploadedAudioFile } from './audio-file.interface';
import { AudioService } from './audio.service';

const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;

@Controller('audio')
export class AudioController {
  constructor(
    private readonly audioService: AudioService,
    private readonly briefingService: BriefingService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: {
        files: 1,
        fileSize: MAX_AUDIO_FILE_SIZE,
      },
    }),
  )
  async transcribe(
    @UploadedFile() file?: UploadedAudioFile,
  ): Promise<Briefing> {
    if (!file) {
      throw new BadRequestException(
        'An audio file is required in the "audio" multipart field.',
      );
    }

    if (!file.mimetype.startsWith('audio/')) {
      throw new UnsupportedMediaTypeException(
        `Expected an audio file, received "${file.mimetype}".`,
      );
    }

    const transcription = await this.audioService.transcribe(file);

    return this.briefingService.createBriefing(transcription);
  }
}
