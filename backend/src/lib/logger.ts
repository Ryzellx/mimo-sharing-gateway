import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'mimoToken',
      'apiKey',
      'password',
      'token',
    ],
    censor: '[redacted]',
  },
  base: { service: 'mimo-gateway' },
});
