import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CanonicalLogger } from './canonical-logger.service';
import { HttpCanonicalEventInterceptor } from './http-canonical-event.interceptor';

@Global()
@Module({
  providers: [
    CanonicalLogger,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpCanonicalEventInterceptor,
    },
  ],
  exports: [CanonicalLogger],
})
export class ObservabilityModule {}
