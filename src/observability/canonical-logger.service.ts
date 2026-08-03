import { Injectable, Logger } from '@nestjs/common';
import type { CanonicalEventFields } from './canonical-event';

export type CanonicalEventOutcome = 'error' | 'ignored' | 'success';

export interface CanonicalEvent extends CanonicalEventFields {
  duration_ms: number;
  event: string;
  outcome: CanonicalEventOutcome;
  timestamp: string;
}

@Injectable()
export class CanonicalLogger {
  private readonly logger = new Logger('CanonicalEvent');
  private readonly environment = process.env.NODE_ENV || 'development';
  private readonly slowEventThresholdMs = this.readNumber(
    process.env.LOG_SLOW_EVENT_THRESHOLD_MS,
    2_000,
  );
  private readonly successSampleRate = this.readSampleRate(
    process.env.LOG_SUCCESS_SAMPLE_RATE,
  );

  /** Emits the authoritative, structured record for one completed operation. */
  emit(event: CanonicalEvent): void {
    const enrichedEvent = {
      ...event,
      event_kind: 'canonical',
      schema_version: 1,
    };

    if (!this.shouldKeep(enrichedEvent)) {
      return;
    }

    if (event.outcome === 'error') {
      this.logger.error(enrichedEvent);
      return;
    }

    this.logger.log(enrichedEvent);
  }

  private shouldKeep(event: CanonicalEvent): boolean {
    if (
      event.force_keep === true ||
      event.outcome !== 'success' ||
      event.duration_ms >= this.slowEventThresholdMs
    ) {
      return true;
    }

    return Math.random() < this.successSampleRate;
  }

  private readSampleRate(value: string | undefined): number {
    const defaultRate = this.environment === 'production' ? 0.05 : 1;
    const rate = this.readNumber(value, defaultRate);

    return Math.min(1, Math.max(0, rate));
  }

  private readNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
