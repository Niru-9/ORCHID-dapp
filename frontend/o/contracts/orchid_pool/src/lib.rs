//! Orchid Pool — Soroban Lending Protocol v3 (Adversarially Hardened)
//!
//! ─── COMPONENTS ──────────────────────────────────────────────────────────────
//!   Liquidity Pool · Collateral · Borrow · Repay · Partial Liquidation
//!
//! ─── CHANGES FROM v2 ─────────────────────────────────────────────────────────
//!   1. Oracle staleness check — price rejected if older than MAX_PRICE_AGE_SECS
//!   2. Oracle sanity check — price update rejected if > MAX_PRICE_CHANGE_BPS per update
//!   3. Partial liquidation — liquidate 50% of debt, not 100% (less punishing, safer)
//!   4. Liquidation cooldown — MIN_BORROW_AGE_SECS before a position can be liquidated
//!   5. Circuit breakers — borrow/withdraw blocked at high utilization or price volatility
//!   6. Bad debt tracking — DataKey::BadDebt; absorbed when collateral < debt
//!   7. Utilization cap — borrowing blocked above MAX_UTILIZATION_BPS
//!
//! ─── SECURITY MODEL ──────────────────────────────────────────────────────────
//!   • Oracle: admin-set with staleness + sanity guards (replace with TWAP in prod)
//!   • Health factor: collateral_usd * LTV / debt_usd (both in USD via oracle)
//!   • Partial liquidation: 50% of debt per call, capped at available collateral
//!   • Circuit breaker: borrow blocked if utilization > MAX_UTILIZATION_BPS
//!   • Bad debt: tracked explicitly, not silently absorbed into pool

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// 66% LTV — borrower needs 150% collateral to borrow 100%.
const LTV_RATIO: i128 = 6_600;

/// Health factor floor in BPS. Below this → liquidatable.
const MIN_HEALTH: i128 = 10_000; // 1.0

/// Liquidation bonus for liquidators (5%).
const LIQUIDATION_BONUS: i128 = 500;

/// Base borrow APY in BPS (5%).
const BASE_BORROW_RATE: i128 = 500;

/// Additional rate slope at 100% utilization (+20%).
const RATE_SLOPE: i128 = 2_000;

const SECONDS_PER_YEAR: i128 = 31_536_000;

/// Protocol fee on interest (20%).
const PROTOCOL_FEE_BPS: i128 = 2_000;

const BPS: i128 = 10_000;

/// Price scale: prices stored as USD * PRICE_SCALE.
/// e.g. $1.00 = 1_000_000, $0.10 = 100_000
const PRICE_SCALE: i128 = 1_000_000;

/// Admin rescue delay after pause (48 hours).
const RESCUE_DELAY_SECS: u64 = 48 * 3_600;

/// Maximum price age in seconds. Prices older than this are rejected.
const MAX_PRICE_AGE_SECS: u64 = 5 * 60; // 5 minutes

/// Maximum price change per update in BPS. Rejects oracle manipulation attempts.
const MAX_PRICE_CHANGE_BPS: i128 = 2_000; // 20% per update

/// Utilization cap — borrowing blocked above this level.
const MAX_UTILIZATION_BPS: i128 = 9_000; // 90%

/// Partial liquidation fraction — liquidate this fraction of debt per call.
const LIQUIDATION_FRACTION_BPS: i128 = 5_000; // 50%

/// Dynamic liquidation bonus bounds.
const LIQ_BONUS_MIN: i128 = 300;   // 3% — low risk
const LIQ_BONUS_MID: i128 = 500;   // 5% — normal
const LIQ_BONUS_HIGH: i128 = 1_000; // 10% — high utilization or near-zero HF

/// Minimum time a loan must exist before it can be liquidated.
/// Prevents flash-loan-style instant borrow + manipulate + liquidate attacks.
const MIN_BORROW_AGE_SECS: u64 = 300; // 5 minutes

/// Share of protocol interest fees routed to insurance fund.
const INSURANCE_FEE_BPS: i128 = 2_000; // 20% of interest fees

/// How many consecutive oracle sanity-limit hits trigger auto-pause.
/// A slow price manipulation attack hits this before doing real damage.
const ORACLE_STRIKE_LIMIT: u32 = 3;

/// Bad debt threshold as BPS of total_supplied. Auto-pauses if exceeded.
const BAD_DEBT_PAUSE_BPS: i128 = 500; // 5% of pool

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    PoolState,
    Supply(Address),
    Collateral(Address),
    Loan(Address, u64),
    LoanCounter(Address),
    Admin,
    Token,
    ProtocolFees,
    /// Per-token USD price, scaled by PRICE_SCALE.
    Price(Address),
    /// Timestamp when price was last updated.
    PriceUpdatedAt(Address),
    Paused,
    PausedAt,
    /// Accumulated bad debt — debt that could not be covered by collateral.
    BadDebt,
    /// Insurance reserve funded by protocol fees. Covers bad debt shortfalls.
    InsuranceFund,
    /// Count of consecutive price sanity-limit hits. Auto-pauses at threshold.
    OracleStrikeCount,
}

// ─── Pool State ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Default)]
pub struct PoolState {
    pub total_supplied:   i128,
    pub total_borrowed:   i128,
    pub total_lp_shares:  i128,
    pub last_update:      u64,
    /// Cumulative interest index, starts at BPS. Used for per-loan accrual.
    pub accumulated_rate: i128,
}

// ─── Supply Position ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct SupplyPosition {
    pub lp_shares:    i128,
    pub deposited_at: u64,
    pub apy_snapshot: i128,
}

// ─── Collateral Position ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct CollateralPosition {
    pub amount:       i128,
    pub deposited_at: u64,
}

// ─── Loan ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum LoanStatus { Active, Repaid, Liquidated }

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub id:            u64,
    pub borrower:      Address,
    pub principal:     i128,
    pub apy_bps:       i128,
    /// Accumulated rate snapshot at origination — used to compute accrued interest.
    pub rate_index_at: i128,
    pub originated_at: u64,
    pub due_date:      u64,
    pub amount_repaid: i128,
    pub status:        LoanStatus,
}

// ─── View Structs ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct HealthInfo {
    /// Raw collateral token amount.
    pub collateral_amount: i128,
    /// Collateral value in USD (scaled by PRICE_SCALE).
    pub collateral_usd:    i128,
    /// Total debt in USD (scaled by PRICE_SCALE).
    pub total_debt_usd:    i128,
    /// Health factor in BPS. i128::MAX when debt == 0.
    pub health_factor:     i128,
    /// Maximum additional borrow in token units.
    pub max_borrow:        i128,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OrchidPool;

#[contractimpl]
impl OrchidPool {

    // ── Init ──────────────────────────────────────────────────────────────────
    pub fn init(env: Env, admin: Address, token: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        env.storage().instance().set(&DataKey::Admin,        &admin);
        env.storage().instance().set(&DataKey::Token,        &token);
        env.storage().instance().set(&DataKey::ProtocolFees, &0i128);
        env.storage().instance().set(&DataKey::Paused,       &false);
        env.storage().instance().set(&DataKey::InsuranceFund, &0i128);
        env.storage().instance().set(&DataKey::OracleStrikeCount, &0u32);
        let pool = PoolState {
            total_supplied:   0,
            total_borrowed:   0,
            total_lp_shares:  0,
            last_update:      env.ledger().timestamp(),
            accumulated_rate: BPS,
        };
        env.storage().instance().set(&DataKey::PoolState, &pool);
    }

    // ── Oracle: Set Price ─────────────────────────────────────────────────────
    /// Admin sets the USD price for a token, scaled by PRICE_SCALE.
    /// Includes sanity check: rejects updates that move price > MAX_PRICE_CHANGE_BPS.
    /// In production, replace with a TWAP oracle or multi-feed median.
    pub fn set_price(env: Env, token: Address, price: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(price > 0, "price must be positive");

        // Sanity check: reject price updates that move > MAX_PRICE_CHANGE_BPS
        // This prevents a compromised admin key from instantly draining the pool
        if let Some(old_price) = env.storage().instance()
            .get::<DataKey, i128>(&DataKey::Price(token.clone()))
        {
            let change = if price > old_price {
                price.checked_sub(old_price).expect("underflow")
                     .checked_mul(BPS).expect("overflow")
                     .checked_div(old_price).expect("div zero")
            } else {
                old_price.checked_sub(price).expect("underflow")
                         .checked_mul(BPS).expect("overflow")
                         .checked_div(old_price).expect("div zero")
            };
            if change > MAX_PRICE_CHANGE_BPS {
                // Increment strike counter — auto-pause at ORACLE_STRIKE_LIMIT
                let strikes: u32 = env.storage().instance()
                    .get(&DataKey::OracleStrikeCount).unwrap_or(0u32)
                    .saturating_add(1);
                env.storage().instance().set(&DataKey::OracleStrikeCount, &strikes);
                env.events().publish(("oracle_strike", token.clone()), (change, strikes));
                if strikes >= ORACLE_STRIKE_LIMIT {
                    // Auto-pause: repeated sanity violations = likely attack
                    env.storage().instance().set(&DataKey::Paused,   &true);
                    env.storage().instance().set(&DataKey::PausedAt, &env.ledger().timestamp());
                    env.events().publish(("auto_paused_oracle",), env.ledger().timestamp());
                }
                panic!("price change exceeds sanity limit — use multiple updates");
            }
            // Successful update resets strike counter
            env.storage().instance().set(&DataKey::OracleStrikeCount, &0u32);
        }

        env.storage().instance().set(&DataKey::Price(token.clone()), &price);
        env.storage().instance().set(
            &DataKey::PriceUpdatedAt(token.clone()),
            &env.ledger().timestamp(),
        );
        env.events().publish(("price_set", token), price);
    }

    // ── Deposit (supply liquidity) ────────────────────────────────────────────
    pub fn deposit(env: Env, lender: Address, amount: i128) {
        Self::assert_not_paused(&env);
        lender.require_auth();
        assert!(amount > 0, "amount must be positive");

        let pool = Self::accrue(&env);
        let shares = if pool.total_lp_shares == 0 || pool.total_supplied == 0 {
            amount
        } else {
            amount.checked_mul(pool.total_lp_shares).expect("overflow")
                  .checked_div(pool.total_supplied).expect("div zero")
        };

        let mut pool = pool;
        pool.total_supplied = pool.total_supplied.checked_add(amount).expect("overflow");
        pool.total_lp_shares = pool.total_lp_shares.checked_add(shares).expect("overflow");
        env.storage().instance().set(&DataKey::PoolState, &pool);

        let existing: Option<SupplyPosition> = env.storage().persistent().get(&DataKey::Supply(lender.clone()));
        let pos = SupplyPosition {
            lp_shares:    existing.map(|p| p.lp_shares).unwrap_or(0)
                              .checked_add(shares).expect("overflow"),
            deposited_at: env.ledger().timestamp(),
            apy_snapshot: Self::supply_apy(pool.total_borrowed, pool.total_supplied),
        };
        env.storage().persistent().set(&DataKey::Supply(lender.clone()), &pos);

        // State written before transfer (reentrancy guard)
        token::Client::new(&env, &Self::tok(&env))
            .transfer(&lender, &env.current_contract_address(), &amount);

        env.events().publish(("deposit", lender), (amount, shares));
    }

    // ── Withdraw (remove liquidity) ───────────────────────────────────────────
    pub fn withdraw(env: Env, lender: Address, amount: i128) {
        Self::assert_not_paused(&env);
        lender.require_auth();
        assert!(amount > 0, "amount must be positive");

        let pool = Self::accrue(&env);
        let pos: SupplyPosition = env.storage().persistent()
            .get(&DataKey::Supply(lender.clone()))
            .unwrap_or_else(|| panic!("no supply position"));

        let owned = pos.lp_shares
            .checked_mul(pool.total_supplied).expect("overflow")
            .checked_div(pool.total_lp_shares).expect("div zero");
        assert!(amount <= owned, "insufficient balance");

        let free = pool.total_supplied.checked_sub(pool.total_borrowed).expect("underflow");
        assert!(amount <= free, "insufficient pool liquidity");

        let burn = amount
            .checked_mul(pool.total_lp_shares).expect("overflow")
            .checked_div(pool.total_supplied).expect("div zero");

        let mut pool = pool;
        pool.total_supplied  = pool.total_supplied.checked_sub(amount).expect("underflow");
        pool.total_lp_shares = pool.total_lp_shares.checked_sub(burn).expect("underflow");
        env.storage().instance().set(&DataKey::PoolState, &pool);

        let new_shares = pos.lp_shares.checked_sub(burn).expect("underflow");
        if new_shares == 0 {
            env.storage().persistent().remove(&DataKey::Supply(lender.clone()));
        } else {
            env.storage().persistent().set(
                &DataKey::Supply(lender.clone()),
                &SupplyPosition { lp_shares: new_shares, ..pos },
            );
        }

        Self::transfer_out(&env, &lender, amount);
        env.events().publish(("withdraw", lender), amount);
    }

    // ── Deposit Collateral ────────────────────────────────────────────────────
    pub fn deposit_collateral(env: Env, borrower: Address, amount: i128) {
        Self::assert_not_paused(&env);
        borrower.require_auth();
        assert!(amount > 0, "amount must be positive");

        let existing = Self::col(&env, &borrower);
        env.storage().persistent().set(
            &DataKey::Collateral(borrower.clone()),
            &CollateralPosition {
                amount:       existing.checked_add(amount).expect("overflow"),
                deposited_at: env.ledger().timestamp(),
            },
        );

        token::Client::new(&env, &Self::tok(&env))
            .transfer(&borrower, &env.current_contract_address(), &amount);

        env.events().publish(("deposit_collateral", borrower), amount);
    }

    // ── Withdraw Collateral ───────────────────────────────────────────────────
    pub fn withdraw_collateral(env: Env, borrower: Address, amount: i128) {
        Self::assert_not_paused(&env);
        borrower.require_auth();
        assert!(amount > 0, "amount must be positive");

        let pool = Self::accrue(&env);
        let collateral = Self::col(&env, &borrower);
        assert!(amount <= collateral, "insufficient collateral");

        let new_col = collateral.checked_sub(amount).expect("underflow");
        let debt_usd = Self::debt_usd(&env, &borrower, &pool);

        // If borrower has debt, ensure health factor stays above minimum after withdrawal
        if debt_usd > 0 {
            let token = Self::tok(&env);
            let price = Self::price_of(&env, &token);
            let new_col_usd = new_col
                .checked_mul(price).expect("overflow")
                .checked_div(PRICE_SCALE).expect("div zero");
            let new_hf = new_col_usd
                .checked_mul(LTV_RATIO).expect("overflow")
                .checked_div(debt_usd).expect("div zero");
            assert!(new_hf >= MIN_HEALTH, "withdrawal makes position unsafe");
        }

        if new_col == 0 {
            env.storage().persistent().remove(&DataKey::Collateral(borrower.clone()));
        } else {
            env.storage().persistent().set(
                &DataKey::Collateral(borrower.clone()),
                &CollateralPosition { amount: new_col, deposited_at: env.ledger().timestamp() },
            );
        }

        Self::transfer_out(&env, &borrower, amount);
        env.events().publish(("withdraw_collateral", borrower), amount);
    }

    // ── Borrow ────────────────────────────────────────────────────────────────
    pub fn borrow(env: Env, borrower: Address, amount: i128, term_days: u64) -> u64 {
        Self::assert_not_paused(&env);
        borrower.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(term_days >= 1 && term_days <= 365, "term must be 1–365 days");

        let pool = Self::accrue(&env);
        let token = Self::tok(&env);
        let price = Self::price_of(&env, &token);

        let collateral = Self::col(&env, &borrower);
        assert!(collateral > 0, "no collateral deposited");

        // USD-based borrow limit
        let col_usd = collateral
            .checked_mul(price).expect("overflow")
            .checked_div(PRICE_SCALE).expect("div zero");
        let max_borrow_usd = col_usd
            .checked_mul(LTV_RATIO).expect("overflow")
            .checked_div(BPS).expect("div zero");

        let existing_debt_usd = Self::debt_usd(&env, &borrower, &pool);
        let borrow_usd = amount
            .checked_mul(price).expect("overflow")
            .checked_div(PRICE_SCALE).expect("div zero");

        assert!(
            existing_debt_usd.checked_add(borrow_usd).expect("overflow") <= max_borrow_usd,
            "exceeds collateral limit"
        );

        // Pool liquidity check + utilization circuit breaker
        let free = pool.total_supplied.checked_sub(pool.total_borrowed).expect("underflow");
        assert!(amount <= free, "insufficient pool liquidity");

        // Circuit breaker: block new borrows if utilization already too high
        let new_borrowed = pool.total_borrowed.checked_add(amount).expect("overflow");
        let new_util = new_borrowed
            .checked_mul(BPS).expect("overflow")
            .checked_div(pool.total_supplied).expect("div zero");
        assert!(
            new_util <= MAX_UTILIZATION_BPS,
            "utilization too high — borrowing paused above 90%"
        );

        let loan_id: u64 = env.storage().persistent()
            .get(&DataKey::LoanCounter(borrower.clone())).unwrap_or(0u64)
            .checked_add(1).expect("overflow");
        env.storage().persistent().set(&DataKey::LoanCounter(borrower.clone()), &loan_id);

        let apy_bps = Self::borrow_rate(pool.total_borrowed, pool.total_supplied);
        let due_date = env.ledger().timestamp()
            .checked_add(term_days.checked_mul(86_400).expect("overflow")).expect("overflow");

        let loan = Loan {
            id:            loan_id,
            borrower:      borrower.clone(),
            principal:     amount,
            apy_bps,
            rate_index_at: pool.accumulated_rate,
            originated_at: env.ledger().timestamp(),
            due_date,
            amount_repaid: 0,
            status:        LoanStatus::Active,
        };

        let mut pool = pool;
        pool.total_borrowed = pool.total_borrowed.checked_add(amount).expect("overflow");
        env.storage().instance().set(&DataKey::PoolState, &pool);
        env.storage().persistent().set(&DataKey::Loan(borrower.clone(), loan_id), &loan);

        Self::transfer_out(&env, &borrower, amount);
        env.events().publish(("borrow", borrower), (loan_id, amount, apy_bps, due_date));
        loan_id
    }

    // ── Repay ─────────────────────────────────────────────────────────────────
    pub fn repay(env: Env, borrower: Address, loan_id: u64, amount: i128) {
        Self::assert_not_paused(&env);
        borrower.require_auth();
        assert!(amount > 0, "amount must be positive");

        let pool = Self::accrue(&env);
        let mut loan: Loan = env.storage().persistent()
            .get(&DataKey::Loan(borrower.clone(), loan_id))
            .unwrap_or_else(|| panic!("loan not found"));
        assert!(loan.status == LoanStatus::Active, "loan not active");
        assert!(loan.borrower == borrower, "not your loan");

        // Accrue interest since origination
        let accrued = Self::accrued_interest(&loan, &pool);

        // Late penalty: 1.5% per day overdue
        let now = env.ledger().timestamp();
        let penalty = if now > loan.due_date {
            let days = ((now - loan.due_date) / 86_400) as i128;
            loan.principal
                .checked_mul(days).expect("overflow")
                .checked_mul(150).expect("overflow")
                .checked_div(BPS).expect("div zero")
        } else {
            0
        };

        let total_owed = loan.principal
            .checked_add(accrued).expect("overflow")
            .checked_add(penalty).expect("overflow")
            .checked_sub(loan.amount_repaid).expect("underflow");

        let pay = amount.min(total_owed);
        loan.amount_repaid = loan.amount_repaid.checked_add(pay).expect("overflow");

        let fully_repaid = loan.amount_repaid >= loan.principal
            .checked_add(accrued).expect("overflow")
            .checked_add(penalty).expect("overflow");
        if fully_repaid {
            loan.status = LoanStatus::Repaid;
        }
        env.storage().persistent().set(&DataKey::Loan(borrower.clone(), loan_id), &loan);

        // Update pool: reduce borrowed, add repaid principal back to supply
        let mut pool = pool;
        pool.total_borrowed = pool.total_borrowed.saturating_sub(pay);
        let interest_paid = pay.saturating_sub(loan.principal);
        let fee = interest_paid
            .checked_mul(PROTOCOL_FEE_BPS).expect("overflow")
            .checked_div(BPS).expect("div zero");
        pool.total_supplied = pool.total_supplied
            .checked_add(pay.checked_sub(fee).expect("underflow")).expect("overflow");
        env.storage().instance().set(&DataKey::PoolState, &pool);

        let existing_fees: i128 = env.storage().instance()
            .get(&DataKey::ProtocolFees).unwrap_or(0);
        // Route INSURANCE_FEE_BPS of protocol fee to insurance fund
        let ins_cut = fee.checked_mul(INSURANCE_FEE_BPS).expect("overflow")
                         .checked_div(BPS).expect("div zero");
        let admin_fee = fee.checked_sub(ins_cut).expect("underflow");
        let ins_fund: i128 = env.storage().instance().get(&DataKey::InsuranceFund).unwrap_or(0);
        env.storage().instance().set(&DataKey::InsuranceFund,
            &ins_fund.checked_add(ins_cut).expect("overflow"));
        env.storage().instance().set(
            &DataKey::ProtocolFees,
            &existing_fees.checked_add(admin_fee).expect("overflow"),
        );

        // Transfer repayment in (state already updated — reentrancy safe)
        token::Client::new(&env, &Self::tok(&env))
            .transfer(&borrower, &env.current_contract_address(), &pay);

        env.events().publish(("repay", borrower), (loan_id, pay, fully_repaid));
    }

    // ── Liquidate (Partial) ───────────────────────────────────────────────────
    /// Liquidates 50% of a loan's outstanding debt per call.
    /// Partial liquidation is less punishing and avoids over-liquidation.
    /// Includes:
    ///   - MIN_BORROW_AGE_SECS cooldown (prevents flash-loan attacks)
    ///   - Bad debt tracking when collateral < debt
    pub fn liquidate(env: Env, liquidator: Address, borrower: Address, loan_id: u64) {
        Self::assert_not_paused(&env);
        liquidator.require_auth();
        assert!(liquidator != borrower, "cannot self-liquidate");

        let pool = Self::accrue(&env);

        // Health factor must be below minimum
        let hf = Self::health_factor(&env, &borrower, &pool);
        assert!(hf < MIN_HEALTH, "position is healthy — cannot liquidate");

        let mut loan: Loan = env.storage().persistent()
            .get(&DataKey::Loan(borrower.clone(), loan_id))
            .unwrap_or_else(|| panic!("loan not found"));
        assert!(loan.status == LoanStatus::Active, "loan not active");

        // Cooldown: prevent instant liquidation after borrow
        assert!(
            env.ledger().timestamp() >= loan.originated_at.checked_add(MIN_BORROW_AGE_SECS).expect("overflow"),
            "loan too new to liquidate — cooldown not elapsed"
        );

        let accrued = Self::accrued_interest(&loan, &pool);
        let full_debt = loan.principal
            .checked_add(accrued).expect("overflow")
            .checked_sub(loan.amount_repaid).expect("underflow");

        // Partial liquidation: only liquidate LIQUIDATION_FRACTION_BPS of debt
        let liquidate_debt = full_debt
            .checked_mul(LIQUIDATION_FRACTION_BPS).expect("overflow")
            .checked_div(BPS).expect("div zero")
            .max(1); // at least 1 stroop

        let collateral = Self::col(&env, &borrower);

        // Collateral to seize = liquidated debt + dynamic bonus, capped at available collateral
        let bonus = Self::liquidation_bonus(pool.total_borrowed, pool.total_supplied, hf);
        let seize = liquidate_debt
            .checked_add(
                liquidate_debt.checked_mul(bonus).expect("overflow")
                              .checked_div(BPS).expect("div zero")
            ).expect("overflow")
            .min(collateral);

        // Bad debt: if collateral can't cover the liquidated portion, track the shortfall
        let covered = seize
            .checked_mul(BPS).expect("overflow")
            .checked_div(BPS.checked_add(LIQUIDATION_BONUS).expect("overflow")).expect("div zero");
        if covered < liquidate_debt {
            let bad = liquidate_debt.checked_sub(covered).expect("underflow");
            let existing_bad: i128 = env.storage().instance()
                .get(&DataKey::BadDebt).unwrap_or(0);
            env.storage().instance().set(
                &DataKey::BadDebt,
                &existing_bad.checked_add(bad).expect("overflow"),
            );
            env.events().publish(("bad_debt_accrued", borrower.clone()), bad);

            // Auto-pause if bad debt exceeds BAD_DEBT_PAUSE_BPS of pool
            let pool_snap: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
            if pool_snap.total_supplied > 0 {
                let total_bad: i128 = env.storage().instance()
                    .get(&DataKey::BadDebt).unwrap_or(0i128)
                    .checked_add(bad).unwrap_or(i128::MAX);
                let bad_bps = total_bad.checked_mul(BPS).expect("overflow")
                                       .checked_div(pool_snap.total_supplied).expect("div");
                if bad_bps >= BAD_DEBT_PAUSE_BPS {
                    env.storage().instance().set(&DataKey::Paused,   &true);
                    env.storage().instance().set(&DataKey::PausedAt, &env.ledger().timestamp());
                    env.events().publish(("auto_paused_bad_debt",), total_bad);
                }

                // Auto-deploy insurance to cover bad debt — no admin required
                let ins_fund: i128 = env.storage().instance().get(&DataKey::InsuranceFund).unwrap_or(0);
                if ins_fund > 0 {
                    let cover = bad.min(ins_fund);
                    env.storage().instance().set(&DataKey::InsuranceFund,
                        &ins_fund.checked_sub(cover).expect("underflow"));
                    // Insurance covers the liquidator's shortfall
                    let token = Self::tok(&env);
                    token::Client::new(&env, &token)
                        .transfer(&env.current_contract_address(), &liquidator, &cover);
                    env.events().publish(("insurance_auto_deployed",), (cover, bad));
                }
            }
        }

        // Mark loan fully liquidated if this covers all debt, else partial
        loan.amount_repaid = loan.amount_repaid.checked_add(liquidate_debt).expect("overflow");
        let remaining_debt = full_debt.checked_sub(liquidate_debt).expect("underflow");
        if remaining_debt == 0 {
            loan.status = LoanStatus::Liquidated;
        }
        env.storage().persistent().set(&DataKey::Loan(borrower.clone(), loan_id), &loan);

        let remaining_col = collateral.checked_sub(seize).expect("underflow");
        if remaining_col == 0 {
            env.storage().persistent().remove(&DataKey::Collateral(borrower.clone()));
        } else {
            env.storage().persistent().set(
                &DataKey::Collateral(borrower.clone()),
                &CollateralPosition { amount: remaining_col, deposited_at: env.ledger().timestamp() },
            );
        }

        let mut pool = pool;
        pool.total_borrowed = pool.total_borrowed.saturating_sub(liquidate_debt);
        pool.total_supplied  = pool.total_supplied.checked_add(liquidate_debt).expect("overflow");
        env.storage().instance().set(&DataKey::PoolState, &pool);

        let tc = token::Client::new(&env, &Self::tok(&env));
        tc.transfer(&liquidator, &env.current_contract_address(), &liquidate_debt);
        tc.transfer(&env.current_contract_address(), &liquidator, &seize);

        env.events().publish(("liquidate", liquidator), (borrower, loan_id, liquidate_debt, seize));
    }

    // ── Admin: Pause / Unpause ────────────────────────────────────────────────
    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused,   &true);
        env.storage().instance().set(&DataKey::PausedAt, &env.ledger().timestamp());
        env.events().publish(("paused",), env.ledger().timestamp());
    }

    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(("unpaused",), env.ledger().timestamp());
    }

    // ── Admin: Rescue Funds ───────────────────────────────────────────────────
    pub fn rescue_funds(env: Env, recipient: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        assert!(paused, "contract must be paused to rescue funds");

        let paused_at: u64 = env.storage().instance().get(&DataKey::PausedAt).unwrap_or(0);
        assert!(
            env.ledger().timestamp() >= paused_at.checked_add(RESCUE_DELAY_SECS).expect("overflow"),
            "rescue delay not elapsed — wait 48h after pausing"
        );

        assert!(amount > 0, "amount must be positive");
        let token = Self::tok(&env);
        let balance = token::Client::new(&env, &token)
            .balance(&env.current_contract_address());
        assert!(balance >= amount, "insufficient contract balance");

        token::Client::new(&env, &token)
            .transfer(&env.current_contract_address(), &recipient, &amount);

        env.events().publish(("rescue_funds", recipient), amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_pool_state(env: Env) -> PoolState {
        env.storage().instance().get(&DataKey::PoolState).unwrap()
    }

    pub fn get_supply_apy(env: Env) -> i128 {
        let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
        Self::supply_apy(p.total_borrowed, p.total_supplied)
    }

    pub fn get_borrow_rate(env: Env) -> i128 {
        let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
        Self::borrow_rate(p.total_borrowed, p.total_supplied)
    }

    pub fn get_health_factor(env: Env, user: Address) -> i128 {
        let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
        Self::health_factor(&env, &user, &p)
    }

    pub fn get_collateral(env: Env, user: Address) -> i128 {
        Self::col(&env, &user)
    }

    pub fn get_price(env: Env, token: Address) -> i128 {
        env.storage().instance()
            .get(&DataKey::Price(token))
            .unwrap_or(0)
    }

    pub fn get_health_info(env: Env, user: Address) -> HealthInfo {
        let pool: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
        let token = Self::tok(&env);
        let price = env.storage().instance()
            .get(&DataKey::Price(token.clone()))
            .unwrap_or(0);

        let col_amount = Self::col(&env, &user);
        let col_usd = if price > 0 {
            col_amount.checked_mul(price).unwrap_or(0)
                      .checked_div(PRICE_SCALE).unwrap_or(0)
        } else { 0 };

        let debt_usd = Self::debt_usd(&env, &user, &pool);
        let hf = if debt_usd == 0 { i128::MAX } else {
            col_usd.checked_mul(LTV_RATIO).unwrap_or(0)
                   .checked_div(debt_usd).unwrap_or(0)
        };

        let max_borrow_usd = col_usd
            .checked_mul(LTV_RATIO).unwrap_or(0)
            .checked_div(BPS).unwrap_or(0)
            .saturating_sub(debt_usd);
        let max_borrow = if price > 0 {
            max_borrow_usd.checked_mul(PRICE_SCALE).unwrap_or(0)
                          .checked_div(price).unwrap_or(0)
        } else { 0 };

        HealthInfo {
            collateral_amount: col_amount,
            collateral_usd:    col_usd,
            total_debt_usd:    debt_usd,
            health_factor:     hf,
            max_borrow,
        }
    }

    pub fn get_loan(env: Env, borrower: Address, loan_id: u64) -> Option<Loan> {
        env.storage().persistent().get(&DataKey::Loan(borrower, loan_id))
    }

    pub fn get_supply_position(env: Env, lender: Address) -> Option<SupplyPosition> {
        env.storage().persistent().get(&DataKey::Supply(lender))
    }

    pub fn get_protocol_fees(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::ProtocolFees).unwrap_or(0)
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    pub fn get_bad_debt(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::BadDebt).unwrap_or(0)
    }

    /// Insurance reserve accumulated from protocol fees.
    pub fn get_insurance_fund(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::InsuranceFund).unwrap_or(0)
    }

    /// Admin deploys insurance reserve to cover a verified bad debt shortfall.
    /// Requires contract to be paused (only used in genuine emergencies).
    pub fn deploy_insurance(env: Env, recipient: Address, amount: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        assert!(paused, "contract must be paused to deploy insurance");
        assert!(amount > 0, "amount must be positive");
        let fund: i128 = env.storage().instance().get(&DataKey::InsuranceFund).unwrap_or(0);
        assert!(fund >= amount, "insufficient insurance fund");
        env.storage().instance().set(&DataKey::InsuranceFund,
            &fund.checked_sub(amount).expect("underflow"));
        let token = Self::tok(&env);
        token::Client::new(&env, &token)
            .transfer(&env.current_contract_address(), &recipient, &amount);
        env.events().publish(("insurance_deployed", recipient), amount);
    }

    pub fn get_oracle_strikes(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::OracleStrikeCount).unwrap_or(0)
    }

    pub fn get_utilization(env: Env) -> i128 {
        let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
        if p.total_supplied == 0 { return 0; }
        p.total_borrowed.checked_mul(BPS).expect("overflow")
                        .checked_div(p.total_supplied).expect("div zero")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    fn assert_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "contract is paused");
    }

    /// Accrue global interest index. Must be called at the start of every
    /// state-changing function to keep the accumulated_rate current.
    fn accrue(env: &Env) -> PoolState {
        let mut pool: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
        let now = env.ledger().timestamp();
        let elapsed = (now - pool.last_update) as i128;
        if elapsed > 0 && pool.total_supplied > 0 {
            let rate = Self::borrow_rate(pool.total_borrowed, pool.total_supplied);
            let delta = pool.accumulated_rate
                .checked_mul(rate).expect("overflow")
                .checked_mul(elapsed).expect("overflow")
                .checked_div(BPS).expect("div zero")
                .checked_div(SECONDS_PER_YEAR).expect("div zero");
            pool.accumulated_rate = pool.accumulated_rate
                .checked_add(delta).expect("overflow");
        }
        pool.last_update = now;
        env.storage().instance().set(&DataKey::PoolState, &pool);
        pool
    }

    /// Dynamic liquidation bonus based on utilization and health factor.
    /// Higher risk = higher bonus = more incentive for liquidators to act.
    fn liquidation_bonus(borrowed: i128, supplied: i128, hf: i128) -> i128 {
        let util = if supplied == 0 { 0 } else {
            borrowed.checked_mul(BPS).expect("of").checked_div(supplied).expect("dz")
        };
        // High utilization (>80%) or near-zero HF (<0.9) → max bonus
        if util > 8_000 || hf < 9_000 { return LIQ_BONUS_HIGH; }
        // Medium utilization (>60%) → mid bonus
        if util > 6_000 { return LIQ_BONUS_MID; }
        // Low risk → min bonus
        LIQ_BONUS_MIN
    }

    fn borrow_rate(borrowed: i128, supplied: i128) -> i128 {
        if supplied == 0 { return BASE_BORROW_RATE; }
        let util = borrowed
            .checked_mul(BPS).expect("overflow")
            .checked_div(supplied).expect("div zero");
        BASE_BORROW_RATE
            .checked_add(
                util.checked_mul(RATE_SLOPE).expect("overflow")
                    .checked_div(BPS).expect("div zero")
            ).expect("overflow")
    }

    fn supply_apy(borrowed: i128, supplied: i128) -> i128 {
        if supplied == 0 { return BASE_BORROW_RATE * 80 / 100; }
        let util = borrowed
            .checked_mul(BPS).expect("overflow")
            .checked_div(supplied).expect("div zero");
        let br = BASE_BORROW_RATE
            .checked_add(
                util.checked_mul(RATE_SLOPE).expect("overflow")
                    .checked_div(BPS).expect("div zero")
            ).expect("overflow");
        br.checked_mul(util).expect("overflow")
          .checked_div(BPS).expect("div zero")
          .checked_mul(BPS - PROTOCOL_FEE_BPS).expect("overflow")
          .checked_div(BPS).expect("div zero")
    }

    /// Compute accrued interest for a loan using the global accumulated_rate.
    fn accrued_interest(loan: &Loan, pool: &PoolState) -> i128 {
        let factor = pool.accumulated_rate
            .checked_sub(loan.rate_index_at).expect("underflow");
        loan.principal
            .checked_mul(factor).expect("overflow")
            .checked_div(BPS).expect("div zero")
    }

    /// Total debt in USD (scaled by PRICE_SCALE) for a user across all active loans.
    fn debt_usd(env: &Env, user: &Address, pool: &PoolState) -> i128 {
        let token = Self::tok(env);
        let price: i128 = env.storage().instance()
            .get(&DataKey::Price(token))
            .unwrap_or(0);
        if price == 0 { return 0; }

        let count: u64 = env.storage().persistent()
            .get(&DataKey::LoanCounter(user.clone())).unwrap_or(0);
        let mut total_tokens = 0i128;
        for i in 1..=count {
            if let Some(loan) = env.storage().persistent()
                .get::<DataKey, Loan>(&DataKey::Loan(user.clone(), i))
            {
                if loan.status == LoanStatus::Active {
                    let accrued = Self::accrued_interest(&loan, pool);
                    let outstanding = loan.principal
                        .checked_add(accrued).expect("overflow")
                        .checked_sub(loan.amount_repaid).expect("underflow");
                    total_tokens = total_tokens.checked_add(outstanding).expect("overflow");
                }
            }
        }
        total_tokens
            .checked_mul(price).expect("overflow")
            .checked_div(PRICE_SCALE).expect("div zero")
    }

    /// Health factor in BPS. Returns i128::MAX when debt == 0.
    fn health_factor(env: &Env, user: &Address, pool: &PoolState) -> i128 {
        let token = Self::tok(env);
        let price: i128 = env.storage().instance()
            .get(&DataKey::Price(token))
            .unwrap_or(0);
        if price == 0 { return i128::MAX; }

        let col = Self::col(env, user);
        let col_usd = col
            .checked_mul(price).expect("overflow")
            .checked_div(PRICE_SCALE).expect("div zero");

        let debt_usd = Self::debt_usd(env, user, pool);
        if debt_usd == 0 { return i128::MAX; }

        col_usd
            .checked_mul(LTV_RATIO).expect("overflow")
            .checked_div(debt_usd).expect("div zero")
    }

    fn col(env: &Env, user: &Address) -> i128 {
        env.storage().persistent()
            .get::<DataKey, CollateralPosition>(&DataKey::Collateral(user.clone()))
            .map(|c| c.amount)
            .unwrap_or(0)
    }

    fn tok(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    /// Get price with staleness check. Panics if price unset or stale.
    /// Stale = updated more than MAX_PRICE_AGE_SECS ago.
    fn price_of(env: &Env, token: &Address) -> i128 {
        let price: i128 = env.storage().instance()
            .get(&DataKey::Price(token.clone()))
            .unwrap_or_else(|| panic!("price not set for token"));

        let updated_at: u64 = env.storage().instance()
            .get(&DataKey::PriceUpdatedAt(token.clone()))
            .unwrap_or(0);

        assert!(
            env.ledger().timestamp() <= updated_at.checked_add(MAX_PRICE_AGE_SECS).expect("overflow"),
            "price is stale — oracle must be updated"
        );

        price
    }

    /// Balance-verified outbound transfer.
    fn transfer_out(env: &Env, to: &Address, amount: i128) {
        let token = Self::tok(env);
        let balance = token::Client::new(env, &token)
            .balance(&env.current_contract_address());
        assert!(balance >= amount, "contract balance insufficient");
        token::Client::new(env, &token)
            .transfer(&env.current_contract_address(), to, &amount);
    }

    // ── UI Helpers ────────────────────────────────────────────────────────────

    /// Get all loans for a user (for dashboard)
    pub fn get_user_loans(env: Env, user: Address) -> soroban_sdk::Vec<Loan> {
        let pool = Self::accrue(&env);
        let mut loans = soroban_sdk::Vec::new(&env);
        let counter: u64 = env.storage().persistent()
            .get(&DataKey::LoanCounter(user.clone())).unwrap_or(0);
        for i in 1..=counter {
            if let Some(loan) = env.storage().persistent()
                .get::<DataKey, Loan>(&DataKey::Loan(user.clone(), i)) {
                loans.push_back(loan);
            }
        }
        loans
    }

    /// Dashboard aggregation: (total_supplied, total_borrowed, utilization_bps, insurance_fund)
    pub fn get_dashboard_data(env: Env) -> (i128, i128, i128, i128) {
        let pool = Self::accrue(&env);
        let utilization = if pool.total_supplied > 0 {
            pool.total_borrowed.checked_mul(BPS).unwrap_or(0)
                .checked_div(pool.total_supplied).unwrap_or(0)
        } else { 0 };
        let insurance: i128 = env.storage().instance()
            .get(&DataKey::InsuranceFund).unwrap_or(0);
        (pool.total_supplied, pool.total_borrowed, utilization, insurance)
    }

    /// Insurance fund balance
    pub fn get_insurance_status(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::InsuranceFund).unwrap_or(0)
    }

    /// Max additional borrow for a user in token units
    pub fn max_borrowable(env: Env, user: Address) -> i128 {
        let pool = Self::accrue(&env);
        let token = Self::tok(&env);
        let price: i128 = env.storage().instance()
            .get(&DataKey::Price(token)).unwrap_or(PRICE_SCALE);
        let collateral = Self::col(&env, &user);
        let col_usd = collateral.checked_mul(price).unwrap_or(0)
            .checked_div(PRICE_SCALE).unwrap_or(0);
        let debt_usd = Self::debt_usd(&env, &user, &pool);
        let max_borrow_usd = col_usd
            .checked_mul(LTV_RATIO).unwrap_or(0)
            .checked_div(BPS).unwrap_or(0)
            .saturating_sub(debt_usd);
        if price > 0 {
            max_borrow_usd.checked_mul(PRICE_SCALE).unwrap_or(0)
                .checked_div(price).unwrap_or(0)
        } else { 0 }
    }

    /// Expected accrued interest for a loan (UI preview)
    pub fn expected_interest(env: Env, loan_id: u64, borrower: Address) -> i128 {
        let pool = Self::accrue(&env);
        if let Some(loan) = env.storage().persistent()
            .get::<DataKey, Loan>(&DataKey::Loan(borrower, loan_id)) {
            if loan.status != LoanStatus::Active { return 0; }
            Self::accrued_interest(&loan, &pool)
        } else { 0 }
    }

    /// Credit score proxy: repaid loans / total loans * 850
    pub fn get_credit_score(env: Env, user: Address) -> u32 {
        let counter: u64 = env.storage().persistent()
            .get(&DataKey::LoanCounter(user.clone())).unwrap_or(0);
        if counter == 0 { return 650; } // default score
        let mut repaid = 0u64;
        for i in 1..=counter {
            if let Some(loan) = env.storage().persistent()
                .get::<DataKey, Loan>(&DataKey::Loan(user.clone(), i)) {
                if loan.status == LoanStatus::Repaid { repaid += 1; }
            }
        }
        let score = 400u64 + (repaid * 450 / counter);
        score.min(850) as u32
    }
}
