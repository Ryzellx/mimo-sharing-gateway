import type { FastifyError, FastifyInstance } from 'fastify';
import { GatewayError, errors } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Postgres SQLSTATE -> safe client-facing error. Prevents 23505/22P02/etc from surfacing as 500. */
function mapDbError(
  code: string | undefined,
  detail: string | undefined,
  constraint: string | undefined,
): GatewayError | null {
  switch (code) {
    case '23505': // unique_violation
      return errors.conflict(
        constraint?.includes('email')
          ? 'Email already registered'
          : constraint?.includes('username')
            ? 'Username already taken'
            : detail?.includes('email')
              ? 'Email already registered'
              : detail?.includes('username')
                ? 'Username already taken'
                : 'Resource already exists',
      );
    case '22P02': // invalid_text_representation (bad uuid, bad bigint text)
    case '22003': // numeric_value_out_of_range
    case '22001': // string_data_right_truncation
      return errors.validation('Invalid value for one of the provided fields');
    case '23503': // foreign_key_violation
      return errors.validation('Referenced resource does not exist');
    case '23502': // not_null_violation
      return errors.validation('Missing required field');
    default:
      return null;
  }
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | Error, _req, reply) => {
    if (error instanceof GatewayError) {
      return reply.code(error.status).send(error.toBody());
    }
    const fastifyErr = error as FastifyError;
    if (fastifyErr.validation) {
      const ve = errors.validation(fastifyErr.message);
      return reply.code(ve.status).send(ve.toBody());
    }

    // Database-level failures: translate known SQLSTATEs instead of a blanket 500.
    const dbCode = (error as { code?: string }).code;
    const dbDetail = (error as { detail?: string }).detail;
    const dbConstraint = (error as { constraint_name?: string }).constraint_name;
    if (typeof dbCode === 'string' && /^[0-9A-Z]{5}$/.test(dbCode)) {
      const mapped = mapDbError(dbCode, dbDetail, dbConstraint);
      if (mapped) {
        logger.warn({ code: dbCode, detail: dbDetail }, 'db error mapped to client error');
        return reply.code(mapped.status).send(mapped.toBody());
      }
    }

    if (fastifyErr.statusCode && fastifyErr.statusCode < 500) {
      const ve = errors.validation(fastifyErr.message);
      return reply.code(fastifyErr.statusCode).send(ve.toBody());
    }
    logger.error({ err: error }, 'unhandled error');
    const internal = errors.internal();
    return reply.code(internal.status).send(internal.toBody());
  });

  app.setNotFoundHandler((_req, reply) => {
    const e = errors.notFound('Route not found');
    return reply.code(e.status).send(e.toBody());
  });
}
