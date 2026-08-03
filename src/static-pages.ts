import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function configureStaticPages(app: NestExpressApplication): void {
  app.useStaticAssets(join(process.cwd(), 'public'), {
    extensions: ['html'],
    index: false,
  });
}
