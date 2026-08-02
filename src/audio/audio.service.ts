import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';
import { openAIConfig } from '../openai/openai.config';
import { OPENAI_CLIENT } from '../openai/openai.provider';
import type { UploadedAudioFile } from './audio-file.interface';

@Injectable()
export class AudioService {
  constructor(
    @Inject(OPENAI_CLIENT) private readonly openAI: OpenAI,
    @Inject(openAIConfig.KEY)
    private readonly config: ConfigType<typeof openAIConfig>,
  ) {}

  async transcribe(file: UploadedAudioFile): Promise<string> {
    const transcription = await this.openAI.audio.transcriptions.create({
      file: await toFile(file.buffer, file.originalname, {
        type: file.mimetype,
      }),
      model: this.config.models.transcription,
    });

    return transcription.text;
  }
}
