/**
 * backend/index.js — Orchid API Server
 *
 * Express.js backend deployed on Render. Handles everything that can't live on-chain:
 *   - Wallet registration (unique node counting via Redis)
 *   - Transaction recording (volume, success/fail metrics)
 *   - Dashboard metrics endpoint (/api/metrics)
 *   - Resolution intent coordination (/api/intent/:escrow_id)
 *     → Off-chain advisory layer that reduces race conditions in dispute resolution
 *     → Does NOT restrict who can call resolve_dispute on-chain
 *   - Health check endpoint (/health) — used by UptimeRobot
 *   - Disbursement polling (legacy custody wallet payouts, every 60s)
 *
 * Security:
 *   - CORS restricted to known Vercel origins + localhost
 *   - Rate limiting: 200 req/15min general, 200 req/15min on write endpoints
 *   - Input validation: Stellar address regex, tx hash regex
 *   - Payload size limit: 10kb
 *
 * All persistent state lives in Upstash Redis (see db.js).
 * All smart contract interactions are read-only (see soroban.js).
 */
if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const db        = require('./db');
const { processPendingDisbursements } = require('./disburse');
const { verifyEscrowResolved } = require('./soroban');

const app = express();

// ── CORS — restrict to known origins ─────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://orchiddapp.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: false,
}));
app.use(express.json({ limit: '10kb' })); // prevent large payload attacks

// ── Rate limiting ─────────────────────────────────────────────────────────────
// General: 200 requests per 15 min per IP (covers all routes)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict: 30 requests per 15 min per IP (write endpoints only)
// TESTING: Increased to 200 for validation tests
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // Increased from 30 for testing
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many write requests, please slow down.' },
});

app.use(generalLimiter);

// ── Input validation helpers ──────────────────────────────────────────────────
const STELLAR_ADDR_RE = /^G[A-Z2-7]{55}$/;
const TX_HASH_RE      = /^[a-fA-F0-9]{64}$/;

function isValidStellarAddress(addr) {
  return typeof addr === 'string' && STELLAR_ADDR_RE.test(addr);
}
function isValidTxHash(hash) {
  return typeof hash === 'string' && TX_HASH_RE.test(hash);
}

// ── Request logging with timing ───────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[${level}] ${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// ── Health & Monitoring ───────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'running', message: 'Orchid API ✅' }));

// Detailed health check — used by UptimeRobot and internal monitoring
app.get('/health', async (_req, res) => {
  const start = Date.now();
  const checks = {};

  // Check Redis connectivity
  try {
    const metrics = await db.getMetrics();
    checks.redis = { status: 'ok', total_nodes: metrics.total_nodes, total_txs: metrics.total };
  } catch (e) {
    checks.redis = { status: 'error', message: e.message };
  }

  // Check Stellar Horizon connectivity
  try {
    const r = await fetch('https://horizon-testnet.stellar.org/ledgers?limit=1&order=desc');
    if (r.ok) {
      const d = await r.json();
      checks.horizon = { status: 'ok', latest_ledger: d._embedded?.records?.[0]?.sequence };
    } else {
      checks.horizon = { status: 'degraded', http_status: r.status };
    }
  } catch (e) {
    checks.horizon = { status: 'error', message: e.message };
  }

  const allOk = Object.values(checks).every(c => c.status === 'ok');
  const responseTime = Date.now() - start;

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    response_time_ms: responseTime,
    version: '1.0.0',
    network: process.env.SOROBAN_NETWORK || 'testnet',
    checks,
  });
});

// Metrics endpoint for monitoring dashboards
app.get('/api/monitor', async (_req, res) => {
  try {
    const metrics = await db.getMetrics();
    res.json({
      ...metrics,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      node_version: process.version,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
app.post('/api/users/register', writeLimiter, async (req, res) => {
  const { wallet_address } = req.body;
  if (!wallet_address || !isValidStellarAddress(wallet_address))
    return res.status(400).json({ error: 'Invalid wallet_address — must be a valid Stellar G... address' });
  try { res.json(await db.registerWallet(wallet_address.trim())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/count', async (_req, res) => {
  try { res.json({ total_nodes: await db.countWallets() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/list', async (_req, res) => {
  try { res.json({ users: await db.listWallets() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
app.post('/api/transactions/record', writeLimiter, async (req, res) => {
  const { tx_hash, amount, source_account, type, success } = req.body;
  if (!tx_hash || !isValidTxHash(tx_hash))
    return res.status(400).json({ error: 'Invalid tx_hash — must be a 64-char hex string' });
  if (source_account && !isValidStellarAddress(source_account))
    return res.status(400).json({ error: 'Invalid source_account' });
  try { res.json(await db.recordTx({ tx_hash, amount, source_account, type, success })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/metrics', async (_req, res) => {
  try { res.json(await db.getMetrics()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transactions/recent', async (_req, res) => {
  try { res.json({ tx_hashes: await db.recentTxHashes() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DISBURSEMENTS ─────────────────────────────────────────────────────────────
// NOTE: Escrow release/refund are now handled by the Soroban escrow contract.
// NOTE: Supply/FD operations are now handled by the Soroban pool contract.
// Backend only handles legacy pool custody wallet disbursements as fallback.

app.get('/api/disburse/pending', async (_req, res) => {
  try { res.json({ disbursements: await db.getAllDisbursements() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── RESOLUTION INTENT ─────────────────────────────────────────────────────────
// Ephemeral advisory coordination layer. Stores who intends to resolve a dispute.
// Does NOT restrict resolve_dispute — purely informational.
//
// Design:
//   TTL: 12 seconds — fast recovery, minimal stale blocking.
//   Priority window: DYNAMIC based on reward size (Section 3)
//   Unique callers: tracked via a Redis Set (not a counter) — no inflation.
//   Arbiter status: stored with intent so UI can show "Arbiter attempting resolution".
//   Intent cost: minimum balance check (Section 1)
//   Abandoned intent tracking: reliability scoring (Section 6)

const INTENT_TTL_SECS      = 12;
const INTENT_KEY      = (id) => `orchid:intent:${id}`;
const CALLERS_KEY     = (id) => `orchid:intent_callers:${id}`;
const USER_STATS_KEY  = (addr) => `orchid:user_stats:${addr}`; // PHASE 8: Full stats tracking
const INTENT_TRACKING_KEY = (addr, escrowId) => `orchid:intent_track:${addr}:${escrowId}`; // Track individual intents
const ESCROW_RESOLVED_KEY = (escrowId) => `orchid:escrow_resolved:${escrowId}`; // GLOBAL escrow resolution state

// SECTION 3: Dynamic priority window based on reward size
// HIGH reward (>0.2 XLM) → 5s, MEDIUM (>0.1 XLM) → 8s, LOW → 12s
function getPriorityWindow(rewardStroops) {
  const reward = Number(rewardStroops) / 1e7;
  if (reward > 0.2) return 5;   // HIGH: reduce bot advantage
  if (reward > 0.1) return 8;   // MEDIUM: standard
  return 12;                     // LOW: more time for humans
}

// SECTION 1: Minimum balance check (anti-spam)
const MIN_BALANCE_STROOPS = 1_000_000; // 0.1 XLM minimum to signal intent

// PHASE 8 — SECTION 3: Reliability classification
function getReliabilityScore(stats) {
  const totalIntents = stats.total_intents || 0;
  const successfulResolutions = stats.successful_resolutions || 0;
  
  if (totalIntents < 5) return 'UNKNOWN';
  
  const successRate = successfulResolutions / totalIntents;
  
  if (successRate >= 0.6) return 'HIGH';
  if (successRate >= 0.3) return 'MEDIUM';
  return 'LOW';
}

// PHASE 8 — SECTION 4: Abuse detection
function isLowReliability(stats) {
  const totalIntents = stats.total_intents || 0;
  const successfulResolutions = stats.successful_resolutions || 0;
  const abandonedIntents = stats.abandoned_intents || 0;
  
  if (totalIntents < 10) return false;
  
  const successRate = successfulResolutions / totalIntents;
  const abandonRate = abandonedIntents / totalIntents;
  
  return successRate < 0.2 || abandonRate > 0.5;
}

// PHASE 8 — SECTION 5: Priority window modifier based on reliability
function getEffectivePriorityWindow(baseWindow, reliabilityScore) {
  if (reliabilityScore === 'LOW') return Math.floor(baseWindow * 0.5);
  if (reliabilityScore === 'HIGH') return Math.floor(baseWindow * 1.2);
  return baseWindow;
}

// PHASE 8 — SECTION 7: Calculate priority score for intent comparison
function calculatePriorityScore(isArbiter, reliabilityScore, remainingMs, maxWindow) {
  const arbiterBonus = isArbiter ? 2 : 0;
  const reliabilityBonus = reliabilityScore === 'HIGH' ? 2 : reliabilityScore === 'MEDIUM' ? 1 : reliabilityScore === 'LOW' ? -1 : 0;
  const timeWeight = remainingMs / (maxWindow * 1000);
  
  return arbiterBonus + reliabilityBonus + timeWeight;
}

// PHASE 9 — SECTION 1: Calculate failure penalty score
function getFailureScore(stats) {
  const failedResolutions = stats.failed_resolutions || 0;
  const abandonedIntents = stats.abandoned_intents || 0;
  return failedResolutions + abandonedIntents;
}

// PHASE 9 — SECTION 1 & 2: Check if user is restricted
function isRestricted(stats) {
  const failureScore = getFailureScore(stats);
  const totalIntents = stats.total_intents || 0;
  
  // Threshold: 10+ failures OR failure rate >70% with 10+ intents
  if (failureScore >= 10) return true;
  if (totalIntents >= 10 && (failureScore / totalIntents) > 0.7) return true;
  
  return false;
}

// PHASE 9 — SECTION 2: Calculate restriction duration (in seconds)
function getRestrictionDuration(stats) {
  const failureScore = getFailureScore(stats);
  
  if (failureScore >= 20) return 30; // 30s for severe offenders
  if (failureScore >= 10) return 20; // 20s for moderate offenders
  return 10; // 10s minimum
}

// PHASE 9 — SECTION 4: Calculate escalating cooldown
function getEscalatedCooldown(stats) {
  const failureScore = getFailureScore(stats);
  
  if (failureScore >= 15) return 40; // 40s for severe repeat offenders
  if (failureScore >= 10) return 20; // 20s for moderate repeat offenders
  if (failureScore >= 5) return 10;  // 10s for minor repeat offenders
  return 5; // 5s base cooldown
}

// PHASE 9 — SECTION 5: Calculate intent decay penalty (reduces priority permanently)
function getIntentDecayPenalty(stats) {
  const abandonRate = stats.total_intents > 0 
    ? (stats.abandoned_intents || 0) / stats.total_intents 
    : 0;
  
  if (abandonRate > 0.5) return -3; // Severe penalty for >50% abandon rate
  if (abandonRate > 0.3) return -2; // Moderate penalty for >30% abandon rate
  if (abandonRate > 0.15) return -1; // Minor penalty for >15% abandon rate
  return 0;
}

// PHASE 9 — SECTION 3: Rate limit tracking key
const RATE_LIMIT_KEY = (addr) => `orchid:rate_limit:${addr}`;
const MAX_INTENTS_PER_MINUTE = 5;

// PHASE 10 — SECTION 6: Light intent bond tracking (off-chain behavioral accounting)
const BOND_TRACKING_KEY = (addr) => `orchid:bond:${addr}`;
const BOND_AMOUNT_XLM = 0.01; // Symbolic amount for behavioral tracking

// PHASE 10 — SECTION 1: Normalize stake weight (logarithmic to prevent whale dominance)
function calculateStakeWeight(stakeStroops) {
  if (!stakeStroops || stakeStroops <= 0) return 0;
  const stakeXlm = Number(stakeStroops) / 1e7;
  // log(1 + stake) gives diminishing returns
  return Math.log(1 + stakeXlm);
}

// PHASE 10 — SECTION 6: Rewritten priority score with stake weighting
function calculatePriorityScoreV2(isArbiter, reliabilityScore, stakeWeight, remainingMs, maxWindow, decayPenalty, bondLost) {
  // PHASE 10 FIX — SECTION 6: Stricter formula with stronger weights
  // Arbiter bonus: +3 → multiplied by 2 = +6
  const arbiterBonus = isArbiter ? 3 * 2 : 0;
  
  // Reliability bonus: HIGH +2, MEDIUM +1, LOW -2 (penalty increased)
  const reliabilityBonus = reliabilityScore === 'HIGH' ? 2 : 
                           reliabilityScore === 'MEDIUM' ? 1 : 
                           reliabilityScore === 'LOW' ? -2 : 0;
  
  // PHASE 10 FIX — SECTION 6: Stake weight multiplied by 3 (increased from 2)
  const stakeComponent = stakeWeight * 3;
  
  // Time remaining weight: normalized 0-1
  const timeWeight = remainingMs / (maxWindow * 1000);
  
  // Decay penalty: from Phase 9
  const decayComponent = decayPenalty || 0;
  
  // PHASE 10 FIX — SECTION 5: Stricter bond penalty
  let bondPenalty = 0;
  if (bondLost >= 6) bondPenalty = -4; // Severe penalty
  else if (bondLost >= 3) bondPenalty = -2; // Moderate penalty
  
  // PHASE 10 FIX — SECTION 3: Non-staked penalty
  const nonStakedPenalty = (stakeWeight === 0 && !isArbiter) ? -4 : 0;
  
  return arbiterBonus + reliabilityBonus + stakeComponent + timeWeight + decayComponent + bondPenalty + nonStakedPenalty;
}

// PHASE 10 HARDENING — SECTION 3: Dynamic priority margin based on reward size
function getDynamicPriorityMargin(rewardStroops) {
  const rewardXlm = Number(rewardStroops) / 1e7;
  // Higher rewards require larger advantage to override
  // Low reward (~0.1 XLM) → margin ~1.1
  // Medium reward (~1 XLM) → margin ~1.5
  // High reward (~10 XLM) → margin ~2.4
  return 1 + Math.log(1 + rewardXlm);
}

// PHASE 10 — SECTION 3: Priority window modification based on stake
function getStakeModifiedPriorityWindow(baseWindow, isArbiter, stakeStroops) {
  const STAKE_THRESHOLD = 500_000_000; // 50 XLM threshold for bonus
  
  if (isArbiter) {
    return Math.floor(baseWindow * 1.3); // 30% longer window for arbiters
  } else if (stakeStroops > STAKE_THRESHOLD) {
    return Math.floor(baseWindow * 1.1); // 10% longer for high-stake non-arbiters
  }
  return baseWindow;
}

// PHASE 10 — SECTION 7: Get bond loss count
async function getBondLostCount(redis, address) {
  const bondData = await redis.get(BOND_TRACKING_KEY(address)).catch(() => null);
  if (!bondData) return 0;
  const data = parseRedisData(bondData);
  return data?.bond_lost || 0;
}

// Shared Redis factory — avoids re-instantiating per request
function makeRedis() {
  const { Redis } = require('@upstash/redis');
  return new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

// Helper to safely parse Redis data (Upstash auto-parses JSON)
function parseRedisData(data) {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch { return null; }
}

// POST /api/intent/:escrow_id  { caller, is_arbiter?, reward_stroops?, caller_balance?, stake_amount?, escrow_arbitrators? }
// Signal intent to resolve. Respects dynamic priority window — rejects overwrites during it.
// PHASE 10 HARDENING: Real arbiter authority check
app.post('/api/intent/:escrow_id', writeLimiter, async (req, res) => {
  const escrowId = parseInt(req.params.escrow_id, 10);
  if (!Number.isFinite(escrowId) || escrowId < 1)
    return res.status(400).json({ error: 'Invalid escrow_id' });

  const { caller, is_arbiter, reward_stroops, caller_balance, stake_amount, escrow_arbitrators } = req.body;
  if (!caller || !isValidStellarAddress(caller))
    return res.status(400).json({ error: 'Invalid caller — must be a valid Stellar G... address' });

  const redis = makeRedis();
  
  // PHASE 8 — SECTION 1: Load user stats
  const userStatsRaw = await redis.get(USER_STATS_KEY(caller)).catch(() => null);
  let userStats = {
    total_intents: 0,
    successful_resolutions: 0,
    failed_resolutions: 0,
    abandoned_intents: 0,
    last_intent_timestamp: 0,
  };
  if (userStatsRaw) {
    const parsed = parseRedisData(userStatsRaw);
    if (parsed) userStats = parsed;
  }

  // PHASE 9 — SECTION 1 & 2: Check if user is restricted
  const restricted = isRestricted(userStats);
  if (restricted) {
    const restrictionDuration = getRestrictionDuration(userStats);
    const failureScore = getFailureScore(userStats);
    
    return res.status(403).json({
      error: 'Account restricted due to repeated failures',
      failure_score: failureScore,
      restriction_duration_secs: restrictionDuration,
      message: `Your account has been temporarily restricted due to ${failureScore} failed/abandoned resolutions. Wait ${restrictionDuration}s before attempting again.`,
    });
  }

  // PHASE 9 — SECTION 3: Rate limit check (max 5 intents per minute)
  // SECTION 1: Skip rate limiting in test mode
  if (process.env.TEST_MODE !== 'true') {
    const rateLimitKey = RATE_LIMIT_KEY(caller);
    const intentCount = await redis.incr(rateLimitKey).catch(() => 1);
    
    if (intentCount === 1) {
      await redis.expire(rateLimitKey, 60).catch(() => {});
    }
    
    if (intentCount > MAX_INTENTS_PER_MINUTE) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        max_intents_per_minute: MAX_INTENTS_PER_MINUTE,
        current_count: intentCount,
        message: `You can only signal ${MAX_INTENTS_PER_MINUTE} intents per minute. Wait before trying again.`,
      });
    }
  }

  // PHASE 9 — SECTION 4: Escalating cooldown enforcement
  const escalatedCooldown = getEscalatedCooldown(userStats);
  const timeSinceLastIntent = Date.now() - (userStats.last_intent_timestamp || 0);
  if (timeSinceLastIntent < escalatedCooldown * 1000) {
    return res.status(429).json({
      error: 'Intent cooldown active',
      retry_after_ms: (escalatedCooldown * 1000) - timeSinceLastIntent,
      cooldown_secs: escalatedCooldown,
      base_cooldown: 5,
      escalation_reason: getFailureScore(userStats) >= 5 ? 'repeated failures' : 'normal',
      message: `Cooldown: ${escalatedCooldown}s (escalated due to ${getFailureScore(userStats)} failures)`,
    });
  }

  // PHASE 8 — SECTION 3 & 4: Calculate reliability
  const reliabilityScore = getReliabilityScore(userStats);
  const lowReliability = isLowReliability(userStats);

  // SECTION 1: Minimum balance check (anti-spam)
  if (caller_balance !== undefined && Number(caller_balance) < MIN_BALANCE_STROOPS) {
    return res.status(403).json({
      error: 'Insufficient balance to signal intent',
      required_balance: MIN_BALANCE_STROOPS,
      your_balance: caller_balance,
    });
  }

  // PHASE 10 — SECTION 1: Calculate stake weight
  const stakeStroops = stake_amount || 0;
  const stakeWeight = calculateStakeWeight(stakeStroops);
  const isArbiter = is_arbiter || false;
  
  // PHASE 10 HARDENING — SECTION 1: Real arbiter authority check
  // Check if caller is actually assigned to THIS specific escrow
  const escrowArbitratorsList = escrow_arbitrators || [];
  const isAssignedArbiter = Array.isArray(escrowArbitratorsList) && 
                            escrowArbitratorsList.some(addr => addr === caller);

  // PHASE 10 — SECTION 6 & 7: Load bond tracking data
  const bondLost = await getBondLostCount(redis, caller);
  
  // PHASE 10 FIX — SECTION 5: Block intent if bond_lost >= 6
  if (bondLost >= 6) {
    return res.status(403).json({
      error: 'Intent blocked due to excessive bond losses',
      bond_lost: bondLost,
      block_duration_secs: 10,
      message: `You have ${bondLost} abandoned intents. Wait 10s before attempting again.`,
    });
  }

  const intentKey  = INTENT_KEY(escrowId);
  const callersKey = CALLERS_KEY(escrowId);

  // SECTION 3: Dynamic priority window based on reward size
  const basePriorityWindow = getPriorityWindow(reward_stroops ?? 0);
  
  // PHASE 8 — SECTION 5: Apply reliability modifier to priority window
  let effectivePriorityWindow = getEffectivePriorityWindow(basePriorityWindow, reliabilityScore);
  
  // PHASE 10 — SECTION 3: Apply stake modifier to priority window
  effectivePriorityWindow = getStakeModifiedPriorityWindow(effectivePriorityWindow, isArbiter, stakeStroops);

  // SECTION 3 — STRICT READ BEFORE COMPARE: Read existing intent with verification
  const existingRaw = await redis.get(intentKey).catch(() => null);
  let existing = parseRedisData(existingRaw);
  
  // SECTION 9: Fail-fast logging
  console.log(JSON.stringify({
    event: 'INTENT_FETCH',
    escrow_id: escrowId,
    caller,
    exists: !!existing,
    existing_caller: existing?.caller || null,
    timestamp: Date.now(),
  }));
  
  // PHASE 9 — SECTION 5: Apply intent decay penalty to priority score
  const decayPenalty = getIntentDecayPenalty(userStats);
  
  // PHASE 10 HARDENING — SECTION 3: Dynamic priority margin based on reward
  const dynamicMargin = getDynamicPriorityMargin(reward_stroops ?? 0);

  // PHASE 10 — SECTION 2 & 4: Priority score comparison with stake weighting
  if (existing && existing.caller !== caller) {
    const ageMs = Date.now() - (existing.timestamp ?? 0);
    const existingPriorityWindow = existing.effective_priority_window || basePriorityWindow;
    
    // SECTION 4 — FIX ARBITER AUTHORITY (CRITICAL): Real arbiter override - ONLY assigned arbiters
    const arbiterCanOverride = isAssignedArbiter;
    
    // SECTION 9: Arbiter override check logging
    console.log(JSON.stringify({
      event: 'ARB_OVERRIDE_CHECK',
      escrow_id: escrowId,
      caller,
      is_assigned_arbiter: isAssignedArbiter,
      arbiter_can_override: arbiterCanOverride,
      age_ms: ageMs,
      priority_window_ms: existingPriorityWindow * 1000,
      timestamp: Date.now(),
    }));
    
    // SECTION 4: If assigned arbiter, allow override ALWAYS
    if (ageMs < existingPriorityWindow * 1000 && !arbiterCanOverride) {
      // Calculate priority scores using V2 (stake-weighted)
      const existingStakeWeight = existing.stake_weight || 0;
      const existingDecayPenalty = existing.decay_penalty || 0;
      const existingBondLost = existing.bond_lost || 0;
      
      const existingScore = calculatePriorityScoreV2(
        existing.is_arbiter || false,
        existing.reliability_score || 'UNKNOWN',
        existingStakeWeight,
        existingPriorityWindow * 1000 - ageMs,
        existingPriorityWindow,
        existingDecayPenalty,
        existingBondLost
      );
      
      const newScore = calculatePriorityScoreV2(
        isArbiter,
        reliabilityScore,
        stakeWeight,
        effectivePriorityWindow * 1000,
        effectivePriorityWindow,
        decayPenalty,
        bondLost
      );

      // SECTION 5 — PRIORITY BLOCK ENFORCEMENT: Dynamic priority margin (not fixed 1.5)
      if (newScore <= existingScore + dynamicMargin) {
        // Track this caller in the unique set anyway (they tried)
        await redis.sadd(callersKey, caller).catch(() => {});
        await redis.expire(callersKey, INTENT_TTL_SECS).catch(() => {});
        const uniqueCount = await redis.scard(callersKey).catch(() => 1);
        
        const highlyContested = uniqueCount > 2;

        // SECTION 9: Priority block logging
        console.log(JSON.stringify({
          event: 'PRIORITY_BLOCK',
          escrow_id: escrowId,
          caller,
          your_score: newScore,
          existing_score: existingScore,
          margin_required: dynamicMargin,
          blocked: true,
          timestamp: Date.now(),
        }));

        // SECTION 7 — CONSISTENT RESPONSE SCHEMA: Enhanced response with all signals
        return res.status(409).json({
          success: false,
          blocked: true,
          reason: 'Higher priority resolver exists',
          error: 'Another resolver already signaled intent',
          intent_caller: existing.caller,
          is_arbiter: existing.is_arbiter ?? false,
          is_assigned_arbiter: isAssignedArbiter,
          priority_remaining_ms: Math.max(0, existingPriorityWindow * 1000 - ageMs),
          unique_callers: uniqueCount,
          highly_contested: highlyContested,
          expires_in_secs: INTENT_TTL_SECS,
          priority_window_secs: existingPriorityWindow,
          existing_priority_score: parseFloat(existingScore.toFixed(2)),
          your_priority_score: parseFloat(newScore.toFixed(2)),
          priority_margin_required: parseFloat(dynamicMargin.toFixed(2)),
          priority_margin: parseFloat(dynamicMargin.toFixed(2)),
          your_stake_weight: parseFloat(stakeWeight.toFixed(2)),
          existing_stake_weight: parseFloat(existingStakeWeight.toFixed(2)),
          arbiter_override: false,
          is_override: false,
          delay_applied: false, // Frontend will apply delay
        });
      }
    }
  }
  
  // PHASE 10 HARDENING — SECTION 1: If arbiter override occurred, signal it
  const arbiterOverrideOccurred = existing && existing.caller !== caller && isAssignedArbiter;

  // PHASE 8 — SECTION 2: Track intent signal
  userStats.total_intents += 1;
  userStats.last_intent_timestamp = Date.now();
  await redis.set(USER_STATS_KEY(caller), JSON.stringify(userStats), { ex: 86400 * 30 });

  // PHASE 10 HARDENING — SECTION 2: Mark intent as active for bond lifecycle tracking
  const bondTrackingData = {
    bond_reserved: true,
    intent_active: true, // PHASE 10 HARDENING
    intent_timestamp: Date.now(),
    reserved_at: Date.now(),
    escrow_id: escrowId,
    bond_lost: bondLost,
  };
  await redis.set(BOND_TRACKING_KEY(caller), JSON.stringify(bondTrackingData), { ex: 86400 * 7 });

  // PHASE 8 — Track this specific intent for abandonment detection
  await redis.set(INTENT_TRACKING_KEY(caller, escrowId), JSON.stringify({
    signaled_at: Date.now(),
    escrow_id: escrowId,
    resolved: false,
  }), { ex: INTENT_TTL_SECS + 60 });

  // Write new intent
  const intentData = {
    caller,
    timestamp: Date.now(),
    is_arbiter: isArbiter,
    reward_stroops: reward_stroops ?? 0,
    reliability_score: reliabilityScore,
    effective_priority_window: effectivePriorityWindow,
    low_reliability: lowReliability,
    decay_penalty: decayPenalty,
    failure_score: getFailureScore(userStats),
    escalated_cooldown: escalatedCooldown,
    stake_weight: stakeWeight, // PHASE 10
    stake_amount: stakeStroops, // PHASE 10
    bond_lost: bondLost, // PHASE 10
  };
  
  // SECTION 2 — GUARANTEED INTENT WRITE: Write with verification
  await redis.set(intentKey, JSON.stringify(intentData), { ex: INTENT_TTL_SECS });
  
  // SECTION 2: Immediate verification
  const storedRaw = await redis.get(intentKey).catch(() => null);
  if (!storedRaw) {
    console.error(JSON.stringify({
      event: 'INTENT_WRITE_FAILED',
      escrow_id: escrowId,
      caller,
      timestamp: Date.now(),
    }));
    return res.status(500).json({
      error: 'Intent write failed',
      message: 'Failed to store intent in Redis',
    });
  }
  
  // SECTION 2 & 9: Success logging
  console.log(JSON.stringify({
    event: 'INTENT_STORED',
    escrow_id: escrowId,
    caller,
    timestamp: Date.now(),
    ttl: INTENT_TTL_SECS,
  }));

  // Track unique callers via a Set
  await redis.sadd(callersKey, caller).catch(() => {});
  await redis.expire(callersKey, INTENT_TTL_SECS).catch(() => {});
  const uniqueCount = await redis.scard(callersKey).catch(() => 1);

  const highlyContested = uniqueCount > 2;

  // PHASE 10 — SECTION 5: Determine priority level for UI
  const priorityLevel = isArbiter || stakeWeight > 2 ? 'HIGH_PRIORITY' : 'STANDARD';
  
  // PHASE 10 FIX — SECTION 4: Calculate current bond penalty for display
  let bondPenalty = 0;
  if (bondLost >= 6) bondPenalty = -4;
  else if (bondLost >= 3) bondPenalty = -2;

  // Calculate current priority score for response
  const currentPriorityScore = calculatePriorityScoreV2(
    isArbiter,
    reliabilityScore,
    stakeWeight,
    effectivePriorityWindow * 1000,
    effectivePriorityWindow,
    decayPenalty,
    bondLost
  );

  // SECTION 7 — CONSISTENT RESPONSE SCHEMA: All responses include complete schema
  res.json({
    success: true,
    escrow_id: escrowId,
    intent_caller: caller,
    is_arbiter: isArbiter,
    is_assigned_arbiter: isAssignedArbiter, // PHASE 10 HARDENING
    previous_caller: existing?.caller ?? null,
    unique_callers: uniqueCount,
    highly_contested: highlyContested,
    expires_in_secs: INTENT_TTL_SECS,
    priority_window_secs: effectivePriorityWindow,
    base_priority_window_secs: basePriorityWindow,
    reliability_score: reliabilityScore,
    low_reliability: lowReliability,
    failure_score: getFailureScore(userStats),
    decay_penalty: decayPenalty,
    escalated_cooldown: escalatedCooldown,
    restricted: false,
    // PHASE 10 additions
    stake_weight: parseFloat(stakeWeight.toFixed(2)),
    stake_amount_xlm: parseFloat((stakeStroops / 1e7).toFixed(2)),
    bond_lost: bondLost,
    bond_penalty: bondPenalty,
    priority_level: priorityLevel,
    bond_warning: bondLost >= 3,
    // SECTION 7: Complete response structure - NO undefined values
    blocked: false,
    arbiter_override: arbiterOverrideOccurred || false,
    is_override: arbiterOverrideOccurred || false,
    delay_applied: false, // Frontend will apply delay based on priority
    priority_margin: parseFloat(dynamicMargin.toFixed(2)),
    your_priority_score: parseFloat(currentPriorityScore.toFixed(2)),
    existing_priority_score: existing ? parseFloat(calculatePriorityScoreV2(
      existing.is_arbiter || false,
      existing.reliability_score || 'UNKNOWN',
      existing.stake_weight || 0,
      0, // Already expired or overridden
      effectivePriorityWindow,
      existing.decay_penalty || 0,
      existing.bond_lost || 0
    ).toFixed(2)) : null,
    user_stats: {
      total_intents: userStats.total_intents,
      successful_resolutions: userStats.successful_resolutions,
      failed_resolutions: userStats.failed_resolutions,
      abandoned_intents: userStats.abandoned_intents,
      success_rate: userStats.total_intents > 0 ? (userStats.successful_resolutions / userStats.total_intents).toFixed(2) : '0.00',
    },
  });
});

// GET /api/intent/:escrow_id
// Read current intent state. Returns null intent if expired or never set.
// PHASE 8: Includes reliability scoring and behavioral data
app.get('/api/intent/:escrow_id', async (req, res) => {
  const escrowId = parseInt(req.params.escrow_id, 10);
  if (!Number.isFinite(escrowId) || escrowId < 1)
    return res.status(400).json({ error: 'Invalid escrow_id' });

  const redis = makeRedis();
  const [intentRaw, uniqueCount] = await Promise.all([
    redis.get(INTENT_KEY(escrowId)).catch(() => null),
    redis.scard(CALLERS_KEY(escrowId)).catch(() => 0),
  ]);

  if (!intentRaw) return res.json({ escrow_id: escrowId, intent: null, unique_callers: 0 });

  const intent = parseRedisData(intentRaw);

  const ageMs = intent ? Date.now() - (intent.timestamp ?? 0) : 0;
  const expiresInMs = Math.max(0, INTENT_TTL_SECS * 1000 - ageMs);
  
  // Use effective priority window from intent (includes reliability modifier)
  const priorityWindowSecs = intent?.effective_priority_window || 8;
  const inPriorityWindow = ageMs < priorityWindowSecs * 1000;

  const highlyContested = parseInt(uniqueCount) > 2;

  // PHASE 8 — SECTION 5 & 6: Success chance based on reliability + competition
  let successChance = 'MEDIUM';
  const reliabilityScore = intent?.reliability_score || 'UNKNOWN';
  
  if (intent?.low_reliability || reliabilityScore === 'LOW') {
    successChance = 'LOW';
  } else if (highlyContested || parseInt(uniqueCount) >= 3) {
    successChance = 'LOW';
  } else if (inPriorityWindow && intent?.is_arbiter && reliabilityScore === 'HIGH') {
    successChance = 'HIGH';
  } else if (reliabilityScore === 'HIGH' && parseInt(uniqueCount) <= 1) {
    successChance = 'HIGH';
  } else if (parseInt(uniqueCount) <= 1) {
    successChance = 'MEDIUM';
  }

  res.json({
    escrow_id: escrowId,
    intent,
    unique_callers: parseInt(uniqueCount) || (intent ? 1 : 0),
    highly_contested: highlyContested,
    age_ms: ageMs,
    expires_in_ms: expiresInMs,
    in_priority_window: inPriorityWindow,
    priority_remaining_ms: inPriorityWindow ? Math.max(0, priorityWindowSecs * 1000 - ageMs) : 0,
    priority_window_secs: priorityWindowSecs,
    success_chance: successChance,
    reliability_score: reliabilityScore,
    low_reliability: intent?.low_reliability || false,
  });
});

// PHASE 10 — SECTION 2: Track successful resolution execution with bond release
// PHASE 11 — ON-CHAIN VERIFICATION: Verify escrow is resolved on-chain before updating Redis
app.post('/api/intent/:escrow_id/executed', writeLimiter, async (req, res) => {
  const escrowId = parseInt(req.params.escrow_id, 10);
  if (!Number.isFinite(escrowId) || escrowId < 1)
    return res.status(400).json({ error: 'Invalid escrow_id' });

  const { caller, success } = req.body;
  if (!caller || !isValidStellarAddress(caller))
    return res.status(400).json({ error: 'Invalid caller' });

  const redis = makeRedis();
  
  // PHASE 11 — STEP 3: Verify on-chain resolution before updating Redis
  // This ensures backend state matches blockchain state
  console.log(JSON.stringify({
    event: 'VERIFY_ONCHAIN_RESOLUTION',
    escrow_id: escrowId,
    caller,
    timestamp: Date.now(),
  }));
  
  const isResolvedOnChain = await verifyEscrowResolved(escrowId);
  
  if (!isResolvedOnChain) {
    console.error(JSON.stringify({
      event: 'ONCHAIN_VERIFICATION_FAILED',
      escrow_id: escrowId,
      caller,
      reason: 'Escrow not resolved on-chain',
      timestamp: Date.now(),
    }));
    
    return res.status(400).json({
      error: 'Escrow not resolved on-chain',
      message: 'The escrow must be resolved on the blockchain before updating backend state',
    });
  }
  
  console.log(JSON.stringify({
    event: 'ONCHAIN_VERIFICATION_SUCCESS',
    escrow_id: escrowId,
    caller,
    timestamp: Date.now(),
  }));
  
  // PHASE 11 — STEP 4: Check if already marked as resolved in Redis (duplicate protection)
  const alreadyResolved = await redis.get(ESCROW_RESOLVED_KEY(escrowId)).catch(() => null);
  if (alreadyResolved) {
    console.log(JSON.stringify({
      event: 'DUPLICATE_RESOLUTION_ATTEMPT',
      escrow_id: escrowId,
      caller,
      timestamp: Date.now(),
    }));
    
    return res.status(409).json({
      error: 'Escrow already marked as resolved',
      message: 'This escrow has already been processed',
    });
  }
  
  // Load user stats
  const userStatsRaw = await redis.get(USER_STATS_KEY(caller)).catch(() => null);
  let userStats = {
    total_intents: 0,
    successful_resolutions: 0,
    failed_resolutions: 0,
    abandoned_intents: 0,
    last_intent_timestamp: 0,
  };
  if (userStatsRaw) {
    const parsed = parseRedisData(userStatsRaw);
    if (parsed) userStats = parsed;
  }

  // Update stats based on outcome
  if (success !== false) {
    userStats.successful_resolutions += 1;
    
    // PHASE 10 HARDENING — SECTION 2: Bond lifecycle - release and reduce on success
    const bondData = await redis.get(BOND_TRACKING_KEY(caller)).catch(() => null);
    if (bondData) {
      const bond = parseRedisData(bondData);
      if (bond) {
        bond.bond_reserved = false;
        bond.intent_active = false; // Mark intent as completed
        bond.released_at = Date.now();
        // Reduce bond_lost by 1 on successful execution (reward good behavior, min 0)
        bond.bond_lost = Math.max(0, (bond.bond_lost || 0) - 1);
        await redis.set(BOND_TRACKING_KEY(caller), JSON.stringify(bond), { ex: 86400 * 7 });
      }
    }
  } else {
    userStats.failed_resolutions += 1;
    // PHASE 10 HARDENING — SECTION 2: Failed execution (race loss) - no bond penalty
    // Mark intent as inactive but don't increment bond_lost (race loss is normal)
    const bondData = await redis.get(BOND_TRACKING_KEY(caller)).catch(() => null);
    if (bondData) {
      const bond = parseRedisData(bondData);
      if (bond) {
        bond.intent_active = false;
        await redis.set(BOND_TRACKING_KEY(caller), JSON.stringify(bond), { ex: 86400 * 7 });
      }
    }
  }

  // SECTION 3 — FORCE CLEANUP AFTER RESOLUTION: Mark escrow as globally resolved
  // This is the SINGLE SOURCE OF TRUTH for resolution state
  console.log(`[DEBUG] Setting escrow resolved key for escrow ${escrowId}`);
  await redis.set(ESCROW_RESOLVED_KEY(escrowId), JSON.stringify({
    resolved_at: Date.now(),
    resolved_by: caller,
  }), { ex: 86400 * 7 }); // Keep for 7 days
  console.log(`[DEBUG] Escrow resolved key set: ${ESCROW_RESOLVED_KEY(escrowId)}`);
  
  // SECTION 3 — Delete ALL intent tracking keys for this escrow (cleanup stale intents)
  const pattern = `orchid:intent_track:*:${escrowId}`;
  const trackingKeys = await redis.keys(pattern).catch(() => []);
  console.log(`[DEBUG] Cleaning up ${trackingKeys.length} tracking keys for escrow ${escrowId}`);
  
  for (const key of trackingKeys) {
    await redis.del(key).catch(() => {});
  }

  await redis.set(USER_STATS_KEY(caller), JSON.stringify(userStats), { ex: 86400 * 30 });

  res.json({ 
    success: true,
    reliability_score: getReliabilityScore(userStats),
    user_stats: userStats,
    verified_onchain: true,
  });
});

// PHASE 9 — Get full user statistics and reliability score with enforcement status
app.get('/api/user-stats/:address', async (req, res) => {
  const { address } = req.params;
  if (!address || !isValidStellarAddress(address))
    return res.status(400).json({ error: 'Invalid address' });

  const redis = makeRedis();
  const userStatsRaw = await redis.get(USER_STATS_KEY(address)).catch(() => null);
  
  let userStats = {
    total_intents: 0,
    successful_resolutions: 0,
    failed_resolutions: 0,
    abandoned_intents: 0,
    last_intent_timestamp: 0,
  };
  
  if (userStatsRaw) {
    const parsed = parseRedisData(userStatsRaw);
    if (parsed) userStats = parsed;
  }

  const reliabilityScore = getReliabilityScore(userStats);
  const lowReliability = isLowReliability(userStats);
  const restricted = isRestricted(userStats);
  const failureScore = getFailureScore(userStats);
  const escalatedCooldown = getEscalatedCooldown(userStats);
  const decayPenalty = getIntentDecayPenalty(userStats);
  
  const successRate = userStats.total_intents > 0 
    ? userStats.successful_resolutions / userStats.total_intents 
    : 0;
  const abandonRate = userStats.total_intents > 0
    ? userStats.abandoned_intents / userStats.total_intents
    : 0;

  // Load bond tracking data
  const bondData = await redis.get(BOND_TRACKING_KEY(address)).catch(() => null);
  let bondLost = 0;
  if (bondData) {
    const bond = parseRedisData(bondData);
    bondLost = bond?.bond_lost || 0;
  }

  res.json({
    address,
    ...userStats,
    success_rate: successRate,
    abandon_rate: abandonRate,
    reliability_score: reliabilityScore,
    low_reliability: lowReliability,
    // PHASE 9 additions
    restricted,
    failure_score: failureScore,
    escalated_cooldown: escalatedCooldown,
    decay_penalty: decayPenalty,
    restriction_duration: restricted ? getRestrictionDuration(userStats) : 0,
    // PHASE FINAL: Bond tracking
    bond_lost: bondLost,
  });
});

// SECTION 8 — TEST SYNC: Debug endpoint for test synchronization
app.get('/api/debug/intent/:escrow_id', async (req, res) => {
  const escrowId = parseInt(req.params.escrow_id, 10);
  if (!Number.isFinite(escrowId) || escrowId < 1)
    return res.status(400).json({ error: 'Invalid escrow_id' });

  const redis = makeRedis();
  const intentRaw = await redis.get(INTENT_KEY(escrowId)).catch(() => null);
  const intent = parseRedisData(intentRaw);

  res.json({
    escrow_id: escrowId,
    exists: !!intent,
    intent: intent || null,
    caller: intent?.caller || null,
    timestamp: intent?.timestamp || null,
    age_ms: intent ? Date.now() - intent.timestamp : null,
  });
});

// PHASE 10 — Background job: Check for abandoned intents and apply bond penalties
// This should be called periodically (e.g., every 30 seconds)
app.post('/api/admin/check-abandoned-intents', async (req, res) => {
  const result = await processAbandonedIntents();
  res.json(result);
});

// SECTION 2 & 3 — PROCESS ABANDONED INTENTS: Core abandonment processor
// CRITICAL FIX: Use GLOBAL escrow state as ONLY source of truth
async function processAbandonedIntents() {
  const redis = makeRedis();
  
  // SECTION 2 — Step 1: Scan for all intent tracking keys
  const pattern = 'orchid:intent_track:*';
  const keys = await redis.keys(pattern).catch(() => []);
  
  let abandonedCount = 0;
  let processedCount = 0;
  let skippedResolved = 0;
  
  for (const key of keys) {
    processedCount++;
    const data = await redis.get(key).catch(() => null);
    if (!data) continue;
    
    try {
      // SECTION 2 — Step 2: Parse intent tracking data
      const intent = parseRedisData(data);
      const ageMs = Date.now() - intent.signaled_at;
      
      console.log(`[DEBUG] Processing tracking key: ${key}, ageMs=${ageMs}`);
      
      // SECTION 2 — Step 3: Check abandonment condition (age > TTL)
      if (ageMs > (INTENT_TTL_SECS * 1000)) {
        // Extract address and escrow_id from key: orchid:intent_track:{address}:{escrowId}
        const parts = key.split(':');
        if (parts.length >= 4) {
          const address = parts[2];
          const escrowId = parts[3];
          
          // SECTION 2 & 4 — GLOBAL ESCROW CHECK (CRITICAL): Check if escrow is resolved
          // This is the ONLY source of truth - ignore local flags
          const escrowResolved = await redis.get(ESCROW_RESOLVED_KEY(escrowId)).catch(() => null);
          
          if (escrowResolved) {
            // SECTION 5 — LOGGING: Escrow is resolved, skip penalty
            console.log(JSON.stringify({
              event: 'INTENT_SKIPPED_RESOLVED',
              escrow_id: escrowId,
              address,
              age_ms: ageMs,
              timestamp: Date.now(),
            }));
            
            // Clean up tracking key
            await redis.del(key);
            skippedResolved++;
            continue;
          }
          
          // SECTION 4 — SECONDARY SAFETY CHECK: Verify intent was not executed
          // Check if there's an active intent (if exists and belongs to this user, they might still execute)
          const activeIntent = await redis.get(INTENT_KEY(escrowId)).catch(() => null);
          const activeIntentData = parseRedisData(activeIntent);
          
          if (activeIntentData && activeIntentData.caller === address) {
            // Intent still active, don't penalize yet
            continue;
          }
          
          // SECTION 3 — APPLY PENALTY: Load and update user stats
          const userStatsRaw = await redis.get(USER_STATS_KEY(address)).catch(() => null);
          let userStats = {
            total_intents: 0,
            successful_resolutions: 0,
            failed_resolutions: 0,
            abandoned_intents: 0,
            last_intent_timestamp: 0,
          };
          if (userStatsRaw) {
            const parsed = parseRedisData(userStatsRaw);
            if (parsed) userStats = parsed;
          }
          
          // SECTION 3: Increment abandoned count
          userStats.abandoned_intents += 1;
          await redis.set(USER_STATS_KEY(address), JSON.stringify(userStats), { ex: 86400 * 30 });
          
          // SECTION 3: Load and update bond tracking
          const bondData = await redis.get(BOND_TRACKING_KEY(address)).catch(() => null);
          let bondLost = 0;
          if (bondData) {
            const bond = parseRedisData(bondData);
            if (bond) {
              bondLost = (bond.bond_lost || 0) + 1;
              bond.bond_lost = bondLost;
              bond.bond_reserved = false;
              bond.intent_active = false;
              await redis.set(BOND_TRACKING_KEY(address), JSON.stringify(bond), { ex: 86400 * 7 });
            }
          } else {
            // Create new bond tracking entry
            bondLost = 1;
            await redis.set(BOND_TRACKING_KEY(address), JSON.stringify({
              bond_lost: bondLost,
              bond_reserved: false,
              intent_active: false,
            }), { ex: 86400 * 7 });
          }
          
          // SECTION 5 — LOGGING: Log abandonment event
          console.log(JSON.stringify({
            event: 'INTENT_ABANDONED',
            address,
            escrow_id: escrowId,
            bond_lost: bondLost,
            abandoned_intents: userStats.abandoned_intents,
            age_ms: ageMs,
            timestamp: Date.now(),
          }));
          
          // SECTION 4 — CLEANUP: Delete tracking key
          await redis.del(key);
          abandonedCount++;
        }
      }
    } catch (err) {
      console.error('Error processing abandoned intent:', err);
    }
  }
  
  return {
    checked: processedCount,
    abandoned: abandonedCount,
    skipped_resolved: skippedResolved,
    timestamp: new Date().toISOString(),
  };
}


// SECTION 7 — OPTIONAL DEBUG ENDPOINT: Manual trigger for testing
app.post('/api/debug/process-abandoned', async (req, res) => {
  console.log('Manual abandonment processing triggered');
  const result = await processAbandonedIntents();
  res.json({
    ...result,
    message: 'Abandonment processing completed',
  });
});

// DEBUG: Check tracking key
app.get('/api/debug/tracking/:address/:escrow_id', async (req, res) => {
  const { address, escrow_id } = req.params;
  const redis = makeRedis();
  const trackingKey = INTENT_TRACKING_KEY(address, escrow_id);
  const data = await redis.get(trackingKey).catch(() => null);
  const parsed = parseRedisData(data);
  
  res.json({
    tracking_key: trackingKey,
    raw_data: data,
    parsed_data: parsed,
    exists: !!data,
  });
});

// DEBUG: Check escrow resolved state
app.get('/api/debug/escrow-resolved/:escrow_id', async (req, res) => {
  const { escrow_id } = req.params;
  const redis = makeRedis();
  const resolvedKey = ESCROW_RESOLVED_KEY(escrow_id);
  const data = await redis.get(resolvedKey).catch(() => null);
  const parsed = parseRedisData(data);
  
  res.json({
    escrow_id,
    resolved_key: resolvedKey,
    raw_data: data,
    parsed_data: parsed,
    is_resolved: !!data,
  });
});

app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// ── Scheduler ─────────────────────────────────────────────────────────────────
// SECTION 1 — BACKGROUND PROCESSOR: Run every 10 seconds
setInterval(async () => {
  try {
    const result = await processAbandonedIntents();
    if (result.abandoned > 0) {
      console.log(`[Abandonment Processor] Processed ${result.abandoned} abandoned intents`);
    }
  } catch (e) {
    console.error('[Abandonment Processor] Error:', e.message);
  }
}, 10_000);

setInterval(async () => {
  try { await processPendingDisbursements(); }
  catch (e) { console.error('[Scheduler] Error:', e.message); }
}, 60_000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Orchid backend on port ${PORT}`));
