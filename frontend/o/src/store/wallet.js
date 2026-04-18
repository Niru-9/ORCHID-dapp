import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  Horizon,
  TransactionBuilder,
  Networks as StellarNetworks,
  Asset,
  Operation,
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

// ── BigInt-safe JSON serializer for Zustand persist ──────────────────────────
const bigIntSerializer = {
  serialize: (state) => JSON.stringify(state, (_key, val) =>
    typeof val === 'bigint' ? val.toString() : val
  ),
  deserialize: (str) => JSON.parse(str),
};
  persist(
    (set, get) => ({
      // ── State ──────────────────────────────────────────────────────────────
      address: null,
      balance: '0',
      balances: [],
      isConnecting: false,
      error: null,
      transactions: [],
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
          // Store only plain serializable balance data — no SDK objects
          const safeBalances = account.balances.map(b => ({
            asset_type: b.asset_type,
            asset_code: b.asset_code,
            asset_issuer: b.asset_issuer,
            balance: b.balance,
            limit: b.limit,
          }));
          set({ balance: native?.balance || '0', balances: safeBalances });
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

      // ── Escrow — Soroban Contract ──────────────────────────────────────────
      // Funds go directly into the deployed Soroban escrow contract.
      // No custody wallet — the contract enforces all rules trustlessly.
      createEscrow: async (seller, amount, asset, description, expiryDays) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_ESCROW_CONTRACT_ID)
          throw new Error('Escrow contract not configured (VITE_ESCROW_CONTRACT_ID)');

        const { contractCreateEscrow } = await import('./escrow_contract.js');
        const { escrow_id, hash } = await contractCreateEscrow(
          address, seller, parseFloat(amount), parseInt(expiryDays)
        );

        const expiresAt = new Date(Date.now() + parseInt(expiryDays) * 86400000).toISOString();
        const record = {
          id: shortId(),
          hash,
          type: 'Create Escrow',
          amount: `${amount} ${asset}`,
          merchant: seller,
          description,
          buyer: address,
          escrow_id,           // on-chain contract escrow ID
          status: 'Funded',
          expiresAt,
          time: new Date().toISOString(),
        };

        // Record in analytics
        const { useAnalytics } = await import('./analytics.js');
        useAnalytics.getState().recordLocalTx({ txHash: hash, amount: parseFloat(amount), sourceAccount: address, type: 'Create Escrow' });
        useAnalytics.getState().confirmTx(hash, true);
        try {
          const { api } = await import('./api.js');
          await api.recordTx({ tx_hash: hash, amount: parseFloat(amount), source_account: address, type: 'Create Escrow', success: true });
        } catch (_) {}

        set((s) => ({ transactions: [record, ...s.transactions] }));
        await get().fetchBalance();
        return hash;
      },

      releaseEscrow: async (id) => {
        const { transactions, address } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) throw new Error('Escrow not found');

        const { contractConfirmDelivery } = await import('./escrow_contract.js');
        const result = await contractConfirmDelivery(address, escrow.escrow_id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Released', releaseHash: result.hash } : t
          ),
        }));
        await get().fetchBalance();
        return result.hash;
      },

      refundEscrow: async (id) => {
        const { transactions, address } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) throw new Error('Escrow not found');

        // If disputed → buyer cancels via contract cancel
        // If funded → buyer cancels before deadline
        const { contractCancel } = await import('./escrow_contract.js');
        const result = await contractCancel(address, escrow.escrow_id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Refunded', refundHash: result.hash } : t
          ),
        }));
        await get().fetchBalance();
        return result.hash;
      },

      // Seller requests refund (dispute flow) — calls contract dispute
      requestEscrowRefund: async (id) => {
        const { transactions, address } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) throw new Error('Escrow not found');

        const { contractDispute } = await import('./escrow_contract.js');
        await contractDispute(address, escrow.escrow_id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Disputed' } : t
          ),
        }));
      },

      // Auto-release after deadline (anyone can call)
      autoReleaseEscrow: async (id) => {
        const { transactions, address } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) throw new Error('Escrow not found');

        const { contractAutoRelease } = await import('./escrow_contract.js');
        const result = await contractAutoRelease(address, escrow.escrow_id);

        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Released', releaseHash: result.hash } : t
          ),
        }));
        await get().fetchBalance();
        return result.hash;
      },

      markDelivered: (id) => {
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, status: 'Delivered' } : t
          ),
        }));
      },

      disputeEscrow: async (id) => {
        const { transactions, address } = get();
        const escrow = transactions.find(t => t.id === id);
        if (!escrow) return;
        try {
          const { contractDispute } = await import('./escrow_contract.js');
          await contractDispute(address, escrow.escrow_id);
        } catch (_) { /* escrow may not have arbitrator — still update local state */ }
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

      // ── Lending — Soroban Pool Contract ───────────────────────────────────
      // All funds go directly into the deployed Soroban pool contract.
      // No custody wallet — the contract enforces all rules trustlessly.

      supplyLendingPool: async (amount, asset) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_POOL_CONTRACT_ID)
          throw new Error('Pool contract not configured (VITE_POOL_CONTRACT_ID)');

        const { poolDeposit } = await import('./pool_contract.js');
        const result = await poolDeposit(address, amount);

        const { useLendingStore } = await import('./lending.js');
        useLendingStore.getState().recordSupply(result.hash, amount, asset);

        // Record in analytics
        const { useAnalytics } = await import('./analytics.js');
        useAnalytics.getState().recordLocalTx({ txHash: result.hash, amount: parseFloat(amount), sourceAccount: address, type: 'Supply' });
        useAnalytics.getState().confirmTx(result.hash, true);
        try {
          const { api } = await import('./api.js');
          await api.recordTx({ tx_hash: result.hash, amount: parseFloat(amount), source_account: address, type: 'Supply', success: true });
        } catch (_) {}

        await get().fetchBalance();
        return result.hash;
      },

      withdrawSupply: async (amount) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_POOL_CONTRACT_ID)
          throw new Error('Pool contract not configured (VITE_POOL_CONTRACT_ID)');

        const { poolWithdraw } = await import('./pool_contract.js');
        const result = await poolWithdraw(address, amount);

        const { useLendingStore } = await import('./lending.js');
        useLendingStore.getState().fetchPoolBalance();

        try {
          const { api } = await import('./api.js');
          await api.recordTx({ tx_hash: result.hash, amount: parseFloat(amount), source_account: address, type: 'Withdraw Supply', success: true });
        } catch (_) {}

        await get().fetchBalance();
        return result.hash;
      },

      depositCollateral: async (amount) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_POOL_CONTRACT_ID)
          throw new Error('Pool contract not configured (VITE_POOL_CONTRACT_ID)');

        const { poolDepositCollateral } = await import('./pool_contract.js');
        const result = await poolDepositCollateral(address, amount);

        const { useLendingStore } = await import('./lending.js');
        useLendingStore.getState().fetchPoolBalance();

        await get().fetchBalance();
        return result.hash;
      },

      borrowFunds: async (amount, asset, termDays, paymentMethod) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_POOL_CONTRACT_ID)
          throw new Error('Pool contract not configured (VITE_POOL_CONTRACT_ID)');

        const { useLendingStore } = await import('./lending.js');
        const lending = useLendingStore.getState();
        lending.validateBorrow(amount);

        const { poolDepositCollateral, poolBorrow, getMaxBorrow } = await import('./pool_contract.js');

        // Check if user has collateral on-chain; if not, auto-deposit collateral = 1.6x amount
        const maxBorrow = await getMaxBorrow(address);
        if (!maxBorrow || parseFloat(maxBorrow) / 1e7 < parseFloat(amount)) {
          // Need to deposit collateral first: 160% of borrow amount
          const collateralNeeded = (parseFloat(amount) * 1.6).toFixed(7);
          await poolDepositCollateral(address, collateralNeeded);
        }

        const { hash, loan_id } = await poolBorrow(address, amount, parseInt(termDays));

        const loan = lending.recordBorrow(hash, amount, asset, parseInt(termDays), paymentMethod);

        // Store the on-chain loan ID so repay can reference it
        if (loan_id !== null) {
          const { useLendingStore: ls } = await import('./lending.js');
          const lsState = ls.getState();
          if (typeof lsState.updateLoanContractId === 'function') {
            lsState.updateLoanContractId(loan.id, loan_id);
          }
        }

        try {
          const { api } = await import('./api.js');
          await api.recordTx({ tx_hash: hash, amount: parseFloat(amount), source_account: address, type: 'Borrow', success: true });
        } catch (_) {}

        await get().fetchBalance();
        return loan.id;
      },

      repayLoan: async (loanId, partialAmount) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_POOL_CONTRACT_ID)
          throw new Error('Pool contract not configured (VITE_POOL_CONTRACT_ID)');

        const { useLendingStore } = await import('./lending.js');
        const lending = useLendingStore.getState();
        const loan = lending.loans.find(l => l.id === loanId);
        if (!loan) throw new Error('Loan not found');
        if (loan.status === 'Completed') throw new Error('Loan already fully repaid');

        const { calcRepayAmount } = await import('./lending.js');
        const now = new Date();
        const daysLate = Math.max(0, Math.ceil((now - new Date(loan.dueDate)) / 86400000));
        const fullRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate);
        const remaining = fullRepay - loan.amountRepaid;
        const payAmt = partialAmount ? Math.min(parseFloat(partialAmount), remaining) : remaining;
        if (payAmt <= 0) throw new Error('Nothing to repay');

        const { poolRepay } = await import('./pool_contract.js');
        // loan.contract_loan_id is the on-chain ID returned by poolBorrow
        const contractLoanId = loan.contract_loan_id || 1;
        const result = await poolRepay(address, contractLoanId, payAmt);

        const repayResult = lending.recordRepayment(loanId, payAmt, result.hash);

        try {
          const { api } = await import('./api.js');
          await api.recordTx({ tx_hash: result.hash, amount: payAmt, source_account: address, type: 'Repay', success: true });
        } catch (_) {}

        await get().fetchBalance();
        return { hash: result.hash, ...repayResult };
      },

      createFixedDeposit: async (amount, asset, termDays, apyPct) => {
        const { address } = get();
        if (!address) throw new Error('Wallet not connected');
        if (!import.meta.env.VITE_POOL_CONTRACT_ID)
          throw new Error('Pool contract not configured (VITE_POOL_CONTRACT_ID)');

        const { poolCreateFD } = await import('./pool_contract.js');
        const { hash, fd_id } = await poolCreateFD(address, amount, parseInt(termDays));

        const { useLendingStore } = await import('./lending.js');
        // Pass contract_fd_id so claim works correctly for multiple FDs
        useLendingStore.getState().recordFixedDeposit(hash, amount, asset, parseInt(termDays), parseFloat(apyPct), fd_id);

        try {
          const { api } = await import('./api.js');
          await api.recordTx({ tx_hash: hash, amount: parseFloat(amount), source_account: address, type: 'Fixed Deposit', success: true });
        } catch (_) {}

        await get().fetchBalance();
        return hash;
      },
    }),
    {
      name: 'wallet-store-v3',
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
    }
  )
);
