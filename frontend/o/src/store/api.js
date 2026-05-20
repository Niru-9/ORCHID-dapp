/**
 * Orchid Backend API Client
 * ─────────────────────────
 * Thin HTTP wrapper around the Orchid backend (hosted on Render).
 * Handles: wallet registration, transaction recording, and dashboard metrics.
 *
 * NOTE: Actual escrow and lending fund movements are handled by Soroban smart
 * contracts on-chain — this backend only tracks analytics and user data.
 */

// Base URL pulled from .env — falls back to the Render deployment
const BASE = import.meta.env.VITE_API_URL || 'https://orchid-dapp.onrender.com';

/**
 * Internal helper — sends a POST request with a JSON body.
 * Throws if the server returns a non-2xx status.
 */
async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/**
 * Internal helper — sends a GET request.
 * Throws if the server returns a non-2xx status.
 */
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  /**
   * registerWallet — called every time a user connects their wallet.
   * Adds the address to the backend DB for unique node counting.
   * Returns { total_nodes } — the current count of unique wallets.
   */
  registerWallet: (wallet_address) =>
    post('/api/users/register', { wallet_address }),

  /**
   * recordTx — called after every confirmed on-chain transaction.
   * Stores the tx hash, amount, type (Transfer / Escrow / Borrow etc.)
   * and whether it succeeded. Used to compute accuracy metrics.
   */
  recordTx: ({ tx_hash, amount, source_account, type, success }) =>
    post('/api/transactions/record', { tx_hash, amount, source_account, type, success }),

  /**
   * getMetrics — fetches aggregated dashboard stats from the backend.
   * Returns: total_volume, total_nodes, successful, failed, accuracy.
   */
  getMetrics: () => get('/api/metrics'),

  /**
   * listWallets — audit endpoint: returns all registered wallet addresses.
   */
  listWallets: () => get('/api/users/list'),

  /**
   * recentTxs — audit endpoint: returns the most recent transaction hashes.
   */
  recentTxs: () => get('/api/transactions/recent'),
};
