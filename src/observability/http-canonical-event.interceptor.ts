import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Observable } from 'rxjs';
import { catchError, finalize, throwError } from 'rxjs';
import { describeError } from './canonical-event';
import { CanonicalLogger } from './canonical-logger.service';

const TRACEPARENT_PATTERN =
  /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i;
const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

@Injectable()
export class HttpCanonicalEventInterceptor implements NestInterceptor {
  constructor(private readonly canonicalLogger: CanonicalLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startedAt = Date.now();
    const requestId = this.readRequestId(request);
    const traceId = this.readTraceId(request);
    let capturedError: unknown;

    response.setHeader('x-request-id', requestId);
    request.headers['x-request-id'] = requestId;

    return next.handle().pipe(
      catchError((error: unknown) => {
        capturedError = error;
        return throwError(() => error);
      }),
      finalize(() => {
        const statusCode = this.statusCode(response, capturedError);
        const route = request.route as { path?: unknown } | undefined;
        const routePath =
          typeof route?.path === 'string'
            ? `${request.baseUrl}${route.path}`
            : request.path;

        this.canonicalLogger.emit({
          duration_ms: Date.now() - startedAt,
          event: 'http.request',
          http: {
            method: request.method,
            request_body_bytes: this.readContentLength(request),
            response_body_bytes: this.readResponseLength(response),
            route: routePath,
            status_code: statusCode,
          },
          ...(capturedError === undefined
            ? {}
            : { error: describeError(capturedError) }),
          outcome:
            capturedError !== undefined || statusCode >= 400
              ? 'error'
              : 'success',
          request_id: requestId,
          timestamp: new Date(startedAt).toISOString(),
          ...(traceId ? { trace_id: traceId } : {}),
        });
      }),
    );
  }

  private readRequestId(request: Request): string {
    const candidate = request.header('x-request-id');

    return candidate && CORRELATION_ID_PATTERN.test(candidate)
      ? candidate
      : randomUUID();
  }

  private readTraceId(request: Request): string | undefined {
    const traceparent = request.header('traceparent');

    return traceparent?.match(TRACEPARENT_PATTERN)?.[1];
  }

  private readContentLength(request: Request): number | undefined {
    return this.parseLength(request.header('content-length'));
  }

  private readResponseLength(response: Response): number | undefined {
    const value = response.getHeader('content-length');

    return this.parseLength(Array.isArray(value) ? value[0] : value);
  }

  private parseLength(value: string | number | undefined): number | undefined {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private statusCode(response: Response, error: unknown): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    return error === undefined ? response.statusCode : 500;
  }
}
