import type { Provider } from '@nestjs/common';
import OpenAI from 'openai';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export const openAIProvider: Provider<OpenAI> = {
  provide: OPENAI_CLIENT,
  useFactory: () => new OpenAI(),
};
