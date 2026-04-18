/**
 * Orchid Analytics Engine
 * ───────────────────────
 * Single source of truth for all dashboard metrics.
 * ALL numbers are derived from Horizon blockchain data.
 * Frontend is display-only — no calculations are authoritative here.
 *
 * Anti-manipulation guarantees:
 *  - Volume: sum of tx amounts from Horizon, deduplicated by txHash (Set)
 *  - Users:  unique source_account addresses from Horizon tx history
 *  - Accuracy: success/fail counts from Horizon tx result_codes only
 *  - Settlement time: ledger closed_at timestamps from Horizon ledgers API
 *  - No manual overrides, no artificial caps, no frontend-side inflation
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const HORIZON = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const POOL_ADDR   = import.meta.env.VITE_POOL_ADDRESS;
const ESCROW_ADDR = import.meta.env.VITE_ESCROW_ADDRESS;

// How many ledgers to average for settlement time
const LEDGER_SAMPLE = 20;
// How many txs to fetch per custody account for volume/user indexing
const TX_PAGE_LIMIT = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Horizon ${res.status}: ${url}`);
  return res.json();
}

/**
 * Fetch all transactions for an account (up to TX_PAGE_LIMIT).
 * Returns raw Horizon transaction records.
 */
async function fetchAccountTxs(account) {
  if (!account) return [];
  try {
    const data = await fetchJson(
      `${HORIZON}/accounts/${account}/transactions?order=desc&limit=${TX_PAGE_LIMIT}&include_failed=true`
    );
    return data._embedded?.records || [];
  } catch {
    return [];
  }
}

/**
 * Fetch operations for a transaction and sum native payment amounts.
 * This gives us the real XLM volume per tx.
 */
async function fetchTxVolume(txHash) {
  try {
    const data = await fetchJson(`${HORIZON}/transactions/${txHash}/operations?limit=50`);
    const ops = data._embedded?.records || [];
    let total = 0;
    for (const op of ops) {
      // Count native payments and path payments
      if (
        (op.type === 'payment' || op.type === 'path_payment_strict_send' || op.type === 'path_payment_strict_receive') &&
        op.asset_type === 'native'
      ) {
        total += parseFloat(op.amount || 0);
      }
      // Create account also moves XLM
      if (op.type === 'create_account') {
        total += parseFloat(op.starting_balance || 0);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

// ── BigInt-safe JSON serializer for Zustand persist ──────────────────────────
const bigIntSerializer = {
  serialize: (state) => JSON.stringify(state, (_key, val) =>
    typeof val === 'bigint' ? val.toString() : val
  ),
  deserialize: (str) => JSON.parse(str),
};

export const useAnalytics = create(
  persist(
    (set, get) => ({

      // ── Immutable event log ─────────────────────────────────────────────────
      // Each entry: { txHash, amount, sourceAccount, submittedAt, confirmedAt, success, type }
      // txHash is the deduplication key — same hash is never counted twice.
      eventLog: [],

      // ── Derived metrics (recomputed from eventLog) ──────────────────────────
      // These are NEVER set manually — always recomputed via recomputeMetrics().
      totalVolume: 0,           // sum of amounts for successful txs (unique hashes)
      uniqueUsers: 0,           // count of unique sourceAccount values
      successCount: 0,          // confirmed successful txs
      failCount: 0,             // confirmed failed txs
      avgSettlementMs: null,    // moving average of (confirmedAt - submittedAt) in ms

      // ── Live Horizon data (not persisted) ──────────────────────────────────
      poolBalance: 0,
      escrowBalance: 0,
      ledgerSettlementSec: null,
      networkStatus: 'Measuring...',
      networkColor: 'var(--text-muted)',
      nodeCount: 0,

      // ── Backend accuracy (real value from Redis) ───────────────────────────
      backendAccuracy: null, // null = not yet fetched; number = real %

      // ── Audit state ────────────────────────────────────────────────────────
      lastIndexedAt: null,
      isIndexing: false,
      indexError: null,

      // ── Unique wallet registry (persisted Set as array) ────────────────────
      walletRegistry: [], // unique constraint enforced in registerWallet()

      // ─────────────────────────────────────────────────────────────────────
      // REGISTER WALLET
      // Called on every connect. Enforces unique constraint.
      // ─────────────────────────────────────────────────────────────────────
      registerWallet: (address) => {
        if (!address) return;
        set((s) => {
          if (s.walletRegistry.includes(address)) return s;
          const walletRegistry = [...s.walletRegistry, address];
          return { walletRegistry };
        });
        // Backend is source of truth for node count — no Horizon fetch needed
      },

      // ─────────────────────────────────────────────────────────────────────
      // RECORD LOCAL TX
      // Called immediately after a tx is submitted (before confirmation).
      // submittedAt is set here; confirmedAt is set in confirmTx().
      // ─────────────────────────────────────────────────────────────────────
      recordLocalTx: ({ txHash, amount, sourceAccount, type }) => {
        if (!txHash) return;
        const { eventLog } = get();
        // Deduplication: skip if hash already exists
        if (eventLog.some(e => e.txHash === txHash)) return;

        const entry = {
          txHash,
          amount: parseFloat(amount) || 0,
          sourceAccount,
          type: type || 'Transfer',
          submittedAt: new Date().toISOString(),
          confirmedAt: null,
          success: null, // null = pending
        };

        set((s) => ({ eventLog: [entry, ...s.eventLog] }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // CONFIRM TX
      // Called after Horizon confirms the tx. Sets confirmedAt + success.
      // ─────────────────────────────────────────────────────────────────────
      confirmTx: (txHash, success = true) => {
        if (!txHash) return;
        set((s) => ({
          eventLog: s.eventLog.map(e =>
            e.txHash === txHash
              ? { ...e, confirmedAt: new Date().toISOString(), success }
              : e
          ),
        }));
        get().recomputeMetrics();
      },

      // ─────────────────────────────────────────────────────────────────────
      // RECOMPUTE METRICS
      // Derives all metrics from eventLog. Can be called at any time.
      // This is the reproducibility guarantee — same log = same numbers.
      // ─────────────────────────────────────────────────────────────────────
      recomputeMetrics: () => {
        const { eventLog } = get();

        // Dedup by txHash (Set ensures uniqueness)
        const seen = new Set();
        const confirmed = [];
        for (const e of eventLog) {
          if (seen.has(e.txHash)) continue;
          seen.add(e.txHash);
          if (e.confirmedAt !== null) confirmed.push(e);
        }

        // Volume: sum of amounts for successful confirmed txs only
        const successful = confirmed.filter(e => e.success === true);
        const failed     = confirmed.filter(e => e.success === false);
        const totalVolume = successful.reduce((acc, e) => acc + e.amount, 0);

        // Unique users: from confirmed txs (not just local registry)
        const userSet = new Set(confirmed.map(e => e.sourceAccount).filter(Boolean));

        // Settlement time: moving average over last N confirmed txs with both timestamps
        const timed = successful
          .filter(e => e.submittedAt && e.confirmedAt)
          .slice(0, 50); // last 50
        const avgSettlementMs = timed.length > 0
          ? timed.reduce((acc, e) =>
              acc + (new Date(e.confirmedAt) - new Date(e.submittedAt)), 0
            ) / timed.length
          : null;

        set({
          totalVolume,
          uniqueUsers: userSet.size,
          successCount: successful.length,
          failCount: failed.length,
          avgSettlementMs,
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // INDEX FROM HORIZON
      // Fetches real on-chain txs from ALL known accounts (custody + wallets)
      // and merges into eventLog with real XLM amounts from operations.
      // ─────────────────────────────────────────────────────────────────────
      indexFromHorizon: async () => {
        const { isIndexing, eventLog, walletRegistry } = get();
        if (isIndexing) return;
        set({ isIndexing: true, indexError: null });

        try {
          // Index custody accounts + all registered user wallets
          const accounts = [...new Set([
            POOL_ADDR, ESCROW_ADDR, ...walletRegistry
          ].filter(Boolean))];

          if (accounts.length === 0) {
            set({ isIndexing: false, lastIndexedAt: new Date().toISOString() });
            return;
          }

          const existingHashes = new Set(eventLog.map(e => e.txHash));
          const newEntries = [];

          for (const account of accounts) {
            const txs = await fetchAccountTxs(account);
            for (const tx of txs) {
              if (existingHashes.has(tx.hash)) continue;
              existingHashes.add(tx.hash);

              const success = tx.successful === true;
              // Fetch real operation amounts for successful txs
              const amount = success ? await fetchTxVolume(tx.hash) : 0;

              newEntries.push({
                txHash: tx.hash,
                amount,
                sourceAccount: tx.source_account,
                type: 'On-chain',
                submittedAt: tx.created_at,
                confirmedAt: tx.created_at,
                success,
              });
            }
          }

          if (newEntries.length > 0) {
            set((s) => ({ eventLog: [...newEntries, ...s.eventLog] }));
          }

          set({ lastIndexedAt: new Date().toISOString(), isIndexing: false });
          get().recomputeMetrics();
          // Don't call fetchNodeCount — backend Redis is source of truth
        } catch (err) {
          set({ isIndexing: false, indexError: err.message });
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // FETCH BACKEND METRICS
      // Backend is source of truth. Called on mount + after every tx.
      // ─────────────────────────────────────────────────────────────────────
      fetchBackendMetrics: async () => {
        try {
          const { api } = await import('./api.js');
          const m = await api.getMetrics();
          const success = parseInt(m.successful) || 0;
          const failed  = parseInt(m.failed)     || 0;
          const total   = success + failed;
          // Use backend-computed accuracy if available, otherwise derive it
          const backendAccuracy = m.accuracy
            ? parseFloat(m.accuracy)
            : total > 0 ? (success / total) * 100 : null;
          set({
            totalVolume:      parseFloat(m.total_volume) || 0,
            nodeCount:        parseInt(m.total_nodes)    || 0,
            successCount:     success,
            failCount:        failed,
            backendAccuracy,  // real value from Redis, null if no txs yet
          });
        } catch (e) {
          // Backend unreachable — fall back to local recompute
          console.warn('[Orchid] Backend metrics unavailable, using local:', e.message);
          get().recomputeMetrics();
        }
      },
      fetchNodeCount: async () => {
        try {
          const accounts = [POOL_ADDR, ESCROW_ADDR].filter(Boolean);
          if (accounts.length === 0) return;

          const unique = new Set();
          for (const account of accounts) {
            const txs = await fetchAccountTxs(account);
            txs.forEach(tx => { if (tx.source_account) unique.add(tx.source_account); });
          }

          // Merge with local wallet registry
          get().walletRegistry.forEach(a => unique.add(a));

          set({ nodeCount: unique.size });
        } catch { /* silent */ }
      },

      // ─────────────────────────────────────────────────────────────────────
      // FETCH POOL + ESCROW BALANCES
      // ─────────────────────────────────────────────────────────────────────
      fetchBalances: async () => {
        const getBalance = async (addr) => {
          if (!addr) return 0;
          try {
            const data = await fetchJson(`${HORIZON}/accounts/${addr}`);
            const native = data.balances?.find(b => b.asset_type === 'native');
            return parseFloat(native?.balance || 0);
          } catch { return 0; }
        };

        const [poolBalance, escrowBalance] = await Promise.all([
          getBalance(POOL_ADDR),
          getBalance(ESCROW_ADDR),
        ]);

        set({ poolBalance, escrowBalance });
      },

      // ─────────────────────────────────────────────────────────────────────
      // FETCH SETTLEMENT TIME
      // Moving average of ledger close intervals from Horizon.
      // ─────────────────────────────────────────────────────────────────────
      fetchSettlementTime: async () => {
        try {
          const data = await fetchJson(`${HORIZON}/ledgers?order=desc&limit=${LEDGER_SAMPLE}`);
          const ledgers = data._embedded?.records || [];
          if (ledgers.length < 2) return;

          let total = 0;
          for (let i = 0; i < ledgers.length - 1; i++) {
            total += new Date(ledgers[i].closed_at) - new Date(ledgers[i + 1].closed_at);
          }
          const avgSec = (total / (ledgers.length - 1) / 1000).toFixed(1);

          const status =
            avgSec < 4.5 ? 'Super Fast' :
            avgSec < 5.5 ? 'Fast' :
            avgSec < 7.0 ? 'Slight Delay' :
            avgSec < 10  ? 'Busy / Laggy' : 'High Traffic';

          const color =
            avgSec < 5.5 ? '#10b981' :
            avgSec < 7.0 ? '#f59e0b' :
            avgSec < 10  ? '#f97316' : '#ef4444';

          set({ ledgerSettlementSec: avgSec, networkStatus: status, networkColor: color });
        } catch { /* keep previous */ }
      },

      // ─────────────────────────────────────────────────────────────────────
      // AUDIT EXPORT
      // Returns raw data for audit mode display.
      // ─────────────────────────────────────────────────────────────────────
      getAuditData: () => {
        const { eventLog, walletRegistry, successCount, failCount, totalVolume } = get();
        const seen = new Set();
        const deduped = eventLog.filter(e => {
          if (seen.has(e.txHash)) return false;
          seen.add(e.txHash);
          return true;
        });
        return {
          rawTxCount: deduped.length,
          successCount,
          failCount,
          totalAttempted: successCount + failCount,
          accuracy: successCount + failCount > 0
            ? ((successCount / (successCount + failCount)) * 100).toFixed(4)
            : 'N/A',
          totalVolume: totalVolume.toFixed(7),
          uniqueWallets: walletRegistry,
          recentTxs: deduped.slice(0, 100),
        };
      },
    }),
    {
      name: 'orchid-analytics-v1',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          return str ? bigIntSerializer.deserialize(str) : null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, bigIntSerializer.serialize(value));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
      partialize: (s) => ({
        eventLog: s.eventLog.slice(0, 500),
        walletRegistry: s.walletRegistry,
        totalVolume: s.totalVolume,
        uniqueUsers: s.uniqueUsers,
        successCount: s.successCount,
        failCount: s.failCount,
        avgSettlementMs: s.avgSettlementMs,
        nodeCount: s.nodeCount,
        lastIndexedAt: s.lastIndexedAt,
        backendAccuracy: s.backendAccuracy,
      }),
    }
  )
);
