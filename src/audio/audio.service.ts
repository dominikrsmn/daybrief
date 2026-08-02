import { Inject, Injectable } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import { OPENAI_CLIENT } from '../openai/openai.provider';
import type { UploadedAudioFile } from './audio-file.interface';

@Injectable()
export class AudioService {
  constructor(@Inject(OPENAI_CLIENT) private readonly openAI: OpenAI) {}

  async transcribe(file: UploadedAudioFile): Promise<string> {
    const transcription = await this.openAI.audio.transcriptions.create({
      file: await toFile(file.buffer, file.originalname, {
        type: file.mimetype,
      }),
      model: 'gpt-4o-transcribe',
    });

    return transcription.text;
  }
}
