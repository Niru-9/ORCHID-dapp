if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const db       = require('./db');
const { processPendingDisbursements } = require('./disburse');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://orchid-dapp.vercel.app',   // hardcoded production URL
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // Allow exact matches
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Allow any vercel.app preview deployments
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    cb(new Error('CORS not allowed'));
  },
  credentials: true,
}));

app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({ status: 'running', message: 'Orchid API ✅' }));

// ── USERS ─────────────────────────────────────────────────────────────────────
app.post('/api/users/register', async (req, res) => {
  const { wallet_address } = req.body;
  if (!wallet_address || wallet_address.length < 10)
    return res.status(400).json({ error: 'Invalid wallet_address' });
  try {
    res.json(await db.registerWallet(wallet_address.trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
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
app.post('/api/transactions/record', async (req, res) => {
  const { tx_hash, amount, source_account, type, success } = req.body;
  if (!tx_hash) return res.status(400).json({ error: 'tx_hash required' });
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

/**
 * POST /api/disburse/borrow
 * Called by frontend after borrow is approved.
 * Backend signs and sends XLM from pool → borrower immediately.
 */
app.post('/api/disburse/borrow', async (req, res) => {
  const { recipient, amount, loan_id } = req.body;
  if (!recipient || !amount) return res.status(400).json({ error: 'recipient and amount required' });
  try {
    // Queue for immediate release (releaseAt = now)
    await db.queueDisbursement({
      type: 'borrow',
      recipient,
      amount: parseFloat(amount),
      fromAccount: 'pool',
      releaseAt: new Date().toISOString(),
      meta: { loan_id },
    });
    // Process immediately
    await processPendingDisbursements();
    res.json({ success: true, message: `${amount} XLM queued for disbursement to ${recipient}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/disburse/fd-maturity
 * Called by frontend when user clicks "Claim" on a matured FD.
 * Backend sends principal + interest from pool → user.
 */
app.post('/api/disburse/fd-maturity', async (req, res) => {
  const { recipient, amount, fd_id } = req.body;
  if (!recipient || !amount) return res.status(400).json({ error: 'recipient and amount required' });
  try {
    await db.queueDisbursement({
      type: 'fd_maturity',
      recipient,
      amount: parseFloat(amount),
      fromAccount: 'pool',
      releaseAt: new Date().toISOString(),
      meta: { fd_id },
    });
    await processPendingDisbursements();
    res.json({ success: true, message: `FD payout of ${amount} XLM sent to ${recipient}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/disburse/escrow-release
 * Called when buyer confirms delivery — releases escrow funds to seller.
 */
app.post('/api/disburse/escrow-release', async (req, res) => {
  const { seller, amount, escrow_id } = req.body;
  if (!seller || !amount) return res.status(400).json({ error: 'seller and amount required' });
  try {
    await db.queueDisbursement({
      type: 'escrow_release',
      recipient: seller,
      amount: parseFloat(amount),
      fromAccount: 'escrow',
      releaseAt: new Date().toISOString(),
      meta: { escrow_id },
    });
    await processPendingDisbursements();
    res.json({ success: true, message: `Escrow released: ${amount} XLM → ${seller}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/disburse/escrow-refund
 * Called on dispute/expiry — refunds escrow funds back to buyer.
 */
app.post('/api/disburse/escrow-refund', async (req, res) => {
  const { buyer, amount, escrow_id } = req.body;
  if (!buyer || !amount) return res.status(400).json({ error: 'buyer and amount required' });
  try {
    await db.queueDisbursement({
      type: 'escrow_refund',
      recipient: buyer,
      amount: parseFloat(amount),
      fromAccount: 'escrow',
      releaseAt: new Date().toISOString(),
      meta: { escrow_id },
    });
    await processPendingDisbursements();
    res.json({ success: true, message: `Escrow refunded: ${amount} XLM → ${buyer}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /api/disburse/pending  (audit)
 */
app.get('/api/disburse/pending', async (_req, res) => {
  try { res.json({ disbursements: await db.getAllDisbursements() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Error handling ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// ── Scheduler — check pending disbursements every 60s ────────────────────────
setInterval(async () => {
  try { await processPendingDisbursements(); }
  catch (e) { console.error('[Scheduler] Error:', e.message); }
}, 60_000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Orchid backend on port ${PORT}`));
