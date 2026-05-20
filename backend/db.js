/**
 * Orchid Database Layer — Upstash Redis
 * ──────────────────────────────────────
 * All persistent state lives here: wallets, transactions, disbursements, metrics.
 * Upstash is a serverless Redis — no connection pooling or keep-alive needed.
 * All operations are async and use the REST API under the hood.
 *
 * Key design decisions:
 *  - Volume is stored in stroops (1 XLM = 10^7 stroops) to avoid float precision issues
 *  - Transaction hashes are deduplicated via a Redis Set — same hash is never counted twice
 *  - Disbursements are stored as a Redis List of JSON strings
 */
const { Redis } = require('@upstash/redis');

// Connect to Upstash Redis using REST API credentials from env vars
const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ── Redis Key Schema ──────────────────────────────────────────────────────────
// Centralized key names — keeps all Redis key strings consistent and easy to audit
const K = {
  users:        'orchid:users',          // Set — all registered wallet addresses
  txHashes:     'orchid:tx_hashes',      // Set — all recorded tx hashes (deduplication)
  tx:     (h)  => `orchid:tx:${h}`,     // Hash — metadata for a single transaction
  volume:       'orchid:volume',         // Integer — cumulative XLM volume in stroops
  successCount: 'orchid:success_count',  // Integer — total successful transactions
  failCount:    'orchid:fail_count',     // Integer — total failed transactions
  disbursements:'orchid:disbursements',  // List — pending and completed payout jobs
};

/**
 * registerWallet — adds a wallet address to the network.
 * Uses a Redis Set so the same address is never counted twice.
 * Returns { is_new, total_nodes }.
 */
async function registerWallet(address) {
  const added = await redis.sadd(K.users, address); // sadd returns 1 if new, 0 if duplicate
  const total = await redis.scard(K.users);
  return { is_new: added === 1, total_nodes: total };
}

/** Count how many unique wallets have ever connected. */
async function countWallets() { return redis.scard(K.users); }

/** Return the full list of registered wallet addresses (for audit view). */
async function listWallets()  { return redis.smembers(K.users); }

/**
 * recordTx — records a transaction and updates aggregate metrics.
 * Deduplicates by tx_hash — the same hash can never inflate the counts.
 * Volume is stored in stroops to avoid floating-point rounding errors.
 */
async function recordTx({ tx_hash, amount, source_account, type, success }) {
  // Deduplication check — if this hash was already recorded, return current metrics unchanged
  const added = await redis.sadd(K.txHashes, tx_hash);
  if (added === 0) return getMetrics();

  // Store per-transaction metadata for later lookup and audit
  await redis.hset(K.tx(tx_hash), {
    amount:  parseFloat(amount) || 0,
    source:  source_account || '',
    type:    type || 'Transfer',
    success: success === false ? 0 : 1,
    ts:      new Date().toISOString(),
  });

  // Update running totals
  if (success !== false) {
    // Convert XLM to stroops (integer) to avoid float precision issues in Redis
    const stroops = Math.round((parseFloat(amount) || 0) * 1e7);
    if (stroops > 0) await redis.incrby(K.volume, stroops);
    await redis.incr(K.successCount);
  } else {
    await redis.incr(K.failCount);
  }
  return getMetrics();
}

/**
 * getMetrics — fetches all aggregate dashboard stats in one shot.
 * Called by the frontend analytics view and the /api/metrics endpoint.
 * Returns: { total_volume, total_nodes, successful, failed, total, accuracy }
 */
async function getMetrics() {
  const [volumeStroops, successCount, failCount, nodeCount] = await Promise.all([
    redis.get(K.volume),
    redis.get(K.successCount),
    redis.get(K.failCount),
    redis.scard(K.users),
  ]);
  // Convert stroops back to XLM for display
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
    // Accuracy = success rate as a percentage; defaults to 100% if no transactions yet
    accuracy: total > 0 ? ((success / total) * 100).toFixed(4) : '100.0000',
  };
}

/**
 * recentTxHashes — returns the 100 most recent transaction hashes.
 * Used by the activity feed and audit endpoints.
 */
async function recentTxHashes() {
  const hashes = await redis.smembers(K.txHashes);
  return hashes.slice(-100).reverse();
}

// ── Disbursement Queue ────────────────────────────────────────────────────────
// Disbursements are payout jobs — the backend signs and sends XLM to users.
// NOTE: With Soroban contracts, most payouts are handled on-chain.
// This queue is a legacy fallback for custody-wallet disbursements.

/**
 * queueDisbursement — adds a new payout job to the Redis list.
 * The disbursement engine polls this list every 60 seconds.
 *
 * @param type        - 'borrow', 'fd_maturity', 'escrow_release', etc.
 * @param recipient   - destination Stellar address
 * @param amount      - XLM amount to send
 * @param fromAccount - 'pool' or 'escrow' (determines which custody key to use)
 * @param releaseAt   - ISO timestamp — when to actually send the funds
 */
async function queueDisbursement({ type, recipient, amount, fromAccount, releaseAt, meta = {} }) {
  const entry = JSON.stringify({
    id: `DISB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, // Unique job ID
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

/**
 * getPendingDisbursements — returns only jobs that are:
 *  1. Still in 'pending' status
 *  2. Past their releaseAt timestamp (ready to send now)
 */
async function getPendingDisbursements() {
  const all = await redis.lrange(K.disbursements, 0, -1);
  const now = new Date();
  return all
    .map(s => { try { return JSON.parse(s); } catch { return null; } })
    .filter(d => d && d.status === 'pending' && new Date(d.releaseAt) <= now);
}

/**
 * completeDisbursement — marks a job as completed and attaches the on-chain tx hash.
 * Redis Lists don't support in-place updates, so we rewrite the entire list.
 * This is safe because the disbursement queue is small (< 100 items typically).
 */
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

/**
 * getAllDisbursements — returns every job (pending + completed).
 * Used by the admin monitor view to audit payout history.
 */
async function getAllDisbursements() {
  const all = await redis.lrange(K.disbursements, 0, -1);
  return all.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}

module.exports = {
  registerWallet, countWallets, listWallets,
  recordTx, getMetrics, recentTxHashes,
  queueDisbursement, getPendingDisbursements, completeDisbursement, getAllDisbursements,
};
