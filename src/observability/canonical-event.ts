export type CanonicalEventFields = Record<string, unknown>;

export interface CanonicalError {
  code?: string | number;
  message: string;
  retriable: boolean;
  type: string;
}

interface ErrorWithMetadata extends Error {
  code?: string | number;
  retriable?: boolean;
  status?: number;
}

/**
 * Converts thrown values into a bounded, queryable shape without serializing
 * stacks, request bodies, provider responses, or other potentially sensitive data.
 */
export function describeError(error: unknown): CanonicalError {
  if (!(error instanceof Error)) {
    return {
      message: 'Unknown error',
      retriable: false,
      type: 'UnknownError',
    };
  }

  const errorWithMetadata = error as ErrorWithMetadata;

  return {
    ...(errorWithMetadata.code !== undefined ||
    errorWithMetadata.status !== undefined
      ? { code: errorWithMetadata.code ?? errorWithMetadata.status }
      : {}),
    message: redactErrorMessage(error.message),
    retriable: errorWithMetadata.retriable ?? false,
    type: error.name,
  };
}

function redactErrorMessage(message: string): string {
  return message
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, 500);
}
