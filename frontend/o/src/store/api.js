/**
 * Orchid Backend API client
 * All calls go through here — single source of truth for metrics.
 */

const BASE = import.meta.env.VITE_API_URL || 'https://orchid-4iyo.onrender.com';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  /** Register wallet on connect. Returns { total_nodes } */
  registerWallet: (wallet_address) =>
    post('/api/users/register', { wallet_address }),

  /** Record a confirmed tx. Returns updated metrics. */
  recordTx: ({ tx_hash, amount, source_account, type, success }) =>
    post('/api/transactions/record', { tx_hash, amount, source_account, type, success }),

  /** Fetch all dashboard metrics from backend. */
  getMetrics: () => get('/api/metrics'),

  /** Audit: list all wallets */
  listWallets: () => get('/api/users/list'),

  /** Audit: recent transactions */
  recentTxs: () => get('/api/transactions/recent'),

  // ── Disbursements — backend signs and sends from custody accounts ──────────

  /** Disburse loan amount from pool → borrower */
  disburseBorrow: (recipient, amount, loan_id) =>
    post('/api/disburse/borrow', { recipient, amount, loan_id }),

  /** Pay out matured FD (principal + interest) from pool → user */
  disburseFdMaturity: (recipient, amount, fd_id) =>
    post('/api/disburse/fd-maturity', { recipient, amount, fd_id }),

  /** Release escrow funds from escrow account → seller */
  disburseEscrowRelease: (seller, amount, escrow_id) =>
    post('/api/disburse/escrow-release', { seller, amount, escrow_id }),

  /** Refund escrow funds from escrow account → buyer */
  disburseEscrowRefund: (buyer, amount, escrow_id) =>
    post('/api/disburse/escrow-refund', { buyer, amount, escrow_id }),
};
