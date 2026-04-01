/**
 * Orchid DB — Upstash Redis
 */
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const K = {
  users:        'orchid:users',
  txHashes:     'orchid:tx_hashes',
  tx:     (h)  => `orchid:tx:${h}`,
  volume:       'orchid:volume',
  successCount: 'orchid:success_count',
  failCount:    'orchid:fail_count',
  disbursements:'orchid:disbursements',
};

async function registerWallet(address) {
  const added = await redis.sadd(K.users, address);
  const total = await redis.scard(K.users);
  return { is_new: added === 1, total_nodes: total };
}

async function countWallets() { return redis.scard(K.users); }
async function listWallets()  { return redis.smembers(K.users); }

async function recordTx({ tx_hash, amount, source_account, type, success }) {
  const added = await redis.sadd(K.txHashes, tx_hash);
  if (added === 0) return getMetrics();

  await redis.hset(K.tx(tx_hash), {
    amount:  parseFloat(amount) || 0,
    source:  source_account || '',
    type:    type || 'Transfer',
    success: success === false ? 0 : 1,
    ts:      new Date().toISOString(),
  });

  if (success !== false) {
    const stroops = Math.round((parseFloat(amount) || 0) * 1e7);
    if (stroops > 0) await redis.incrby(K.volume, stroops);
    await redis.incr(K.successCount);
  } else {
    await redis.incr(K.failCount);
  }
  return getMetrics();
}

async function getMetrics() {
  const [volumeStroops, successCount, failCount, nodeCount] = await Promise.all([
    redis.get(K.volume),
    redis.get(K.successCount),
    redis.get(K.failCount),
    redis.scard(K.users),
  ]);
  const volume  = (parseInt(volumeStroops) || 0) / 1e7;
  const success = parseInt(successCount) || 0;
  const failed  = parseInt(failCount)    || 0;
  const total   = success + failed;
  return {
    total_volume: volume,
    total_nodes:  nodeCount,
    successful:   success,
    failed,
    total,
    accuracy: total > 0 ? ((success / total) * 100).toFixed(4) : '100.0000',
  };
}

async function recentTxHashes() {
  const hashes = await redis.smembers(K.txHashes);
  return hashes.slice(-100).reverse();
}

// ── Disbursement queue ────────────────────────────────────────────────────────

async function queueDisbursement({ type, recipient, amount, fromAccount, releaseAt, meta = {} }) {
  const entry = JSON.stringify({
    id: `DISB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type, recipient,
    amount: parseFloat(amount),
    fromAccount,
    releaseAt: releaseAt || new Date().toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    meta,
  });
  await redis.lpush(K.disbursements, entry);
}

async function getPendingDisbursements() {
  const all = await redis.lrange(K.disbursements, 0, -1);
  const now = new Date();
  return all
    .map(s => { try { return JSON.parse(s); } catch { return null; } })
    .filter(d => d && d.status === 'pending' && new Date(d.releaseAt) <= now);
}

async function completeDisbursement(id, txHash) {
  const all = await redis.lrange(K.disbursements, 0, -1);
  await redis.del(K.disbursements);
  for (const s of all) {
    try {
      const d = JSON.parse(s);
      const updated = d.id === id
        ? { ...d, status: 'completed', txHash, completedAt: new Date().toISOString() }
        : d;
      await redis.lpush(K.disbursements, JSON.stringify(updated));
    } catch { await redis.lpush(K.disbursements, s); }
  }
}

async function getAllDisbursements() {
  const all = await redis.lrange(K.disbursements, 0, -1);
  return all.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

module.exports = {
  registerWallet, countWallets, listWallets,
  recordTx, getMetrics, recentTxHashes,
  queueDisbursement, getPendingDisbursements, completeDisbursement, getAllDisbursements,
};
