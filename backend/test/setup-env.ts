process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.JWT_SECRET ??= 'test-jwt-secret-with-enough-entropy-000';
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-with-enough-entropy';
process.env.MIMO_API_URL ??= 'http://127.0.0.1:9999/v1';
process.env.LOG_LEVEL ??= 'error';
