import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Horizon,
  TransactionBuilder,
  Networks as StellarNetworks,
  Asset,
  Operation,
  Memo,
} from '@stellar/stellar-sdk';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { Networks } from '@creit.tech/stellar-wallets-kit/types';
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils';
import { WalletConnectModule, WalletConnectTargetChain } from '@creit.tech/stellar-wallets-kit/modules/wallet-connect';

const HORIZON_URL =
  import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  import.meta.env.VITE_STELLAR_NETWORK === 'PUBLIC'
    ? StellarNetworks.PUBLIC
    : StellarNetworks.TESTNET;

const server = new Horizon.Server(HORIZON_URL);

// ── Custody addresses — set in .env ──────────────────────────────────────────
// VITE_ESCROW_ADDRESS  = your "escrow" Stellar account public key
// VITE_POOL_ADDRESS    = your "liquidity" Stellar account public key
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS;
const POOL_ADDRESS   = import.meta.env.VITE_POOL_ADDRESS;

const isPublic = import.meta.env.VITE_STELLAR_NETWORK === 'PUBLIC';
const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

const wcModules = WC_PROJECT_ID
  ? [new WalletConnectModule({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: 'Orchid',
        description: 'Optimized Real-time Cross-border Hub for Intelligent Disbursements',
        url: 'https://orchid-dapp.vercel.app',
        icons: ['https://orchid-dapp.vercel.app/favicon.ico'],
      },
      allowedChains: [
        isPublic ? WalletConnectTargetChain.PUBLIC : WalletConnectTargetChain.TESTNET,
      ],
    })]
  : [];

// Guard against double-init (React StrictMode renders twice in dev)
if (!StellarWalletsKit.isInitialized?.()) {
  StellarWalletsKit.init({
    network: isPublic ? Networks.PUBLIC : Networks.TESTNET,
    modules: [...defaultModules(), ...wcModules],
  });
}

// ─── Helper: extract a human-readable message from a Horizon error ───────────
function horizonError(err) {
  // Horizon 400 errors carry the real reason in extras.result_codes
  const codes = err?.response?.data?.extras?.result_codes;
  if (codes) {
    const ops = codes.operations?.join(', ');
    const tx = codes.transaction;
    if (ops && ops !== 'op_success') return `Transaction failed: ${ops}`;
    if (tx) return `Transaction failed: ${tx}`;
  }
  // Freighter / wallet rejection
  if (err?.message?.toLowerCase().includes('user declined') ||
      err?.message?.toLowerCase().includes('rejected') ||
      err?.message?.toLowerCase().includes('cancelled')) {
    return 'Transaction cancelled by user.';
  }
  return err?.message || 'Unknown error';
}

// ─── Helper: sign + submit a built transaction ───────────────────────────────
async function signAndSubmit(tx, signerAddress) {
  const xdr = tx.toXDR();

  // Pass address so WalletConnect matches the right session
  const result = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: signerAddress,
  });

  const signedXdr =
    typeof result === 'string' ? result : result?.signedTxXdr ?? result?.xdr;

  if (!signedXdr) throw new Error('Signing failed or was cancelled');

  // Rebuild Transaction object from signed XDR and submit
  try {
    const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    return await server.submitTransaction(signedTx);
  } catch (err) {
    throw new Error(horizonError(err));
  }
}

// ─── Helper: sign + submit + record in analytics ─────────────────────────────
async function signSubmitRecord(tx, { amount, sourceAccount, type }) {
  const { useAnalytics } = await import('./analytics.js');
  const analytics = useAnalytics.getState();

  let res;
  try {
    res = await signAndSubmit(tx, sourceAccount);
    if (!res || !res.hash) throw new Error('No response from Horizon');
    analytics.recordLocalTx({ txHash: res.hash, amount, sourceAccount, type });
    analytics.confirmTx(res.hash, true);
    try {
      const { api } = await import('./api.js');
      await api.recordTx({ tx_hash: res.hash, amount, source_account: sourceAccount, type, success: true });
    } catch (e) { console.warn('[Orchid] Backend recordTx failed:', e.message); }
    return res;
  } catch (err) {
    if (res?.hash) {
      analytics.confirmTx(res.hash, false);
      try {
        const { api } = await import('./api.js');
        await api.recordTx({ tx_hash: res.hash, amount: 0, source_account: sourceAccount, type, success: false });
      } catch (_) {}
    }
    throw err;
  }
}

// ─── Helper: generate a short display ID ─────────────────────────────────────
function shortId() {
  return `TX-${Date.now().toString(36).toUpperCase()}`;
}

// ─── Helper: format amount safely for Stellar (max 7 decimal places) ─────────
function stellarAmount(value) {
  const n = parseFloat(value);
  if (isNaN(n) || n <= 0) throw new Error('Invalid amount');
  return n.toFixed(7);
}

// ─── Helper: build tx with auto-retry on tx_bad_seq ──────────────────────────
async function buildAndSign(address, buildFn, meta = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const account = await server.loadAccount(address);
    const fee = await server.fetchBaseFee();
    const tx = buildFn(account, fee);
    try {
      const res = await signSubmitRecord(tx, { sourceAccount: address, ...meta });
      if (!res) throw new Error('Transaction submission returned no response');
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt === 0 && err.message?.includes('tx_bad_seq')) continue;
      throw err;
    }
  }
  throw lastErr || new Error('Transaction failed after retries');
}

export const useWalletStore = create(
  persist(
    (set, get) => ({
      // ── State ──────────────────────────────────────────────────────────────
      address: null,
      balance: '0',
      balances: [],
      isConnecting: false,
      error: null,
      transactions: [],
      escrowHoldings: [],
      poolLiquidity: '0',
      poolUtilization: 0,
      creditScore: 800,
      savedRouteTemplates: [],

      // ── Wallet ─────────────────────────────────────────────────────────────
      connect: async () => {
        set({ isConnecting: true, error: null });
        try {
          const result = await StellarWalletsKit.authModal();
          if (!result?.address) throw new Error('Wallet connection cancelled');
          set({ address: result.address, isConnecting: false });
          await get().fetchBalance();
          get().sanitizeTransactions(); // clean any malformed persisted data
          // Register wallet in analytics + network stats
          const [{ useAnalytics }, { useNetworkStats }] = await Promise.all([
            import('./analytics.js'),
            import('./networkStats.js'),
          ]);
          useAnalytics.getState().registerWallet(result.address);
          useNetworkStats.getState().registerNode(result.address);
          // Index this wallet's tx history immediately so volume is up to date
          useAnalytics.getState().indexFromHorizon();
          // Register in backend DB (persistent unique user tracking)
          try {
            const { api } = await import('./api.js');
            await api.registerWallet(result.address);
          } catch (e) { console.warn('[Orchid] Backend register failed:', e.message); }
        } catch (err) {
          set({ isConnecting: false, error: err.message });
        }
      },

      resetConnection: () => {
        set({ isConnecting: false, error: null });
      },

      disconnect: async () => {
        try {
          if (StellarWalletsKit.disconnect) await StellarWalletsKit.disconnect();
        } catch (e) {
          console.error('Disconnect error:', e);
        }
        set({ address: null, balance: '0', balances: [], isConnecting: false, error: null, transactions: [] });
        localStorage.removeItem('wallet-store-v3');
      },

      // ── Balance ────────────────────────────────────────────────────────────
      fetchBalance: async () => {
        const { address } = get();
        if (!address) return;
        try {
          const account = await server.loadAccount(address);
          const native = account.balances.find((b) => b.asset_type === 'native');
          set({ balance: native?.balance || '0', balances: account.balances });
        } catch (err) {
          set({ error: 'Account not funded. Use Friendbot.' });
        }
      },

      clearTransactions: () => set({ transactions: [] }),

      // ── Sanitize persisted transactions (removes malformed entries from old versions) ──
      sanitizeTransactions: () => {
        set((s) => ({
          transactions: (s.transactions || []).filter(
            t => t !== null && t !== undefined && typeof t === 'object'
          ).map(t => ({
            ...t,
            type: t.type || 'Transfer',   // ensure type always exists
            status: t.status || 'Completed',
            time: t.time || new Date().toISOString(),
          })),
        }));
      },

      // ── Send (Dashboard quick transfer) ────────────────────────────────────
      sendTransaction: async (destination, amount) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');

        // Validate destination exists on-chain before building tx
        try {
          await server.loadAccount(destination);
        } catch {
          throw new Error(`Destination account does not exist on testnet. Ask them to fund it at friendbot.stellar.org`);
        }

        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: stellarAmount(amount) }))
            .setTimeout(60)
            .build(),
          { amount: parseFloat(amount), type: 'Transfer' }
        );

        const record = {
          id: shortId(),
          hash: res.hash,
          type: 'Transfer',
          amount: `${amount} XLM`,
          status: 'Completed',
          time: new Date().toISOString(),
        };

        set((s) => ({ transactions: [record, ...s.transactions] }));
        await get().fetchBalance();
        return res;
      },

      // ── Payment Router (split payment) ─────────────────────────────────────
      routePayment: async (totalAmount, splits, asset = 'XLM') => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');

        const res = await buildAndSign(address, (account, fee) => {
          const builder = new TransactionBuilder(account, {
            fee: (parseInt(fee) * splits.length).toString(),
            networkPassphrase: NETWORK_PASSPHRASE,
          });
          for (const split of splits) {
            const splitAmount = stellarAmount((parseFloat(totalAmount) * parseFloat(split.percentage)) / 100);
            builder.addOperation(Operation.payment({ destination: split.address, asset: Asset.native(), amount: splitAmount }));
          }
          return builder.setTimeout(60).build();
        }, { amount: parseFloat(totalAmount), type: 'Routed Payment' });

        const record = {
          id: shortId(),
          hash: res.hash,
          type: 'Routed Payment',
          amount: `${totalAmount} XLM`,
          recipients: splits.length,
          status: 'Completed',
          time: new Date().toISOString(),
        };

        set((s) => ({ transactions: [record, ...s.transactions] }));
        await get().fetchBalance();
        return res.hash;
      },

      // ── Bulk Payout ────────────────────────────────────────────────────────
      batchPayment: async (recipients, asset = 'XLM') => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');

        // Compute total BEFORE buildAndSign so meta gets the correct amount
        const total = recipients.reduce((acc, r) => acc + parseFloat(stellarAmount(r.amount)), 0);

        const res = await buildAndSign(address, (account, fee) => {
          const builder = new TransactionBuilder(account, {
            fee: (parseInt(fee) * recipients.length).toString(),
            networkPassphrase: NETWORK_PASSPHRASE,
          });
          for (const r of recipients) {
            builder.addOperation(Operation.payment({ destination: r.address, asset: Asset.native(), amount: stellarAmount(r.amount) }));
          }
          return builder.setTimeout(60).build();
        }, { amount: total, type: 'Bulk Payout' });

        const record = {
          id: shortId(),
          hash: res.hash,
          type: 'Bulk Payout',
          amount: `${total.toFixed(2)} XLM`,
          recipients: `${recipients.length} recipients`,
          status: 'Completed',
          time: new Date().toISOString(),
        };

        set((s) => ({ transactions: [record, ...s.transactions] }));
        await get().fetchBalance();
        return res.hash;
      },

      // ── Route Template helpers ─────────────────────────────────────────────
      saveRouteTemplate: (name, splits) => {
        set((s) => ({
          savedRouteTemplates: [
            ...s.savedRouteTemplates.filter((t) => t.name !== name),
            { name, splits },
          ],
        }));
      },

      deleteRouteTemplate: (name) => {
        set((s) => ({ savedRouteTemplates: s.savedRouteTemplates.filter((t) => t.name !== name) }));
      },

      // ── Escrow ─────────────────────────────────────────────────────────────
      // Funds are sent to the ESCROW custody account and held there.
      // Release = buyer sends from escrow to seller (tracked locally).
      // Refund  = escrow sends back to buyer (tracked locally).
      createEscrow: async (seller, amount, asset, description, expiryDays) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!ESCROW_ADDRESS) throw new Error('Escrow custody address not configured (VITE_ESCROW_ADDRESS)');

        const memo = description ? description.slice(0, 28) : 'Orchid Escrow';
        // Validate seller account exists before locking funds
        try { await server.loadAccount(seller); } catch {
          throw new Error(`Seller account does not exist on testnet. They need to fund it at friendbot.stellar.org`);
        }
        // Funds go to the ESCROW custody account, NOT directly to seller yet
        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination: ESCROW_ADDRESS, asset: Asset.native(), amount: stellarAmount(amount) }))
            .addMemo(Memo.text(memo))
            .setTimeout(60)
            .build(),
          { amount: parseFloat(amount), type: 'Create Escrow' }
        );

        const expiresAt = new Date(Date.now() + parseInt(expiryDays) * 86400000).toISOString();
        const record = {
          id: shortId(), hash: res.hash, type: 'Create Escrow',
          amount: `${amount} ${asset}`, merchant: seller, description,
          buyer: address, // store buyer address for refunds
          status: 'Funded', expiresAt, time: new Date().toISOString(),
        };

        set((s) => ({ transactions: [record, ...s.transactions] }));
        await get().fetchBalance();
        return res.hash;
      },

      releaseEscrow: async (id) => {
        const { transactions } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) throw new Error('Escrow not found');

        // Backend signs and sends from escrow account → seller
        const { api } = await import('./api.js');
        const amountNum = parseFloat(escrow.amount.split(' ')[0]);
        await api.disburseEscrowRelease(escrow.merchant, amountNum, id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Released' } : t
          ),
        }));
        await get().fetchBalance();
        return 'released';
      },

      refundEscrow: async (id) => {
        const { transactions, address } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) throw new Error('Escrow not found');

        // Refund goes to the original buyer who locked the funds
        const refundTo = escrow.buyer || address;
        const { api } = await import('./api.js');
        const amountNum = parseFloat(escrow.amount.split(' ')[0]);
        await api.disburseEscrowRefund(refundTo, amountNum, id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Refunded' } : t
          ),
        }));
        await get().fetchBalance();
        return 'refunded';
      },

      markDelivered: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Delivered' } : t
          ),
        }));
      },

      disputeEscrow: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Disputed' } : t
          ),
        }));
      },

      checkEscrowExpiry: () => {
        const now = new Date().toISOString();
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t && t.type === 'Create Escrow' && t.status === 'Funded' && t.expiresAt && t.expiresAt < now
              ? { ...t, status: 'Expired' }
              : t
          ),
        }));
      },

      // ── Lending ────────────────────────────────────────────────────────────
      // All lending logic lives in useLendingStore (src/store/lending.js).
      // These wallet store functions handle the on-chain tx, then delegate
      // record-keeping to the lending store.

      supplyLendingPool: async (amount, asset) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!POOL_ADDRESS) throw new Error('Pool address not configured (VITE_POOL_ADDRESS)');
        if (parseFloat(amount) <= 0) throw new Error('Invalid amount');

        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination: POOL_ADDRESS, asset: Asset.native(), amount: stellarAmount(amount) }))
            .addMemo(Memo.text('Orchid Supply'))
            .setTimeout(60)
            .build(),
          { amount: parseFloat(amount), type: 'Supply' }
        );

        const { useLendingStore } = await import('./lending.js');
        useLendingStore.getState().recordSupply(res.hash, amount, asset);
        useLendingStore.getState().fetchPoolBalance();

        await get().fetchBalance();
        return res.hash;
      },

      borrowFunds: async (amount, asset, termDays, paymentMethod) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!POOL_ADDRESS) throw new Error('Pool address not configured (VITE_POOL_ADDRESS)');

        const { useLendingStore } = await import('./lending.js');
        const lending = useLendingStore.getState();

        // Validate before any tx
        lending.validateBorrow(amount);

        // Pool disburses to borrower — user signs a tx FROM pool TO themselves
        // Since we don't hold pool secret key on client, we record the intent
        // and the actual disbursement is tracked. The on-chain tx here is the
        // repayment authorization memo so the loan is anchored on-chain.
        // For testnet demo: we send a 0.0000001 XLM "loan marker" tx to pool
        // with memo, and record the full loan amount locally.
        const markerTx = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({
              destination: POOL_ADDRESS,
              asset: Asset.native(),
              amount: '0.0000001',
            }))
            .addMemo(Memo.text(`Orchid Loan ${parseFloat(amount).toFixed(2)}`))
            .setTimeout(60)
            .build(),
          { amount: 0.0000001, type: 'Borrow' }
        );

        const loan = lending.recordBorrow(markerTx.hash, amount, asset, parseInt(termDays), paymentMethod);
        lending.fetchPoolBalance();

        // Backend disburses actual XLM from pool → borrower's wallet
        try {
          const { api } = await import('./api.js');
          await api.disburseBorrow(address, parseFloat(amount), loan.id);
        } catch (e) {
          console.warn('[Orchid] Borrow disbursement failed:', e.message);
          throw new Error(`Loan recorded but disbursement failed: ${e.message}`);
        }

        await get().fetchBalance();
        return loan.id;
      },

      repayLoan: async (loanId, partialAmount) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!POOL_ADDRESS) throw new Error('Pool address not configured (VITE_POOL_ADDRESS)');

        const { useLendingStore } = await import('./lending.js');
        const lending = useLendingStore.getState();
        const loan = lending.loans.find((l) => l.id === loanId);
        if (!loan) throw new Error('Loan not found');
        if (loan.status === 'Completed') throw new Error('Loan already fully repaid');

        // Calculate current repay amount with any penalties
        const { calcRepayAmount } = await import('./lending.js');
        const now = new Date();
        const daysLate = Math.max(0, Math.ceil((now - new Date(loan.dueDate)) / 86400000));
        const fullRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate);
        const remaining = fullRepay - loan.amountRepaid;

        // Use partial amount if provided, otherwise pay full remaining
        const payAmt = partialAmount
          ? Math.min(parseFloat(partialAmount), remaining)
          : remaining;

        if (payAmt <= 0) throw new Error('Nothing to repay');

        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination: POOL_ADDRESS, asset: Asset.native(), amount: stellarAmount(payAmt) }))
            .addMemo(Memo.text('Orchid Repay'))
            .setTimeout(60)
            .build(),
          { amount: payAmt, type: 'Repay' }
        );

        const result = lending.recordRepayment(loanId, payAmt, res.hash);
        lending.fetchPoolBalance();

        await get().fetchBalance();
        return { hash: res.hash, ...result };
      },

      createFixedDeposit: async (amount, asset, termDays, apyPct) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!POOL_ADDRESS) throw new Error('Pool address not configured (VITE_POOL_ADDRESS)');
        if (parseFloat(amount) <= 0) throw new Error('Invalid amount');

        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination: POOL_ADDRESS, asset: Asset.native(), amount: stellarAmount(amount) }))
            .addMemo(Memo.text('Orchid FD'))
            .setTimeout(60)
            .build(),
          { amount: parseFloat(amount), type: 'Fixed Deposit' }
        );

        const { useLendingStore } = await import('./lending.js');
        useLendingStore.getState().recordFixedDeposit(res.hash, amount, asset, parseInt(termDays), parseFloat(apyPct));
        useLendingStore.getState().fetchPoolBalance();

        await get().fetchBalance();
        return res.hash;
      },

      // ── Subscriptions ──────────────────────────────────────────────────────
      createSubscription: async (merchant, amount, asset, intervalSeconds) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');

        // Validate merchant account exists
        try { await server.loadAccount(merchant); } catch {
          throw new Error(`Merchant account does not exist on testnet. They need to fund it at friendbot.stellar.org`);
        }

        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination: merchant, asset: Asset.native(), amount: stellarAmount(amount) }))
            .addMemo(Memo.text('Orchid Subscribe'))
            .setTimeout(60)
            .build(),
          { amount: parseFloat(amount), type: 'Subscribe' }
        );

        const nextDueDate = new Date(Date.now() + parseInt(intervalSeconds) * 1000).toISOString();
        const record = {
          id: shortId(), hash: res.hash, type: 'Subscribe',
          amount: `${amount} ${asset}`, merchant,
          intervalSeconds: parseInt(intervalSeconds),
          nextDueDate, billingCount: 1, status: 'Active',
          time: new Date().toISOString(),
        };

        set((s) => ({ transactions: [record, ...s.transactions] }));
        await get().fetchBalance();
        return res.hash;
      },

      processPayment: async (txId) => {
        const { address, transactions } = get();
        if (!address) throw new Error('Wallet not connected');

        const sub = transactions.find((t) => t.id === txId);
        if (!sub) throw new Error('Subscription not found');

        const amount = stellarAmount(sub.amount.split(' ')[0]);
        const res = await buildAndSign(address, (account, fee) =>
          new TransactionBuilder(account, { fee: fee.toString(), networkPassphrase: NETWORK_PASSPHRASE })
            .addOperation(Operation.payment({ destination: sub.merchant, asset: Asset.native(), amount }))
            .addMemo(Memo.text('Orchid Payment'))
            .setTimeout(60)
            .build(),
          { amount: parseFloat(sub.amount.split(' ')[0]), type: 'Subscription Payment' }
        );

        const nextDueDate = new Date(Date.now() + sub.intervalSeconds * 1000).toISOString();
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === txId ? { ...t, hash: res.hash, nextDueDate, billingCount: (t.billingCount || 1) + 1 } : t
          ),
        }));

        await get().fetchBalance();
        return res.hash;
      },

      pauseSubscription: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Paused' } : t
          ),
        }));
      },

      resumeSubscription: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Active' } : t
          ),
        }));
      },

      cancelSubscription: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Cancelled' } : t
          ),
        }));
      },
    }),
    {
      name: 'wallet-store-v3',
    }
  )
);
