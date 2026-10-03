export const ERROR_CODES = [
  'INVALID_API_KEY',
  'USER_DISABLED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'MIMO_UNAVAILABLE',
  'MIMO_AUTH_ERROR',
  'MODEL_NOT_FOUND',
  'UPSTREAM_ERROR',
  'REQUEST_TIMEOUT',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'INTERNAL_ERROR',
  'USER_EXPIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_API_KEY: 401,
  USER_DISABLED: 403,
  USER_EXPIRED: 403,
  QUOTA_EXCEEDED: 402,
  RATE_LIMITED: 429,
  MIMO_UNAVAILABLE: 503,
  MIMO_AUTH_ERROR: 502,
  MODEL_NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
  REQUEST_TIMEOUT: 504,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly type: string;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status ?? STATUS_BY_CODE[code];
    this.type = code.toLowerCase();
  }

  toBody() {
    return {
      error: {
        message: this.message,
        type: this.type,
        code: this.code,
      },
    };
  }
}

export const errors = {
  invalidApiKey: () => new GatewayError('INVALID_API_KEY', 'Invalid API key'),
  invalidCredentials: () => new GatewayError('INVALID_API_KEY', 'Invalid credentials'),
  userDisabled: () => new GatewayError('USER_DISABLED', 'User account is disabled'),
  userExpired: () => new GatewayError('USER_EXPIRED', 'User quota window has expired'),
  quotaExceeded: (detail?: string) =>
    new GatewayError('QUOTA_EXCEEDED', detail ?? 'Quota exhausted'),
  rateLimited: (retryAfter: number) =>
    new GatewayError('RATE_LIMITED', `Rate limit exceeded, retry in ${retryAfter}s`),
  mimoUnavailable: () => new GatewayError('MIMO_UNAVAILABLE', 'Mimo upstream unavailable'),
  mimoAuthError: () => new GatewayError('MIMO_AUTH_ERROR', 'Mimo token rejected by upstream'),
  modelNotFound: (model: string) =>
    new GatewayError('MODEL_NOT_FOUND', `Model not found: ${model}`),
  upstreamError: (detail?: string) =>
    new GatewayError('UPSTREAM_ERROR', detail ?? 'Upstream request failed'),
  requestTimeout: () => new GatewayError('REQUEST_TIMEOUT', 'Upstream request timed out'),
  validation: (detail: string) => new GatewayError('VALIDATION_ERROR', detail),
  notFound: (detail: string) => new GatewayError('NOT_FOUND', detail),
  forbidden: (detail: string) => new GatewayError('FORBIDDEN', detail),
  conflict: (detail: string) => new GatewayError('CONFLICT', detail),
  internal: (detail?: string) => new GatewayError('INTERNAL_ERROR', detail ?? 'Internal error'),
};
