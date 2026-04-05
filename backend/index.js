if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const db       = require('./db');
const { processPendingDisbursements } = require('./disburse');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: false }));
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
