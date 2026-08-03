import { Temporal } from '@js-temporal/polyfill';

export interface BriefingScheduleInput {
  defaultTime: string;
  providerTimestamp?: string;
  timeZone: string;
  wakeupTime: string | null;
}

export interface ResolvedBriefingSchedule {
  scheduledAt: string;
  source: 'default' | 'user';
}

/**
 * Resolves the next local calendar day's delivery time from the provider's
 * recording timestamp. This keeps "tomorrow" stable across processing delays
 * and daylight-saving transitions.
 */
export function resolveBriefingSchedule({
  defaultTime,
  providerTimestamp,
  timeZone,
  wakeupTime,
}: BriefingScheduleInput): ResolvedBriefingSchedule {
  const recordingInstant = parseProviderTimestamp(providerTimestamp);
  const deliveryTime = Temporal.PlainTime.from(wakeupTime ?? defaultTime);
  const deliveryDate = recordingInstant
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()
    .add({ days: 1 });
  const scheduledAt = deliveryDate
    .toPlainDateTime(deliveryTime)
    .toZonedDateTime(timeZone, { disambiguation: 'compatible' })
    .toInstant()
    .toString();

  return {
    scheduledAt,
    source: wakeupTime ? 'user' : 'default',
  };
}

function parseProviderTimestamp(providerTimestamp?: string): Temporal.Instant {
  if (providerTimestamp && /^\d+$/.test(providerTimestamp)) {
    const epochMilliseconds = Number(providerTimestamp) * 1_000;

    if (Number.isSafeInteger(epochMilliseconds)) {
      return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
    }
  }

  return Temporal.Now.instant();
}
