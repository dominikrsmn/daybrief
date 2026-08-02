import type { Provider } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import OpenAI from 'openai';
import { openAIConfig } from './openai.config';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export const openAIProvider: Provider<OpenAI> = {
  provide: OPENAI_CLIENT,
  inject: [openAIConfig.KEY],
  useFactory: (config: ConfigType<typeof openAIConfig>) =>
    new OpenAI({
      apiKey: config.apiKey,
    }),
};
