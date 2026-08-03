import { registerAs } from '@nestjs/config';

const NORMALIZED_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const briefingScheduleConfig = registerAs('briefingSchedule', () => {
  const defaultTime = process.env.DEFAULT_BRIEFING_TIME ?? '06:00';
  const timeZone = process.env.DEFAULT_BRIEFING_TIME_ZONE ?? 'Europe/Berlin';

  if (!NORMALIZED_TIME_PATTERN.test(defaultTime)) {
    throw new Error('DEFAULT_BRIEFING_TIME must use 24-hour HH:mm format.');
  }

  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
  } catch {
    throw new Error(
      'DEFAULT_BRIEFING_TIME_ZONE must be a valid IANA time zone.',
    );
  }

  return { defaultTime, timeZone };
});
