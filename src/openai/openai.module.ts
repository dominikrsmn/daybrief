import { Global, Module } from '@nestjs/common';
import { openAIProvider } from './openai.provider';

@Global()
@Module({
  providers: [openAIProvider],
  exports: [openAIProvider],
})
export class OpenAIModule {}
