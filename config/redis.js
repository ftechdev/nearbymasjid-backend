const Redis = require('ioredis');

// The cache is a pure perf optimization, never a source of truth — every helper
// below fails soft (returns null / no-ops) so a Redis outage or misconfiguration
// never breaks a request; routes always have the DB as the real fallback.
let client = null;

if (process.env.REDIS_URL) {
  client = new Redis(process.env.REDIS_URL, {
    connectTimeout: 8000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // fail fast instead of queueing/blocking a request while disconnected
    retryStrategy: (times) => Math.min(times * 1000, 10000),
  });

  client.on('connect', () => console.log('✅ Redis connected'));
  client.on('error', (err) => console.warn('⚠️ Redis error (cache disabled for this op):', err.message));
} else {
  console.log('ℹ️  REDIS_URL not set — running without a cache layer (DB-only, still fully functional)');
}

const isReady = () => !!client && client.status === 'ready';

const cacheGet = async (key) => {
  if (!isReady()) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn(`⚠️ Redis GET failed for "${key}":`, err.message);
    return null;
  }
};

const cacheSet = async (key, value, ttlSeconds) => {
  if (!isReady()) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.warn(`⚠️ Redis SET failed for "${key}":`, err.message);
  }
};

const cacheDel = async (key) => {
  if (!isReady()) return;
  try {
    await client.del(key);
  } catch (err) {
    console.warn(`⚠️ Redis DEL failed for "${key}":`, err.message);
  }
};

module.exports = { redisClient: client, cacheGet, cacheSet, cacheDel };
