import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export const openAIProvider: Provider<OpenAI> = {
  provide: OPENAI_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    new OpenAI({
      apiKey: configService.getOrThrow<string>('OPENAI_API_KEY'),
    }),
};
