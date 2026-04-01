import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

// Custody accounts — read from env vars (set in .env / Vercel dashboard)
const LIQUIDITY_POOL_PUB = import.meta.env.VITE_POOL_ADDRESS;
const ESCROW_CUSTODY_PUB  = import.meta.env.VITE_ESCROW_ADDRESS;

export const useNetworkStats = create(
  persist(
    (set, get) => ({
      // --- Node System ---
      // knownAddresses: persisted locally (this user's browser).
      // nodeCount: fetched from Horizon — counts unique accounts that have
      //            ever transacted with the pool or escrow custody accounts.
      //            This is the real cross-user number shown on the landing page.
      knownAddresses: [],
      nodeCount: 0,

      // --- Settlement Tracking ---
      // All-time cumulative XLM settled. Seeds from custodial balances on first load.
      // NEVER resets to zero. Only increases on confirmed transactions.
      cumulativeSettlement: 0,
      liquiditySeeded: false, // Tracks whether we have seeded from on-chain balances

      // --- Live Metrics (NOT persisted — re-fetched on every session) ---
      settlementTime: null,  // null = not yet loaded (no hardcoded fallback)
      networkStatus: 'Measuring...',
      networkColor: 'var(--text-muted)',

      // --- Accuracy Counters (persisted) ---
      txCount: 0,
      globalSuccessTxs: 0,
      globalFailedTxs: 0,

      // --- TVL Mirror (real-time, not persisted) ---
      volume: 0, // Live sum of pool + escrow balances, updated on every fetchBalance

      // -----------------------------------------------------------------------
      // NODES: Register this browser's wallet locally AND fetch the real
      // cross-user count from Horizon transaction history.
      // -----------------------------------------------------------------------
      registerNode: (address) => {
        // 1. Add to local list (deduped)
        set((state) => {
          if (state.knownAddresses.includes(address)) return state;
          return { knownAddresses: [...state.knownAddresses, address] };
        });

        // 2. Fetch real node count from Horizon (unique senders to custody accounts)
        useNetworkStats.getState().fetchNodeCount();
      },

      // Fetch unique accounts that have sent to pool or escrow — real cross-user count
      fetchNodeCount: async () => {
        try {
          const targets = [LIQUIDITY_POOL_PUB, ESCROW_CUSTODY_PUB].filter(Boolean);
          if (targets.length === 0) return;

          const uniqueAccounts = new Set();

          await Promise.allSettled(targets.map(async (target) => {
            let url = `${HORIZON_URL}/accounts/${target}/transactions?order=desc&limit=200`;
            const res = await fetch(url);
            if (!res.ok) return;
            const data = await res.json();
            const records = data._embedded?.records || [];
            records.forEach(tx => {
              if (tx.source_account) uniqueAccounts.add(tx.source_account);
            });
          }));

          // Always at least count the current local wallets too
          const { knownAddresses } = useNetworkStats.getState();
          knownAddresses.forEach(a => uniqueAccounts.add(a));

          if (uniqueAccounts.size > 0) {
            set({ nodeCount: uniqueAccounts.size });
          }
        } catch (err) {
          // Silently fall back to local count
          const { knownAddresses } = useNetworkStats.getState();
          if (knownAddresses.length > 0) {
            set({ nodeCount: knownAddresses.length });
          }
        }
      },

      // -----------------------------------------------------------------------
      // TVL: Live mirror of on-chain custodial balances.
      // Replaced on every fetchBalance call (not cumulative, just latest snapshot).
      // -----------------------------------------------------------------------
      updateTvl: (amount) => set(() => ({
        volume: amount,
      })),

      // -----------------------------------------------------------------------
      // LIQUIDITY SEED: On first session, fetch the real on-chain balances of
      // both custodial accounts and use their sum as the starting cumulative
      // settlement value. This ensures cumulativeSettlement never starts from 0.
      // Skipped if already seeded (liquiditySeeded = true).
      // -----------------------------------------------------------------------
      seedLiquidityFromChain: async () => {
        const { liquiditySeeded } = get();
        if (liquiditySeeded) return;
        if (!LIQUIDITY_POOL_PUB && !ESCROW_CUSTODY_PUB) return; // env not configured yet

        try {
          let totalXlm = 0;

          const fetches = [];
          if (LIQUIDITY_POOL_PUB) fetches.push(fetch(`${HORIZON_URL}/accounts/${LIQUIDITY_POOL_PUB}`).then(r => r.json()));
          if (ESCROW_CUSTODY_PUB)  fetches.push(fetch(`${HORIZON_URL}/accounts/${ESCROW_CUSTODY_PUB}`).then(r => r.json()));

          const results = await Promise.allSettled(fetches);

          for (const res of results) {
            if (res.status === 'fulfilled' && res.value.balances) {
              const native = res.value.balances.find(b => b.asset_type === 'native');
              if (native) totalXlm += parseFloat(native.balance || 0);
            }
          }

          if (totalXlm > 0) {
            set((state) => ({
              // Only seed if current cumulative is still at zero (clean slate)
              // This prevents overwriting real accumulated history on an existing user
              cumulativeSettlement: state.cumulativeSettlement > 0
                ? state.cumulativeSettlement
                : totalXlm,
              liquiditySeeded: true
            }));
          } else {
            // Mark as seeded even if accounts were empty, to avoid refetching on reload
            set({ liquiditySeeded: true });
          }
        } catch (err) {
          console.error('[Orchid] Failed to seed liquidity from chain:', err);
        }
      },

      // -----------------------------------------------------------------------
      // SETTLEMENT: Called after every confirmed on-chain transaction.
      // Adds the transacted amount to the all-time cumulative total.
      // -----------------------------------------------------------------------
      addSettlement: (amountXlm) => set((state) => ({
        cumulativeSettlement: state.cumulativeSettlement + parseFloat(amountXlm || 0)
      })),

      // -----------------------------------------------------------------------
      // ACCURACY: Called ONLY after a confirmed on-chain hash is received.
      // Never called optimistically or on user cancellation.
      // -----------------------------------------------------------------------
      recordConfirmedTx: (isSuccess = true) => set((state) => ({
        txCount: state.txCount + 1,
        globalSuccessTxs: isSuccess ? state.globalSuccessTxs + 1 : state.globalSuccessTxs,
        globalFailedTxs: !isSuccess ? state.globalFailedTxs + 1 : state.globalFailedTxs
      })),

      // Legacy alias — kept for backward compatibility
      addTransactionRecord: (isSuccess = true) => {
        useNetworkStats.getState().recordConfirmedTx(isSuccess);
      },

      // -----------------------------------------------------------------------
      // SETTLEMENT TIME: Purely real-network derived.
      // Calculates avg ledger close interval from the last 10 Horizon ledgers.
      // NO hardcoded fallback values. If fetch fails, leaves existing value.
      // -----------------------------------------------------------------------
      fetchSettlementTime: async () => {
        try {
          const response = await fetch(`${HORIZON_URL}/ledgers?order=desc&limit=10`);
          if (!response.ok) throw new Error(`Horizon returned ${response.status}`);

          const data = await response.json();
          const ledgers = data._embedded?.records;
          if (!ledgers || ledgers.length < 2) return;

          let totalDiff = 0;
          for (let i = 0; i < ledgers.length - 1; i++) {
            const current = new Date(ledgers[i].closed_at).getTime();
            const previous = new Date(ledgers[i + 1].closed_at).getTime();
            totalDiff += (current - previous);
          }

          const avgMs = totalDiff / (ledgers.length - 1);
          const avgSec = (avgMs / 1000).toFixed(1);

          let status, color;
          if (avgSec < 4.5) {
            status = 'Super Fast'; color = '#10b981';
          } else if (avgSec < 5.5) {
            status = 'Fast'; color = '#10b981';
          } else if (avgSec < 7.0) {
            status = 'Slight Delay'; color = '#f59e0b';
          } else if (avgSec < 10.0) {
            status = 'Busy / Laggy'; color = '#f97316';
          } else {
            status = 'High Traffic'; color = '#ef4444';
          }

          set({ settlementTime: avgSec, networkStatus: status, networkColor: color });
        } catch (err) {
          console.warn('[Orchid] Settlement time fetch failed — keeping previous value.', err.message);
          // Do NOT set a hardcoded fallback. Keep whatever the last real value was.
        }
      },
    }),
    {
      name: 'orchid-stats-v4',
      partialize: (state) => ({
        knownAddresses: state.knownAddresses,
        nodeCount: state.nodeCount,
        cumulativeSettlement: state.cumulativeSettlement,
        liquiditySeeded: state.liquiditySeeded,
        txCount: state.txCount,
        globalSuccessTxs: state.globalSuccessTxs,
        globalFailedTxs: state.globalFailedTxs,
      })
    }
  )
);
