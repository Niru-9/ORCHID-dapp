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

// ── Borrow rates by term + payment type ──────────────────────────────────────
// One-Time Payment = base rate (lower, lump sum preferred)
// EMI = base rate + 3% premium (installment risk)
export const BORROW_BASE_APY = {
  30:  { 'One-Time Payment': 12.0, 'EMI': 15.0 },
  90:  { 'One-Time Payment': 14.0, 'EMI': 17.0 },
  180: { 'One-Time Payment': 16.0, 'EMI': 19.0 },
};

// ── Fixed Deposit rates — longer lock = higher reward ────────────────────────
export const FD_APY = {
  30:    5.0,
  90:    6.5,
  180:   8.0,
  365:  10.0,
  1095: 12.5,
  1825: 15.0,
};

// ── Dynamic supply APY ────────────────────────────────────────────────────────
// supply_apy = avg_borrow_rate × utilization × 0.8
// (suppliers earn 80% of what borrowers pay; protocol keeps 20%)
export function calcSupplyApy(poolUtilization, avgBorrowRate = 14.0) {
  const util = Math.min(100, Math.max(0, poolUtilization)) / 100;
  const raw = avgBorrowRate * util * 0.8;
  return Math.max(3.0, +raw.toFixed(1)); // floor at 3% to always reward suppliers
}

// ── Credit score thresholds ───────────────────────────────────────────────────
export const CREDIT_GATE = 400; // below this = no new loans

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

// ── BigInt-safe JSON serializer for Zustand persist ──────────────────────────
const bigIntSerializer = {
  serialize: (state) => JSON.stringify(state, (_key, val) =>
    typeof val === 'bigint' ? val.toString() : val
  ),
  deserialize: (str) => JSON.parse(str),
};

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
        const { poolUtilization } = get();
        const dynamicApy = calcSupplyApy(poolUtilization);
        const record = {
          id: `SUP-${Date.now()}`,
          hash,
          type: 'Supply',
          amount: parseFloat(amount),
          asset,
          apy: dynamicApy,
          status: 'Active',
          time: new Date().toISOString(),
        };
        set((s) => ({ deposits: [record, ...s.deposits] }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // FIXED DEPOSIT
      // ─────────────────────────────────────────────────────────────────────
      recordFixedDeposit: (hash, amount, asset, termDays, apyPct, contractFdId = null) => {
        const maturesAt = new Date(Date.now() + termDays * MS_PER_DAY).toISOString();
        const payout = calcFdPayout(parseFloat(amount), apyPct, termDays);
        const record = {
          id: `FD-${Date.now()}`,
          hash,
          contract_fd_id: contractFdId, // on-chain FD ID for claim
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

        // Call pool contract to claim FD — contract sends payout to user
        const { poolClaimFD } = await import('./pool_contract.js');
        const contractFdId = fd.contract_fd_id || 1;
        const result = await poolClaimFD(userAddress, contractFdId);

        set((s) => ({
          fixedDeposits: s.fixedDeposits.map((f) =>
            f.id === fdId ? { ...f, status: 'Matured', claimHash: result.hash } : f
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

        // Credit-gated: below CREDIT_GATE = max penalty rate
        let baseApy;
        if (creditScore < CREDIT_GATE) {
          baseApy = 22.0;
        } else {
          const rateTable = BORROW_BASE_APY[termDays] ?? BORROW_BASE_APY[90];
          baseApy = rateTable[paymentType] ?? rateTable['One-Time Payment'];
        }

        const dueDate = new Date(Date.now() + termDays * MS_PER_DAY).toISOString();
        const repayAmount = calcRepayAmount(parseFloat(amount), baseApy, termDays, 0);

        const loan = {
          id: `LOAN-${Date.now()}`,
          hash,
          contract_loan_id: null, // set by borrowFunds after contract call
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
          creditScore: clamp(s.creditScore - 5, 300, 800),
        }));

        return loan;
      },

      // Update contract loan ID after on-chain borrow
      updateLoanContractId: (localId, contractLoanId) => {
        set((s) => ({
          loans: s.loans.map(l =>
            l.id === localId ? { ...l, contract_loan_id: contractLoanId } : l
          ),
        }));
      },
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
      // POOL BALANCE — fetch from Soroban contract (source of truth)
      // ─────────────────────────────────────────────────────────────────────
      fetchPoolBalance: async () => {
        try {
          const { getPoolStats, getSupplyApy, getBorrowRate } = await import('./pool_contract.js');
          const [stats, supplyApyRaw, borrowRateRaw] = await Promise.all([
            getPoolStats(),
            getSupplyApy(),
            getBorrowRate(),
          ]);

          if (stats) {
            // Contract stores amounts in stroops (1e7), convert to XLM
            const totalSupplied = Number(stats.total_supplied ?? 0) / 1e7;
            const totalBorrowed = Number(stats.total_borrowed ?? 0) / 1e7;
            const utilization = totalSupplied > 0
              ? Math.min(100, Math.round((totalBorrowed / totalSupplied) * 100))
              : 0;
            set({ poolBalance: totalSupplied, poolUtilization: utilization });
          }
        } catch (_) {
          // Fallback to Horizon custody wallet balance
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
            const { loans } = get();
            const activeDebt = loans
              .filter((l) => l.status === 'Active' || l.status === 'Partial')
              .reduce((acc, l) => acc + l.amount - l.amountRepaid, 0);
            const utilization = balance > 0
              ? Math.min(100, Math.round((activeDebt / (balance + activeDebt)) * 100))
              : 0;
            set({ poolBalance: balance, poolUtilization: utilization });
          } catch (_) { /* silent */ }
        }
      },

      // Validate borrow request before executing
      validateBorrow: (amount) => {
        const { poolBalance, loans, creditScore } = get();
        const activeDebt = loans
          .filter((l) => l.status === 'Active' || l.status === 'Partial')
          .reduce((acc, l) => acc + (l.amount - l.amountRepaid), 0);

        if (creditScore < CREDIT_GATE)
          throw new Error(`Credit score too low (${creditScore}). Minimum required: ${CREDIT_GATE}. Repay existing loans to improve your score.`);
        if (parseFloat(amount) <= 0) throw new Error('Invalid amount');
        if (parseFloat(amount) > poolBalance * 0.8)
          throw new Error(`Max borrow is 80% of pool liquidity (${(poolBalance * 0.8).toFixed(2)} XLM)`);
        if (loans.filter(l => l.status === 'Active').length >= 3)
          throw new Error('Maximum 3 concurrent active loans');
      },
    }),
    {
      name: 'orchid-lending-v1',
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
