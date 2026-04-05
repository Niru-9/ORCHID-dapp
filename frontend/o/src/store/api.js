/**
 * Orchid Backend API client
 * Handles: user registration, tx recording, metrics.
 * NOTE: Escrow and lending disbursements are now handled by Soroban contracts.
 */

const BASE = import.meta.env.VITE_API_URL || 'https://orchid-dapp.onrender.com';

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
};
