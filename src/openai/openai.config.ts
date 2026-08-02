import { registerAs } from '@nestjs/config';

const DEFAULT_MODELS = {
  transcription: 'gpt-4o-transcribe',
  briefing: 'gpt-5.6',
} as const;

export const openAIConfig = registerAs('openai', () => ({
  apiKey: process.env.OPENAI_API_KEY,
  models: {
    transcription:
      process.env.OPENAI_TRANSCRIPTION_MODEL ?? DEFAULT_MODELS.transcription,
    briefing: process.env.OPENAI_BRIEFING_MODEL ?? DEFAULT_MODELS.briefing,
  },
}));
