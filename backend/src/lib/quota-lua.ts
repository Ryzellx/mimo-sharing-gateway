/**
 * Atomic quota primitives implemented as Lua scripts.
 *
 * Every script runs atomically inside Redis, so concurrent requests can never
 * observe a stale `used`/`reserved` pair. The invariant enforced by `RESERVE`
 * is: `used + reserved + amount <= allocated` at the moment of reservation.
 *
 * Reservation bookkeeping: the ZSET member is `scope|amount|requestId` scored
 * by expiry instant. Everything the reaper needs lives in the member itself, so
 * budget is always reclaimed even if the point-in-time reservation key is gone.
 */

export const RESERVE = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')
local allocated = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
if amount <= 0 then return -1 end
if used + reserved + amount > allocated then
  return 0
end
local member = ARGV[5] .. '|' .. ARGV[2] .. '|' .. ARGV[6]
redis.call('SET', KEYS[3], ARGV[5] .. '|' .. ARGV[2])
redis.call('ZADD', KEYS[4], tonumber(ARGV[4]) + (tonumber(ARGV[3]) * 1000), member)
redis.call('INCRBY', KEYS[2], amount)
return 1
`;

export const FINALIZE = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[4], v .. '|' .. ARGV[3])
local amount = tonumber(string.match(v, '|(%d+)$') or '0')
redis.call('DECRBY', KEYS[3], amount)
local actual = tonumber(ARGV[1])
local allocated = tonumber(ARGV[2])
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[3]) or '0')
local target = used + actual
local maxUsed = allocated - reserved
if maxUsed < 0 then maxUsed = 0 end
if target > maxUsed then target = maxUsed end
if target < 0 then target = 0 end
redis.call('SET', KEYS[2], target)
return amount
`;

export const RELEASE = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[3], v .. '|' .. ARGV[1])
local amount = tonumber(string.match(v, '|(%d+)$') or '0')
redis.call('DECRBY', KEYS[2], amount)
return amount
`;

export const REAP_EXPIRED = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
local n = 0
for i = 1, #ids do
  local m = ids[i]
  redis.call('ZREM', KEYS[1], m)
  local scope, amount, rid = string.match(m, '^(.*)|(%d+)|([^|]*)$')
  if scope then
    redis.call('DEL', ARGV[3] .. rid)
    redis.call('DECRBY', ARGV[2] .. scope, amount)
    n = n + 1
  end
end
return n
`;

export const RATE_LIMIT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local n = redis.call('ZCARD', KEYS[1])
if n >= limit then
  redis.call('PEXPIRE', KEYS[1], window)
  return 0
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return 1
`;

export const GET_COUNTERS = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')
return used .. ':' .. reserved
`;

export const SET_COUNTERS = `
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
return 1
`;

export const KEY = {
  used: (scope: string) => `quota:used:${scope}`,
  reserved: (scope: string) => `quota:reserved:${scope}`,
  reservedPrefix: 'quota:reserved:',
  reservation: (requestId: string) => `reservation:${requestId}`,
  reservationPrefix: 'reservation:',
  reservationsZset: 'reservations:expiry',
  rateWindow: (userId: string, window: string) => `rl:${userId}:${window}`,
};
