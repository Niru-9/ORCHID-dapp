if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const db        = require('./db');
const { processPendingDisbursements } = require('./disburse');

const app = express();

// ── CORS — restrict to known origins ─────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://orchiddapp.vercel.app',
  'https://orchid-dapp-topaz.vercel.app',
  'https://orchid-dapp.vercel.app',
  'https://orchid-sepia.vercel.app',
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
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
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

// ── Error handling ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// ── Scheduler ─────────────────────────────────────────────────────────────────
setInterval(async () => {
  try { await processPendingDisbursements(); }
  catch (e) { console.error('[Scheduler] Error:', e.message); }
}, 60_000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Orchid backend on port ${PORT}`));
