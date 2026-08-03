import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => {
  const url = process.env.DATABASE_URL ?? '';

  if (!url) {
    throw new Error('DATABASE_URL is required.');
  }

  return { url };
});
