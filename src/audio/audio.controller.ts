import {
  BadRequestException,
  Controller,
  Post,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { UploadedAudioFile } from './audio-file.interface';
import { AudioService } from './audio.service';

const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024;

@Controller('audio')
export class AudioController {
  constructor(private readonly audioService: AudioService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: {
        files: 1,
        fileSize: MAX_AUDIO_FILE_SIZE,
      },
    }),
  )
  transcribe(@UploadedFile() file?: UploadedAudioFile): Promise<string> {
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

    return this.audioService.transcribe(file);
  }
}
