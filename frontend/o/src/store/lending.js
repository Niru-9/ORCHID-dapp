/**
 * Orchid Lending Engine
 * ─────────────────────
 * All lending state lives here, separate from the wallet store.
 *
 * Rules:
 *  - Supply / FD → user sends XLM to POOL_ADDRESS (on-chain tx, user signs)
 *  - Borrow      → recorded locally; pool disburses via backend/admin key (out of scope for client)
 *  - Repay       → user sends XLM to POOL_ADDRESS (on-chain tx, user signs)
 *  - Penalty     → +1.5% interest every 2 days overdue (simple interest on top of base)
 *  - Credit      → -5 pts/day late, +20 pts on-time repay, +5 pts early repay
 *  - FD maturity → principal + interest tracked; user can claim after maturity
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MS_PER_DAY = 86_400_000;

// ── APY tables ────────────────────────────────────────────────────────────────
export const BORROW_BASE_APY = {
  30:  12.0,
  90:  14.0,
  180: 16.0,
};

export const FD_APY = {
  30:   4.0,
  90:   4.3,
  180:  4.6,
  365:  5.7,
  1095: 6.3,
  1825: 7.1,
};

export const SUPPLY_APY = 9.6;

// ── Penalty: +1.5% per 2 days overdue (simple, additive) ─────────────────────
export function calcPenaltyRate(basePct, daysLate) {
  const penaltyPeriods = Math.floor(daysLate / 2); // every 2 days
  return basePct + penaltyPeriods * 1.5;
}

// ── Total repay amount with penalty ──────────────────────────────────────────
export function calcRepayAmount(principal, basePct, termDays, daysLate = 0) {
  const effectiveRate = calcPenaltyRate(basePct, daysLate);
  const interest = principal * (effectiveRate / 100) * (termDays / 365);
  return +(principal + interest).toFixed(7);
}

// ── FD maturity payout ────────────────────────────────────────────────────────
export function calcFdPayout(principal, apyPct, termDays) {
  const interest = principal * (apyPct / 100) * (termDays / 365);
  return +(principal + interest).toFixed(7);
}

// ── Credit score delta ────────────────────────────────────────────────────────
export function creditDelta(daysLate, isEarly = false) {
  if (isEarly) return +10;           // early repay bonus
  if (daysLate === 0) return +20;    // on-time
  return -(daysLate * 5);            // -5 per day late
}

function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

export const useLendingStore = create(
  persist(
    (set, get) => ({
      // ── Per-user lending state ────────────────────────────────────────────
      loans: [],          // active + historical borrow records
      deposits: [],       // supply contributions
      fixedDeposits: [],  // FD records
      creditScore: 800,

      // ── Pool snapshot (fetched from Horizon) ─────────────────────────────
      poolBalance: 0,     // live XLM balance of POOL_ADDRESS
      poolUtilization: 0, // % of pool currently lent out

      // ─────────────────────────────────────────────────────────────────────
      // SUPPLY
      // Called AFTER the on-chain tx is confirmed. Records the deposit.
      // ─────────────────────────────────────────────────────────────────────
      recordSupply: (hash, amount, asset) => {
        const record = {
          id: `SUP-${Date.now()}`,
          hash,
          type: 'Supply',
          amount: parseFloat(amount),
          asset,
          apy: SUPPLY_APY,
          status: 'Active',
          time: new Date().toISOString(),
        };
        set((s) => ({ deposits: [record, ...s.deposits] }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // FIXED DEPOSIT
      // ─────────────────────────────────────────────────────────────────────
      recordFixedDeposit: (hash, amount, asset, termDays, apyPct) => {
        const maturesAt = new Date(Date.now() + termDays * MS_PER_DAY).toISOString();
        const payout = calcFdPayout(parseFloat(amount), apyPct, termDays);
        const record = {
          id: `FD-${Date.now()}`,
          hash,
          type: 'Fixed Deposit',
          amount: parseFloat(amount),
          asset,
          term: termDays,
          apy: apyPct,
          payout,
          maturesAt,
          status: 'Active',
          time: new Date().toISOString(),
        };
        set((s) => ({ fixedDeposits: [record, ...s.fixedDeposits] }));
      },

      // Claim matured FD — backend sends principal + interest to user's wallet
      claimFd: async (fdId, userAddress) => {
        const { fixedDeposits } = get();
        const fd = fixedDeposits.find((f) => f.id === fdId);
        if (!fd) throw new Error('Fixed deposit not found');
        if (fd.status !== 'Active') throw new Error('Already claimed');
        if (new Date(fd.maturesAt) > new Date()) {
          const daysLeft = Math.ceil((new Date(fd.maturesAt) - Date.now()) / MS_PER_DAY);
          throw new Error(`Not matured yet — ${daysLeft} day(s) remaining`);
        }

        // Call backend to send payout from pool → user
        const { api } = await import('./api.js');
        await api.disburseFdMaturity(userAddress, fd.payout, fdId);

        set((s) => ({
          fixedDeposits: s.fixedDeposits.map((f) =>
            f.id === fdId ? { ...f, status: 'Matured' } : f
          ),
        }));
        return fd.payout;
      },

      // ─────────────────────────────────────────────────────────────────────
      // BORROW
      // Records loan metadata. Actual disbursement is an on-chain tx from pool.
      // ─────────────────────────────────────────────────────────────────────
      recordBorrow: (hash, amount, asset, termDays, paymentType) => {
        const { creditScore } = get();
        // Credit-gated rate: poor credit → max rate
        const baseApy = creditScore < 500
          ? 22.0
          : BORROW_BASE_APY[termDays] ?? 14.0;

        const dueDate = new Date(Date.now() + termDays * MS_PER_DAY).toISOString();
        const repayAmount = calcRepayAmount(parseFloat(amount), baseApy, termDays, 0);

        const loan = {
          id: `LOAN-${Date.now()}`,
          hash,
          type: 'Borrow',
          amount: parseFloat(amount),
          asset,
          apy: baseApy,
          term: termDays,
          paymentType,
          repayAmount,
          amountRepaid: 0,
          dueDate,
          status: 'Active',
          time: new Date().toISOString(),
        };

        set((s) => ({
          loans: [loan, ...s.loans],
          creditScore: clamp(s.creditScore - 5, 300, 800), // small hit for taking debt
        }));

        return loan;
      },

      // ─────────────────────────────────────────────────────────────────────
      // REPAY (full or partial)
      // Called AFTER the on-chain repayment tx is confirmed.
      // ─────────────────────────────────────────────────────────────────────
      recordRepayment: (loanId, paidAmount, hash) => {
        const { loans } = get();
        const loan = loans.find((l) => l.id === loanId);
        if (!loan) throw new Error('Loan not found');
        if (loan.status === 'Completed') throw new Error('Loan already repaid');

        const now = new Date();
        const due = new Date(loan.dueDate);
        const daysLate = Math.max(0, Math.ceil((now - due) / MS_PER_DAY));
        const isEarly = now < due;

        // Recalculate with penalty if late
        const effectiveRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate);
        const newAmountRepaid = loan.amountRepaid + parseFloat(paidAmount);
        const isFullyRepaid = newAmountRepaid >= effectiveRepay - 0.0000001;

        const delta = creditDelta(daysLate, isEarly);

        set((s) => ({
          loans: s.loans.map((l) =>
            l.id === loanId
              ? {
                  ...l,
                  hash: hash || l.hash,
                  amountRepaid: newAmountRepaid,
                  status: isFullyRepaid ? 'Completed' : 'Partial',
                  repayAmount: effectiveRepay, // update with penalty
                  paidAt: now.toISOString(),
                  daysLate,
                }
              : l
          ),
          creditScore: clamp(s.creditScore + delta, 300, 800),
        }));

        return { isFullyRepaid, effectiveRepay, daysLate, delta };
      },

      // ─────────────────────────────────────────────────────────────────────
      // PENALTY TICK — call periodically to update overdue loan interest
      // ─────────────────────────────────────────────────────────────────────
      tickPenalties: () => {
        const now = new Date();
        set((s) => {
          let scoreDelta = 0;
          const loans = s.loans.map((loan) => {
            if (loan.status !== 'Active' && loan.status !== 'Partial') return loan;
            const due = new Date(loan.dueDate);
            if (now <= due) return loan;

            const daysLate = Math.ceil((now - due) / MS_PER_DAY);
            const newRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate);
            scoreDelta -= 5; // -5 per day per loan (capped below)
            return { ...loan, repayAmount: newRepay, daysLate };
          });
          return {
            loans,
            creditScore: clamp(s.creditScore + scoreDelta, 300, 800),
          };
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // POOL BALANCE — fetch live from Horizon
      // ─────────────────────────────────────────────────────────────────────
      fetchPoolBalance: async () => {
        const poolAddr = import.meta.env.VITE_POOL_ADDRESS;
        if (!poolAddr) return;
        try {
          const res = await fetch(
            `${import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org'}/accounts/${poolAddr}`
          );
          if (!res.ok) return;
          const data = await res.json();
          const native = data.balances?.find((b) => b.asset_type === 'native');
          const balance = parseFloat(native?.balance || 0);

          // Utilization = total active loan principal / pool balance
          const { loans } = get();
          const activeDebt = loans
            .filter((l) => l.status === 'Active' || l.status === 'Partial')
            .reduce((acc, l) => acc + l.amount - l.amountRepaid, 0);

          const utilization = balance > 0
            ? Math.min(100, Math.round((activeDebt / (balance + activeDebt)) * 100))
            : 0;

          set({ poolBalance: balance, poolUtilization: utilization });
        } catch (_) { /* silent */ }
      },

      // Validate borrow request before executing
      validateBorrow: (amount) => {
        const { poolBalance, loans, creditScore } = get();
        const activeDebt = loans
          .filter((l) => l.status === 'Active' || l.status === 'Partial')
          .reduce((acc, l) => acc + (l.amount - l.amountRepaid), 0);

        if (creditScore < 300) throw new Error('Credit score too low to borrow');
        if (parseFloat(amount) <= 0) throw new Error('Invalid amount');
        if (parseFloat(amount) > poolBalance * 0.8)
          throw new Error(`Max borrow is 80% of pool liquidity (${(poolBalance * 0.8).toFixed(2)} XLM)`);
        if (activeDebt > 0 && loans.filter(l => l.status === 'Active').length >= 3)
          throw new Error('Maximum 3 concurrent active loans');
      },
    }),
    {
      name: 'orchid-lending-v1',
      partialize: (s) => ({
        loans: s.loans,
        deposits: s.deposits,
        fixedDeposits: s.fixedDeposits,
        creditScore: s.creditScore,
        poolBalance: s.poolBalance,
        poolUtilization: s.poolUtilization,
      }),
    }
  )
);
