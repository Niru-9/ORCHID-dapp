/**
 * Orchid Lending Engine (Client-side State)
 * ──────────────────────────────────────────
 * Manages all lending-related state in the browser using Zustand + localStorage.
 * This is the local record-keeping layer — the Soroban pool contract is the
 * source of truth for actual fund balances.
 *
 * What lives here:
 *  - Loan records (borrow history, repayment tracking)
 *  - Supply deposit records
 *  - Fixed deposit records
 *  - Credit score (local estimate, mirrors on-chain score)
 *  - Pool balance snapshot (fetched from contract)
 *
 * Interest & penalty rules:
 *  - Borrow APY: 12–19% depending on term and payment type
 *  - Late penalty: +1.5% per 2 days overdue (additive on top of base rate)
 *  - Fixed deposit APY: 5–15% depending on lock term
 *  - Supply APY: dynamic — 80% of (avg borrow rate × utilization), min 3%
 *  - Credit score: -5/day late, +20 on-time repay, +10 early repay
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MS_PER_DAY = 86_400_000; // milliseconds in one day

// ── Borrow Interest Rates ─────────────────────────────────────────────────────
// Rates vary by term length and payment type.
// One-Time Payment = lower rate (lump sum preferred by protocol)
// EMI = +3% premium (installment risk)
export const BORROW_BASE_APY = {
  30:  { 'One-Time Payment': 12.0, 'EMI': 15.0 },
  90:  { 'One-Time Payment': 14.0, 'EMI': 17.0 },
  180: { 'One-Time Payment': 16.0, 'EMI': 19.0 },
};

// ── Fixed Deposit Rates ───────────────────────────────────────────────────────
// Longer lock period = higher reward. Rates in % APY.
export const FD_APY = {
  30:    5.0,   // 1 month
  90:    6.5,   // 3 months
  180:   8.0,   // 6 months
  365:  10.0,   // 1 year
  1095: 12.5,   // 3 years
  1825: 15.0,   // 5 years
};

/**
 * calcSupplyApy — computes the dynamic supply APY for lenders.
 * Formula: avg_borrow_rate × utilization × 0.8
 * (Lenders earn 80% of what borrowers pay; protocol keeps 20%)
 * Floor: 3% — always rewards suppliers even at low utilization.
 *
 * @param poolUtilization - % of pool currently lent out (0–100)
 * @param avgBorrowRate   - average borrow rate across active loans
 */
export function calcSupplyApy(poolUtilization, avgBorrowRate = 14.0) {
  const util = Math.min(100, Math.max(0, poolUtilization)) / 100;
  const raw = avgBorrowRate * util * 0.8;
  return Math.max(3.0, +raw.toFixed(1));
}

// Minimum credit score required to take a new loan
export const CREDIT_GATE = 400;

/**
 * calcPenaltyRate — adds late payment penalty on top of the base borrow rate.
 * Penalty: +1.5% for every 2 days overdue (simple additive interest).
 *
 * @param basePct  - original borrow APY
 * @param daysLate - how many days past the due date
 */
export function calcPenaltyRate(basePct, daysLate) {
  const penaltyPeriods = Math.floor(daysLate / 2); // penalty triggers every 2 days
  return basePct + penaltyPeriods * 1.5;
}

/**
 * calcRepayAmount — total amount owed including interest and any late penalties.
 * Uses simple interest: principal × rate × (term / 365)
 *
 * @param principal - original borrowed amount in XLM
 * @param basePct   - base borrow APY
 * @param termDays  - loan term in days
 * @param daysLate  - days past due (0 if on time)
 */
export function calcRepayAmount(principal, basePct, termDays, daysLate = 0) {
  const effectiveRate = calcPenaltyRate(basePct, daysLate);
  const interest = principal * (effectiveRate / 100) * (termDays / 365);
  return +(principal + interest).toFixed(7);
}

/**
 * calcFdPayout — total payout for a fixed deposit at maturity.
 * principal + (principal × APY × term / 365)
 */
export function calcFdPayout(principal, apyPct, termDays) {
  const interest = principal * (apyPct / 100) * (termDays / 365);
  return +(principal + interest).toFixed(7);
}

/**
 * creditDelta — how much the credit score changes after a repayment.
 *  - Early repay: +10 bonus
 *  - On time:     +20
 *  - Late:        -5 per day late
 */
export function creditDelta(daysLate, isEarly = false) {
  if (isEarly) return +10;
  if (daysLate === 0) return +20;
  return -(daysLate * 5);
}

/** Clamps a value between min and max. */
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

// BigInt-safe JSON serializer — needed because Soroban returns BigInt values
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
      loans: [],          // all borrow records (active + historical)
      deposits: [],       // supply contributions
      fixedDeposits: [],  // fixed deposit records
      creditScore: 800,   // starts at max, changes with repayment behavior

      // ── Pool snapshot (fetched from contract) ─────────────────────────────
      poolBalance: 0,     // total XLM currently in the pool
      poolUtilization: 0, // % of pool currently lent out (0–100)

      // ─────────────────────────────────────────────────────────────────────
      // recordSupply — called AFTER the on-chain deposit tx is confirmed.
      // Saves the supply record locally with the dynamic APY at time of deposit.
      // ─────────────────────────────────────────────────────────────────────
      recordSupply: (hash, amount, asset) => {
        const { poolUtilization } = get();
        const dynamicApy = calcSupplyApy(poolUtilization); // APY at time of deposit
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
      // recordFixedDeposit — called AFTER the on-chain create_fd tx is confirmed.
      // Calculates maturity date and expected payout, saves locally.
      // ─────────────────────────────────────────────────────────────────────
      recordFixedDeposit: (hash, amount, asset, termDays, apyPct, contractFdId = null) => {
        const maturesAt = new Date(Date.now() + termDays * MS_PER_DAY).toISOString();
        const payout = calcFdPayout(parseFloat(amount), apyPct, termDays);
        const record = {
          id: `FD-${Date.now()}`,
          hash,
          contract_fd_id: contractFdId, // on-chain FD ID needed for claim
          type: 'Fixed Deposit',
          amount: parseFloat(amount),
          asset,
          term: termDays,
          apy: apyPct,
          payout,           // expected total at maturity
          maturesAt,        // ISO timestamp when claimable
          status: 'Active',
          time: new Date().toISOString(),
        };
        set((s) => ({ fixedDeposits: [record, ...s.fixedDeposits] }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // claimFd — claim a matured fixed deposit.
      // Checks maturity date, then calls the pool contract to send payout.
      // ─────────────────────────────────────────────────────────────────────
      claimFd: async (fdId, userAddress) => {
        const { fixedDeposits } = get();
        const fd = fixedDeposits.find((f) => f.id === fdId);
        if (!fd) throw new Error('Fixed deposit not found');
        if (fd.status !== 'Active') throw new Error('Already claimed');
        if (new Date(fd.maturesAt) > new Date()) {
          const daysLeft = Math.ceil((new Date(fd.maturesAt) - Date.now()) / MS_PER_DAY);
          throw new Error(`Not matured yet — ${daysLeft} day(s) remaining`);
        }

        // Call the pool contract — it sends principal + interest to the user
        const { poolClaimFD } = await import('./pool_contract.js');
        const contractFdId = fd.contract_fd_id || 1;
        const result = await poolClaimFD(userAddress, contractFdId);

        // Mark as claimed locally
        set((s) => ({
          fixedDeposits: s.fixedDeposits.map((f) =>
            f.id === fdId ? { ...f, status: 'Matured', claimHash: result.hash } : f
          ),
        }));
        return fd.payout;
      },

      // ─────────────────────────────────────────────────────────────────────
      // recordBorrow — called AFTER the on-chain borrow tx is confirmed.
      // Calculates the interest rate based on credit score, term, and payment type.
      // Credit score drops by 5 when a new loan is opened.
      // ─────────────────────────────────────────────────────────────────────
      recordBorrow: (hash, amount, asset, termDays, paymentType) => {
        const { creditScore } = get();

        // Users below the credit gate get the maximum penalty rate
        let baseApy;
        if (creditScore < CREDIT_GATE) {
          baseApy = 22.0; // max penalty rate for low-credit borrowers
        } else {
          const rateTable = BORROW_BASE_APY[termDays] ?? BORROW_BASE_APY[90];
          baseApy = rateTable[paymentType] ?? rateTable['One-Time Payment'];
        }

        const dueDate = new Date(Date.now() + termDays * MS_PER_DAY).toISOString();
        const repayAmount = calcRepayAmount(parseFloat(amount), baseApy, termDays, 0);

        const loan = {
          id: `LOAN-${Date.now()}`,
          hash,
          contract_loan_id: null, // filled in by borrowFunds after contract returns loan_id
          type: 'Borrow',
          amount: parseFloat(amount),
          asset,
          apy: baseApy,
          term: termDays,
          paymentType,
          repayAmount,      // total owed at maturity (no penalty yet)
          amountRepaid: 0,  // tracks partial repayments
          dueDate,
          status: 'Active',
          time: new Date().toISOString(),
        };

        set((s) => ({
          loans: [loan, ...s.loans],
          creditScore: clamp(s.creditScore - 5, 300, 800), // opening a loan slightly lowers score
        }));

        return loan;
      },

      /**
       * updateLoanContractId — stores the on-chain loan ID returned by the contract.
       * Called after poolBorrow returns the loan_id. Needed for repayment.
       */
      updateLoanContractId: (localId, contractLoanId) => {
        set((s) => ({
          loans: s.loans.map(l =>
            l.id === localId ? { ...l, contract_loan_id: contractLoanId } : l
          ),
        }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // recordRepayment — called AFTER the on-chain repay tx is confirmed.
      // Recalculates total owed with any late penalties, updates credit score.
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

        // Recalculate total owed with any accumulated late penalties
        const effectiveRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate);
        const newAmountRepaid = loan.amountRepaid + parseFloat(paidAmount);
        const isFullyRepaid = newAmountRepaid >= effectiveRepay - 0.0000001; // float tolerance

        const delta = creditDelta(daysLate, isEarly);

        set((s) => ({
          loans: s.loans.map((l) =>
            l.id === loanId
              ? {
                  ...l,
                  hash: hash || l.hash,
                  amountRepaid: newAmountRepaid,
                  status: isFullyRepaid ? 'Completed' : 'Partial',
                  repayAmount: effectiveRepay, // update with penalty if late
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
      // tickPenalties — call periodically to update overdue loan interest.
      // Recalculates repayAmount for all active/partial loans that are past due.
      // Also deducts -5 credit score per overdue loan per call.
      // ─────────────────────────────────────────────────────────────────────
      tickPenalties: () => {
        const now = new Date();
        set((s) => {
          let scoreDelta = 0;
          const loans = s.loans.map((loan) => {
            if (loan.status !== 'Active' && loan.status !== 'Partial') return loan;
            const due = new Date(loan.dueDate);
            if (now <= due) return loan; // not overdue yet

            const daysLate = Math.ceil((now - due) / MS_PER_DAY);
            const newRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, daysLate);
            scoreDelta -= 5; // -5 per overdue loan per tick
            return { ...loan, repayAmount: newRepay, daysLate };
          });
          return {
            loans,
            creditScore: clamp(s.creditScore + scoreDelta, 300, 800),
          };
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // fetchPoolBalance — fetches live pool stats from the Soroban contract.
      // Falls back to Horizon custody wallet balance if contract is unreachable.
      // Updates poolBalance (total XLM in pool) and poolUtilization (% lent out).
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
            // Contract stores amounts in stroops — convert to XLM
            const totalSupplied = Number(stats.total_supplied ?? 0) / 1e7;
            const totalBorrowed = Number(stats.total_borrowed ?? 0) / 1e7;
            const utilization = totalSupplied > 0
              ? Math.min(100, Math.round((totalBorrowed / totalSupplied) * 100))
              : 0;
            set({ poolBalance: totalSupplied, poolUtilization: utilization });
          }
        } catch (_) {
          // Fallback: read the custody wallet balance from Horizon
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
            // Estimate utilization from local loan records
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

      // ─────────────────────────────────────────────────────────────────────
      // validateBorrow — checks all conditions before allowing a borrow.
      // Throws a descriptive error if any condition fails.
      // ─────────────────────────────────────────────────────────────────────
      validateBorrow: (amount) => {
        const { poolBalance, loans, creditScore } = get();
        const activeDebt = loans
          .filter((l) => l.status === 'Active' || l.status === 'Partial')
          .reduce((acc, l) => acc + (l.amount - l.amountRepaid), 0);

        if (creditScore < CREDIT_GATE)
          throw new Error(`Credit score too low (${creditScore}). Minimum required: ${CREDIT_GATE}. Repay existing loans to improve your score.`);
        if (parseFloat(amount) <= 0)
          throw new Error('Invalid amount');
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
      // Only persist the data fields — not functions
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
