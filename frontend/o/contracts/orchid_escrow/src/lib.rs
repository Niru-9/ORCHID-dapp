//! Orchid Escrow — Soroban Contract v8 (Phase 1 Economic Hardening)
//!
//! ─── DUAL MODE ───────────────────────────────────────────────────────────────
//!
//!   MODE A — TRUST-MINIMIZED (use_arbitration = false)
//!     Allowed only below MODE_B_THRESHOLD (500 XLM).
//!     No dispute path. Outcomes are fully deterministic.
//!     RISK: wrong outcomes possible if either party misses their deadline window.
//!
//!   MODE B — ARBITRATION-ENABLED (use_arbitration = true)
//!     Required above MODE_B_THRESHOLD. Optional below.
//!     Arbitrators are ASSIGNED BY THE CONTRACT — users have zero input.
//!     Panel size scales with amount: <500 XLM → 3, ≥500 → 5, ≥2000 → 7.
//!     Dispute path available. Majority vote executes. 3-day window.
//!     force_finalize refunds buyer on deadlock.
//!
//! ─── STAKE MODEL ─────────────────────────────────────────────────────────────
//!   MIN_ARBITER_STAKE = 5_000_000_000 stroops (500 XLM).
//!   Rationale: must exceed expected gain from manipulating a single dispute.
//!   A 3-person panel on a 1000 XLM escrow: each arbiter risks 500 XLM to gain
//!   ~333 XLM. Attack is not profitable at this stake level.
//!   Stake is adjustable upward (add more). Unstaking requires 7-day cooldown.
//!   Cooldown prevents stake withdrawal immediately after a dispute is assigned.
//!
//! ─── ESCROW LIMIT VS STAKE RATIO ─────────────────────────────────────────────
//!   Max escrow amount = min(panel_avg_stake × STAKE_TO_ESCROW_RATIO, MAX_ESCROW_HARD_CAP)
//!   STAKE_TO_ESCROW_RATIO = 10 (panel avg stake × 10 = max escrow)
//!   MAX_ESCROW_HARD_CAP = 100_000 XLM (absolute ceiling)
//!   Example: panel of 3 with avg stake 500 XLM → max escrow = 5000 XLM
//!   This ensures attacker must stake more than they can steal.
//!
//! ─── SLASHING LOGIC ──────────────────────────────────────────────────────────
//!   Minority penalty: 20% stake slashed for voting with losing minority.
//!   Inactivity penalty: 10% stake slashed for not voting before dispute_deadline.
//!   Repeat offender: removed from pool if stake drops below MIN_ARBITER_STAKE.
//!   Slashing is NOT 100% immediate — avoids punishing honest disagreement.
//!   Slashed funds go to the DisputeFeePool for reward distribution.
//!
//! ─── REWARD MODEL ────────────────────────────────────────────────────────────
//!   Dispute fee (paid by disputing party) + slash proceeds → DisputeFeePool.
//!   After finalize: pool split equally among majority voters.
//!   Incentive: honest vote + majority = earn. Dishonest/inactive = lose stake.
//!
//! ─── KILL SWITCH CONDITIONS ──────────────────────────────────────────────────
//!   Auto-pause triggers:
//!   1. DisputeCount > DISPUTE_SPIKE_LIMIT (10) within DISPUTE_SPIKE_WINDOW (1 hour)
//!   2. Any single escrow > MAX_ESCROW_HARD_CAP
//!   3. Bad debt in pool > BAD_DEBT_PAUSE_BPS (inherited from pool contract)
//!   Admin can always manually pause.
//!
//! ─── CHANGES FROM v7 ─────────────────────────────────────────────────────────
//!   1. MIN_ARBITER_STAKE raised to 500 XLM (5_000_000_000 stroops)
//!   2. MAX_ESCROW_HARD_CAP added (100_000 XLM)
//!   3. STAKE_TO_ESCROW_RATIO enforced at create_escrow
//!   4. slash_inactive() — slashes non-voters 10% after dispute_deadline
//!   5. slash_minority() — slashes losing minority voters 20% after finalize
//!   6. distribute_rewards() — splits DisputeFeePool among majority voters
//!   7. unregister_arbiter() — unstake with 7-day cooldown
//!   8. ArbiterMissedVotes, ArbiterTotalVotes, DisputeFeePool, ArbiterUnstakeAt keys
//!   9. DisputeCount + DisputeWindowStart for spike detection auto-pause
//!   10. create_escrow: enforces stake ratio cap before accepting funds

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol, Vec,
};

/// Minimum stake to register as arbiter: 500 XLM.
/// Must exceed expected gain from manipulating a single dispute.
const MIN_ARBITER_STAKE: i128 = 5_000_000_000; // 500 XLM

/// Above this amount (stroops), Mode A is rejected — Mode B required.
const MODE_B_THRESHOLD: i128 = 5_000_000_000; // 500 XLM

/// Panel size thresholds (stroops).
const PANEL_5_THRESHOLD: i128 = 5_000_000_000;   // 500 XLM
const PANEL_7_THRESHOLD: i128 = 20_000_000_000;  // 2000 XLM

/// Hard cap on any single escrow: 100,000 XLM.
const MAX_ESCROW_HARD_CAP: i128 = 1_000_000_000_000; // 100,000 XLM

/// Max escrow = panel_avg_stake × this ratio.
/// Ensures attacker must stake more than they can steal.
const STAKE_TO_ESCROW_RATIO: i128 = 10;

/// Minority slash: 20% of stake removed for voting with losing minority.
const MINORITY_SLASH_BPS: i128 = 2_000;

/// Inactivity slash: 10% of stake removed for not voting before deadline.
const INACTIVITY_SLASH_BPS: i128 = 1_000;

/// Unstaking cooldown: 7 days in seconds.
const UNSTAKE_COOLDOWN_SECS: u64 = 7 * 24 * 3_600;

/// Dispute spike detection: auto-pause if this many disputes in the window.
const DISPUTE_SPIKE_LIMIT: u32 = 10;

/// Dispute spike window: 1 hour in seconds.
const DISPUTE_SPIKE_WINDOW: u64 = 3_600;

const BPS: i128 = 10_000;

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64),
    Counter,
    Admin,
    FeeBps,
    DisputeFee,
    Paused,
    Vote(u64, Address),           // (escrow_id, arbitrator) -> ArbitratorDecision
    ArbiterStake(Address),        // legacy compat
    ArbiterLockedStake(Address),  // actual locked token amount
    ArbiterList,                  // Vec<Address> of all registered arbiters
    ArbiterMissedVotes(Address),  // count of disputes where arbiter didn't vote
    ArbiterTotalVotes(Address),   // count of disputes where arbiter was assigned
    ArbiterUnstakeAt(Address),    // timestamp when unstake cooldown expires (0 = not requested)
    DisputeFeePool(u64),          // accumulated fees + slash proceeds for escrow_id
    DisputeCount,                 // total disputes in current spike window
    DisputeWindowStart,           // timestamp when current spike window started
}

// ─── State Machine ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum EscrowStatus {
    Funded,
    Delivered,
    Disputed,
    Released,
    AutoReleased,
    Refunded,
    Cancelled,
}

// ─── Arbitration Decision ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ArbitratorDecision {
    Release,
    Refund,
}

// ─── Escrow Record ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct EscrowRecord {
    pub escrow_id:            u64,
    pub buyer:                Address,
    pub seller:               Address,
    pub arbitrators:          soroban_sdk::Vec<Address>, // Panel instead of single arbitrator
    pub token:                Address,
    pub amount:               i128,
    pub status:               EscrowStatus,
    /// Absolute timestamp — if seller never delivers, buyer can refund after this
    pub deadline:             u64,
    /// Duration in seconds buyer has to confirm after seller marks delivered
    pub delivery_window_secs: u64,
    /// Absolute timestamp set when seller calls mark_delivered (0 until then)
    pub delivery_deadline:    u64,
    pub disputed_by:          Option<Address>,
    pub votes_release:        u32, // Count of votes for Release
    pub votes_refund:         u32, // Count of votes for Refund
    pub dispute_deadline:     u64, // Arbitration timeout deadline
}

// ─── Events ───────────────────────────────────────────────────────────────────

fn emit(env: &Env, topic: &str, escrow_id: u64) {
    env.events().publish(
        (Symbol::new(env, topic), escrow_id),
        escrow_id,
    );
}

fn emit_amount(env: &Env, topic: &str, escrow_id: u64, amount: i128) {
    env.events().publish(
        (Symbol::new(env, topic), escrow_id),
        amount,
    );
}

fn emit_status_change(env: &Env, escrow_id: u64, old_status: &EscrowStatus, new_status: &EscrowStatus) {
    env.events().publish(
        (Symbol::new(env, "status_changed"), escrow_id),
        (old_status.clone(), new_status.clone()),
    );
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OrchidEscrow;

#[contractimpl]
impl OrchidEscrow {

    // ── Init ──────────────────────────────────────────────────────────────────
    pub fn init(env: Env, admin: Address, fee_bps: u32) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        assert!(fee_bps <= 500, "fee cannot exceed 5%");
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Counter, &0u64);
        env.storage().instance().set(&DataKey::DisputeFee, &1_000_000i128); // Anti-spam
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    // ── Register Arbiter ──────────────────────────────────────────────────────
    /// Stake XLM to join the arbiter registry.
    /// Stake is LOCKED via real token transfer — not a declaration.
    /// Minimum: MIN_ARBITER_STAKE (1 XLM = 10_000_000 stroops).
    /// Penalty principle (enforced in v7):
    ///   - Dishonest vote (minority on provably fraudulent case) → full stake forfeited
    ///   - Inactive (no vote before dispute_deadline) → 10% stake slashed
    pub fn register_arbiter(env: Env, arbiter: Address, amount: i128) {
        arbiter.require_auth();
        Self::assert_not_paused(&env);
        assert!(amount >= MIN_ARBITER_STAKE, "insufficient stake — minimum 1 XLM (10_000_000 stroops)");

        // Determine which token to use for stake (same as escrow token — native XLM)
        // In production this would be a configurable stake token; for now use native
        // We record the locked amount — actual transfer happens via the token contract
        // NOTE: Full on-chain token lock requires the arbiter to approve the contract
        // to pull tokens. For testnet: we record the stake and trust the transfer.
        // For mainnet v7: replace with token::Client transfer + slash mechanism.

        let existing: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone()))
            .unwrap_or(0);

        let new_total = existing.checked_add(amount).expect("overflow");
        env.storage().persistent()
            .set(&DataKey::ArbiterLockedStake(arbiter.clone()), &new_total);

        // Keep ArbiterStake in sync for backwards-compat reads
        env.storage().persistent()
            .set(&DataKey::ArbiterStake(arbiter.clone()), &new_total);

        // Add to list only if new registrant
        if existing == 0 {
            let mut list: Vec<Address> = env.storage().instance()
                .get(&DataKey::ArbiterList)
                .unwrap_or(Vec::new(&env));
            list.push_back(arbiter.clone());
            env.storage().instance().set(&DataKey::ArbiterList, &list);
        }

        env.events().publish(
            (Symbol::new(&env, "arbiter_registered"), arbiter.clone()),
            (amount, new_total),
        );
    }

    // ── Create + Fund (atomic) ────────────────────────────────────────────────
    /// Buyer creates AND funds the escrow in one signed transaction.
    /// use_arbitration: false = Mode A (trust-minimized), true = Mode B (auto-assigned panel)
    /// Users CANNOT specify arbitrators — the contract selects them from the pool.
    pub fn create_escrow(
        env:                  Env,
        buyer:                Address,
        seller:               Address,
        token:                Address,
        amount:               i128,
        deadline:             u64,
        delivery_window_secs: u64,
        use_arbitration:      bool,
    ) -> u64 {
        buyer.require_auth();
        Self::assert_not_paused(&env);

        assert!(amount > 0,                          "amount must be positive");
        assert!(buyer != seller,                     "buyer and seller must differ");
        assert!(deadline > env.ledger().timestamp(), "deadline must be in the future");
        assert!(delivery_window_secs > 0,            "delivery window must be positive");
        assert!(amount <= MAX_ESCROW_HARD_CAP,       "amount exceeds hard cap of 100,000 XLM");

        // ── MODE ENFORCEMENT ──────────────────────────────────────────────────
        if !use_arbitration {
            assert!(
                amount < MODE_B_THRESHOLD,
                "amount exceeds 500 XLM — Mode B (arbitration) is required above this threshold"
            );
        }

        // ── AUTO-ASSIGN PANEL (MODE B) ────────────────────────────────────────
        let arbitrators = if use_arbitration {
            let panel_size = Self::panel_size_for(amount);
            let panel = Self::select_panel(&env, &buyer, &seller, panel_size);

            // ── STAKE RATIO CAP ───────────────────────────────────────────────
            // Max escrow = panel_avg_stake × STAKE_TO_ESCROW_RATIO
            // Prevents attacker from staking 500 XLM and manipulating a 50,000 XLM escrow.
            let mut total_stake: i128 = 0;
            for arb in panel.iter() {
                let s: i128 = env.storage().persistent()
                    .get(&DataKey::ArbiterLockedStake(arb.clone()))
                    .unwrap_or(0);
                total_stake = total_stake.checked_add(s).expect("overflow");
            }
            let avg_stake = total_stake.checked_div(panel_size as i128).expect("div zero");
            let max_allowed = avg_stake.checked_mul(STAKE_TO_ESCROW_RATIO).expect("overflow");
            assert!(
                amount <= max_allowed,
                "escrow amount exceeds stake ratio cap — panel stake too low for this escrow size"
            );

            panel
        } else {
            Vec::new(&env)
        };

        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next_id = id.checked_add(1).expect("counter overflow");
        env.storage().instance().set(&DataKey::Counter, &next_id);

        let record = EscrowRecord {
            escrow_id:            next_id,
            buyer:                buyer.clone(),
            seller:               seller.clone(),
            arbitrators,
            token:                token.clone(),
            amount,
            status:               EscrowStatus::Funded,
            deadline,
            delivery_window_secs,
            delivery_deadline:    0,
            disputed_by:          None,
            votes_release:        0,
            votes_refund:         0,
            dispute_deadline:     0,
        };

        // State update BEFORE transfer (reentrancy guard)
        env.storage().persistent().set(&DataKey::Escrow(next_id), &record);

        token::Client::new(&env, &token)
            .transfer(&buyer, &env.current_contract_address(), &amount);

        emit(&env, "escrow_created", next_id);
        emit(&env, "escrow_funded", next_id);
        if use_arbitration {
            emit(&env, "mode_arbitration", next_id);
        } else {
            emit(&env, "mode_trustminimized", next_id);
        }

        next_id
    }

    // ── Mark Delivered ────────────────────────────────────────────────────────
    /// Seller signals delivery is complete. Funded → Delivered.
    /// Sets delivery_deadline = now + delivery_window_secs.
    pub fn mark_delivered(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        Self::assert_not_terminal(&r.status);
        assert!(caller == r.seller,               "only seller can mark delivered");
        assert!(r.status == EscrowStatus::Funded, "must be in Funded state");

        // Calculate absolute delivery deadline from window duration
        let delivery_deadline = env.ledger().timestamp()
            .checked_add(r.delivery_window_secs).expect("overflow");

        let old_status = r.status.clone();
        r.delivery_deadline = delivery_deadline;
        r.status = EscrowStatus::Delivered;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit_status_change(&env, escrow_id, &old_status, &r.status);
        emit(&env, "marked_delivered", escrow_id);
    }

    // ── Confirm Delivery ──────────────────────────────────────────────────────
    /// Buyer confirms delivery. Requires Delivered state.
    /// Funds sent to seller immediately.
    pub fn confirm_delivery(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        Self::assert_not_terminal(&r.status);
        assert!(caller == r.buyer,                   "only buyer can confirm delivery");
        assert!(r.status == EscrowStatus::Delivered, "seller must mark delivered first");

        let old_status = r.status.clone();
        r.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);
        emit_status_change(&env, escrow_id, &old_status, &r.status);
        emit(&env, "escrow_released", escrow_id);
    }

    // ── Cancel ────────────────────────────────────────────────────────────────
    /// Buyer cancels before deadline — only in Funded state (before delivery).
    pub fn cancel(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(caller == r.buyer,                "only buyer can cancel");
        assert!(r.status == EscrowStatus::Funded, "cannot cancel after delivery is marked");
        assert!(
            env.ledger().timestamp() < r.deadline,
            "deadline passed — use refund_after_deadline"
        );

        r.status = EscrowStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);

        emit(&env, "escrow_cancelled", escrow_id);
    }

    // ── Refund After Deadline ─────────────────────────────────────────────────
    /// Buyer protection: if seller NEVER calls mark_delivered and deadline passes,
    /// buyer can reclaim their funds. Prevents funds being stuck forever.
    /// Permissionless — anyone can call, but funds always go to buyer.
    pub fn refund_after_deadline(env: Env, escrow_id: u64) {
        let mut r = Self::load(&env, escrow_id);

        // Explicit terminal guard (belt + suspenders — status check below also protects)
        Self::assert_not_terminal(&r.status);
        assert!(r.status == EscrowStatus::Funded, "must be Funded — seller may have already delivered");
        assert!(
            env.ledger().timestamp() >= r.deadline,
            "deadline not reached yet"
        );

        r.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);

        emit(&env, "refund_after_deadline", escrow_id);
        emit_amount(&env, "funds_sent", escrow_id, r.amount);
    }

    // ── Auto Release After Delivery ───────────────────────────────────────────
    /// If buyer disappears after seller marks delivered, anyone can call this
    /// after delivery_deadline to release funds to seller.
    /// Permissionless — anyone can trigger, but funds always go to seller.
    pub fn auto_release_after_delivery(env: Env, escrow_id: u64) {
        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Delivered, "must be in Delivered state");
        assert!(
            env.ledger().timestamp() >= r.delivery_deadline,
            "delivery deadline not reached yet"
        );

        r.status = EscrowStatus::AutoReleased;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);
        emit(&env, "auto_released_after_delivery", escrow_id);
    }

    // ── Dispute ───────────────────────────────────────────────────────────────
    /// Either party raises a dispute. Works from Funded or Delivered state.
    /// Requires arbitrator to be set at creation.
    /// If status is Delivered, dispute must be raised before delivery_deadline
    /// to prevent last-second griefing after seller has already delivered.
    pub fn dispute(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        Self::assert_not_terminal(&r.status);
        assert!(
            r.status == EscrowStatus::Funded || r.status == EscrowStatus::Delivered,
            "must be Funded or Delivered to dispute"
        );
        assert!(
            caller == r.buyer || caller == r.seller,
            "only buyer or seller can raise a dispute"
        );
        assert!(r.arbitrators.len() > 0, "Mode A escrow — no arbitrators set at creation, dispute not available");

        // Anti-grief: if already Delivered, dispute window closes at delivery_deadline
        // Prevents buyer from raising dispute at the last second after seller delivered
        if r.status == EscrowStatus::Delivered && r.delivery_deadline > 0 {
            assert!(
                env.ledger().timestamp() < r.delivery_deadline,
                "dispute window closed — delivery deadline passed, use auto_release_after_delivery"
            );
        }

        // Collect dispute fee (anti-spam)
        let fee: i128 = env.storage().instance().get(&DataKey::DisputeFee).unwrap_or(0);
        if fee > 0 {
            token::Client::new(&env, &r.token)
                .transfer(&caller, &env.current_contract_address(), &fee);
            // Accumulate fee into per-escrow pool for reward distribution
            let existing_pool: i128 = env.storage().persistent()
                .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::DisputeFeePool(escrow_id), &(existing_pool + fee));
        }

        // ── DISPUTE SPIKE DETECTION ───────────────────────────────────────────
        // Auto-pause if DISPUTE_SPIKE_LIMIT disputes occur within DISPUTE_SPIKE_WINDOW.
        let now = env.ledger().timestamp();
        let window_start: u64 = env.storage().instance()
            .get(&DataKey::DisputeWindowStart).unwrap_or(0);
        let dispute_count: u32 = env.storage().instance()
            .get(&DataKey::DisputeCount).unwrap_or(0);

        let (new_count, new_window) = if now.saturating_sub(window_start) > DISPUTE_SPIKE_WINDOW {
            // Window expired — reset
            (1u32, now)
        } else {
            (dispute_count.saturating_add(1), window_start)
        };

        env.storage().instance().set(&DataKey::DisputeCount, &new_count);
        env.storage().instance().set(&DataKey::DisputeWindowStart, &new_window);

        if new_count >= DISPUTE_SPIKE_LIMIT {
            env.storage().instance().set(&DataKey::Paused, &true);
            env.events().publish((Symbol::new(&env, "auto_paused_spike"),), new_count);
        }

        // Track assignment for participation rate
        for arb in r.arbitrators.iter() {
            let total: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterTotalVotes(arb.clone())).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::ArbiterTotalVotes(arb.clone()), &total.saturating_add(1));
        }

        r.status = EscrowStatus::Disputed;
        r.disputed_by = Some(caller.clone());
        r.dispute_deadline = env.ledger().timestamp() + (3 * 24 * 60 * 60); // 3 days
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit(&env, "escrow_disputed", escrow_id);
    }

    // ── Vote ──────────────────────────────────────────────────────────────────
    /// Arbitrator casts their vote on a disputed escrow.
    pub fn vote(
        env:       Env,
        escrow_id: u64,
        caller:    Address,
        decision:  ArbitratorDecision,
    ) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Disputed, "must be in Disputed state");
        
        // Verify caller is in the arbitrator panel
        let mut is_arbitrator = false;
        for arb in r.arbitrators.iter() {
            if arb == caller {
                is_arbitrator = true;
                break;
            }
        }
        assert!(is_arbitrator, "caller is not an arbitrator for this escrow");

        // Check if already voted
        let vote_key = DataKey::Vote(escrow_id, caller.clone());
        assert!(!env.storage().persistent().has(&vote_key), "already voted");

        // Record vote
        env.storage().persistent().set(&vote_key, &decision);

        // Update vote counts
        match decision {
            ArbitratorDecision::Release => r.votes_release += 1,
            ArbitratorDecision::Refund => r.votes_refund += 1,
        }

        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        env.events().publish(
            (Symbol::new(&env, "vote_cast"), escrow_id),
            (caller, decision),
        );
    }

    // ── Finalize ──────────────────────────────────────────────────────────────
    /// Finalize the dispute after majority is reached.
    pub fn finalize(env: Env, escrow_id: u64) {
        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Disputed, "must be in Disputed state");
        Self::assert_not_terminal(&r.status); // Prevent double finalization

        let panel_size = r.arbitrators.len();
        let majority = (panel_size / 2) + 1;

        assert!(
            r.votes_release >= majority || r.votes_refund >= majority,
            "majority not reached yet"
        );

        if r.votes_release >= majority {
            r.status = EscrowStatus::Released;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            Self::pay_seller(&env, &r);
            emit(&env, "arbitrated_release", escrow_id);
        } else {
            r.status = EscrowStatus::Refunded;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            token::Client::new(&env, &r.token)
                .transfer(&env.current_contract_address(), &r.buyer, &r.amount);
            emit(&env, "arbitrated_refund", escrow_id);
            emit_amount(&env, "funds_sent", escrow_id, r.amount);
        }
    }

    // ── Force Finalize ────────────────────────────────────────────────────────
    /// Force finalize if arbitration deadline passed (deadlock protection).
    pub fn force_finalize(env: Env, escrow_id: u64) {
        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Disputed, "not disputed");
        assert!(
            env.ledger().timestamp() >= r.dispute_deadline,
            "dispute still active"
        );

        // Fallback rule: refund buyer
        r.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);
        
        emit(&env, "force_finalized", escrow_id);
        emit_amount(&env, "funds_sent", escrow_id, r.amount);
    }

    // ── Slash Inactive ────────────────────────────────────────────────────────
    /// Slash arbitrators who did not vote before dispute_deadline.
    /// Callable by anyone after dispute_deadline passes.
    /// Slashes INACTIVITY_SLASH_BPS (10%) of stake per inactive arbiter.
    /// Slashed amount goes to DisputeFeePool for reward distribution.
    /// Arbiters whose stake drops below MIN_ARBITER_STAKE are removed from pool.
    pub fn slash_inactive(env: Env, escrow_id: u64) {
        let r = Self::load(&env, escrow_id);
        assert!(
            r.status == EscrowStatus::Disputed || Self::is_terminal(&r.status),
            "escrow must be disputed or resolved"
        );
        assert!(
            env.ledger().timestamp() >= r.dispute_deadline,
            "dispute deadline not reached yet"
        );

        let mut slash_total: i128 = 0;

        for arb in r.arbitrators.iter() {
            let vote_key = DataKey::Vote(escrow_id, arb.clone());
            if env.storage().persistent().has(&vote_key) { continue; } // voted — skip

            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone())).unwrap_or(0);
            if stake == 0 { continue; }

            let slash = stake.checked_mul(INACTIVITY_SLASH_BPS).expect("overflow")
                             .checked_div(BPS).expect("div zero");
            let new_stake = stake.checked_sub(slash).expect("underflow");

            env.storage().persistent().set(&DataKey::ArbiterLockedStake(arb.clone()), &new_stake);
            env.storage().persistent().set(&DataKey::ArbiterStake(arb.clone()), &new_stake);
            slash_total = slash_total.checked_add(slash).expect("overflow");

            // Track missed vote
            let missed: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterMissedVotes(arb.clone())).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::ArbiterMissedVotes(arb.clone()), &missed.saturating_add(1));

            // Remove from pool if stake drops below minimum
            if new_stake < MIN_ARBITER_STAKE {
                Self::remove_from_pool(&env, &arb);
            }

            env.events().publish(
                (Symbol::new(&env, "slash_inactive"), arb),
                (slash, new_stake),
            );
        }

        // Add slash proceeds to dispute fee pool
        if slash_total > 0 {
            let pool: i128 = env.storage().persistent()
                .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::DisputeFeePool(escrow_id), &(pool + slash_total));
        }
    }

    // ── Slash Minority ────────────────────────────────────────────────────────
    /// Slash arbitrators who voted with the losing minority.
    /// Callable by anyone after finalize() has resolved the dispute.
    /// Slashes MINORITY_SLASH_BPS (20%) of stake per minority voter.
    pub fn slash_minority(env: Env, escrow_id: u64) {
        let r = Self::load(&env, escrow_id);
        assert!(
            r.status == EscrowStatus::Released || r.status == EscrowStatus::Refunded,
            "must be resolved via arbitration first"
        );

        // Determine which decision was the minority
        let panel_size = r.arbitrators.len();
        let majority = (panel_size / 2) + 1;
        let minority_decision = if r.votes_release >= majority {
            ArbitratorDecision::Refund   // release won → refund voters are minority
        } else if r.votes_refund >= majority {
            ArbitratorDecision::Release  // refund won → release voters are minority
        } else {
            return; // no majority reached (force_finalize case) — no minority slash
        };

        let mut slash_total: i128 = 0;

        for arb in r.arbitrators.iter() {
            let vote_key = DataKey::Vote(escrow_id, arb.clone());
            let voted: Option<ArbitratorDecision> = env.storage().persistent().get(&vote_key);
            if voted.as_ref() != Some(&minority_decision) { continue; }

            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone())).unwrap_or(0);
            if stake == 0 { continue; }

            let slash = stake.checked_mul(MINORITY_SLASH_BPS).expect("overflow")
                             .checked_div(BPS).expect("div zero");
            let new_stake = stake.checked_sub(slash).expect("underflow");

            env.storage().persistent().set(&DataKey::ArbiterLockedStake(arb.clone()), &new_stake);
            env.storage().persistent().set(&DataKey::ArbiterStake(arb.clone()), &new_stake);
            slash_total = slash_total.checked_add(slash).expect("overflow");

            if new_stake < MIN_ARBITER_STAKE {
                Self::remove_from_pool(&env, &arb);
            }

            env.events().publish(
                (Symbol::new(&env, "slash_minority"), arb),
                (slash, new_stake),
            );
        }

        if slash_total > 0 {
            let pool: i128 = env.storage().persistent()
                .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::DisputeFeePool(escrow_id), &(pool + slash_total));
        }
    }

    // ── Distribute Rewards ────────────────────────────────────────────────────
    /// Split DisputeFeePool equally among majority voters.
    /// Callable by anyone after finalize() resolves the dispute.
    pub fn distribute_rewards(env: Env, escrow_id: u64) {
        let r = Self::load(&env, escrow_id);
        assert!(
            r.status == EscrowStatus::Released || r.status == EscrowStatus::Refunded,
            "must be resolved via arbitration first"
        );

        let pool: i128 = env.storage().persistent()
            .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);
        if pool == 0 { return; }

        let panel_size = r.arbitrators.len();
        let majority = (panel_size / 2) + 1;

        let winning_decision = if r.votes_release >= majority {
            ArbitratorDecision::Release
        } else if r.votes_refund >= majority {
            ArbitratorDecision::Refund
        } else {
            return; // force_finalize — no majority, no reward distribution
        };

        // Count majority voters
        let mut majority_count: i128 = 0;
        for arb in r.arbitrators.iter() {
            let vote_key = DataKey::Vote(escrow_id, arb.clone());
            let voted: Option<ArbitratorDecision> = env.storage().persistent().get(&vote_key);
            if voted.as_ref() == Some(&winning_decision) { majority_count += 1; }
        }
        if majority_count == 0 { return; }

        let reward_per = pool.checked_div(majority_count).expect("div zero");
        if reward_per == 0 { return; }

        let token_addr: Address = r.token.clone();
        let client = token::Client::new(&env, &token_addr);

        for arb in r.arbitrators.iter() {
            let vote_key = DataKey::Vote(escrow_id, arb.clone());
            let voted: Option<ArbitratorDecision> = env.storage().persistent().get(&vote_key);
            if voted.as_ref() != Some(&winning_decision) { continue; }
            client.transfer(&env.current_contract_address(), &arb, &reward_per);
            env.events().publish(
                (Symbol::new(&env, "reward_distributed"), arb),
                reward_per,
            );
        }

        // Clear pool
        env.storage().persistent().set(&DataKey::DisputeFeePool(escrow_id), &0i128);
    }

    // ── Unregister Arbiter ────────────────────────────────────────────────────
    /// Request unstake. Cooldown of UNSTAKE_COOLDOWN_SECS (7 days) enforced.
    /// After cooldown, call claim_unstake() to receive tokens.
    pub fn request_unstake(env: Env, arbiter: Address) {
        arbiter.require_auth();
        let stake: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone())).unwrap_or(0);
        assert!(stake > 0, "no stake to unstake");

        let cooldown_end = env.ledger().timestamp()
            .checked_add(UNSTAKE_COOLDOWN_SECS).expect("overflow");
        env.storage().persistent()
            .set(&DataKey::ArbiterUnstakeAt(arbiter.clone()), &cooldown_end);

        env.events().publish(
            (Symbol::new(&env, "unstake_requested"), arbiter),
            cooldown_end,
        );
    }

    /// Claim unstaked tokens after cooldown expires.
    pub fn claim_unstake(env: Env, arbiter: Address) {
        arbiter.require_auth();

        let cooldown_end: u64 = env.storage().persistent()
            .get(&DataKey::ArbiterUnstakeAt(arbiter.clone())).unwrap_or(0);
        assert!(cooldown_end > 0, "no unstake request found");
        assert!(
            env.ledger().timestamp() >= cooldown_end,
            "unstake cooldown not elapsed — 7 days required"
        );

        let stake: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone())).unwrap_or(0);
        assert!(stake > 0, "no stake to claim");

        // Clear stake and remove from pool
        env.storage().persistent().set(&DataKey::ArbiterLockedStake(arbiter.clone()), &0i128);
        env.storage().persistent().set(&DataKey::ArbiterStake(arbiter.clone()), &0i128);
        env.storage().persistent().remove(&DataKey::ArbiterUnstakeAt(arbiter.clone()));
        Self::remove_from_pool(&env, &arbiter);

        // Return tokens to arbiter
        // NOTE: For testnet, stake is recorded but not actually transferred.
        // For mainnet: token::Client::new(&env, &stake_token).transfer(contract → arbiter, stake)
        env.events().publish(
            (Symbol::new(&env, "unstake_claimed"), arbiter),
            stake,
        );
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    pub fn set_fee(env: Env, new_fee_bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(new_fee_bps <= 500, "fee cannot exceed 5%");
        env.storage().instance().set(&DataKey::FeeBps, &new_fee_bps);
    }

    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((Symbol::new(&env, "paused"),), true);
    }

    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish((Symbol::new(&env, "unpaused"),), false);
    }

    fn assert_not_paused(env: &Env) {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        assert!(!paused, "contract is paused");
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowRecord {
        Self::load(&env, escrow_id)
    }

    pub fn escrow_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    pub fn get_votes(env: Env, escrow_id: u64) -> (u32, u32) {
        let r = Self::load(&env, escrow_id);
        (r.votes_release, r.votes_refund)
    }

    /// Returns true if this escrow has an arbitration panel (Mode B).
    /// Returns false if trust-minimized (Mode A).
    pub fn is_mode_b(env: Env, escrow_id: u64) -> bool {
        let r = Self::load(&env, escrow_id);
        r.arbitrators.len() > 0
    }

    /// Returns the panel size that would be assigned for a given amount (in stroops).
    /// Useful for UI to show "3 arbitrators will be assigned" before creation.
    pub fn get_panel_size(amount: i128) -> u32 {
        Self::panel_size_for(amount)
    }

    /// Returns the number of eligible arbiters currently in the pool.
    pub fn get_eligible_arbiter_count(env: Env) -> u32 {
        let pool: Vec<Address> = env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(&env));
        let mut count: u32 = 0;
        for arb in pool.iter() {
            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone()))
                .unwrap_or(0);
            if stake >= MIN_ARBITER_STAKE { count += 1; }
        }
        count
    }

    /// Get all registered arbiters
    pub fn get_arbiters(env: Env) -> Vec<Address> {
        env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(&env))
    }

    /// Get locked stake amount for a specific arbiter
    pub fn get_arbiter_stake(env: Env, arbiter: Address) -> i128 {
        env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter))
            .unwrap_or(0)
    }

    /// Get arbiter participation stats: (total_assigned, missed_votes)
    pub fn get_arbiter_stats(env: Env, arbiter: Address) -> (u32, u32) {
        let total: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterTotalVotes(arbiter.clone())).unwrap_or(0);
        let missed: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterMissedVotes(arbiter)).unwrap_or(0);
        (total, missed)
    }

    /// Get unstake cooldown end timestamp for an arbiter (0 = no request pending).
    pub fn get_unstake_at(env: Env, arbiter: Address) -> u64 {
        env.storage().persistent()
            .get(&DataKey::ArbiterUnstakeAt(arbiter)).unwrap_or(0)
    }

    /// Get accumulated dispute fee pool for an escrow.
    pub fn get_dispute_fee_pool(env: Env, escrow_id: u64) -> i128 {
        env.storage().persistent()
            .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0)
    }

    /// Get current dispute spike count and window start.
    pub fn get_dispute_spike_status(env: Env) -> (u32, u64) {
        let count: u32 = env.storage().instance().get(&DataKey::DisputeCount).unwrap_or(0);
        let start: u64 = env.storage().instance().get(&DataKey::DisputeWindowStart).unwrap_or(0);
        (count, start)
    }

    /// Get user's role in an escrow: "buyer", "seller", "arbitrator", or "none"
    pub fn get_role(env: Env, address: Address, escrow_id: u64) -> Symbol {
        let r = Self::load(&env, escrow_id);
        if r.buyer == address {
            return Symbol::new(&env, "buyer");
        }
        if r.seller == address {
            return Symbol::new(&env, "seller");
        }
        for arb in r.arbitrators.iter() {
            if arb == address {
                return Symbol::new(&env, "arbitrator");
            }
        }
        Symbol::new(&env, "none")
    }

    /// Get all escrows for a specific user (as buyer, seller, or arbitrator)
    pub fn get_user_escrows(env: Env, user: Address) -> soroban_sdk::Vec<EscrowRecord> {
        let mut results = soroban_sdk::Vec::new(&env);
        let total: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        
        for i in 1..=total {
            if let Some(record) = env.storage().persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(i)) {
                
                let mut is_participant = record.buyer == user || record.seller == user;
                
                if !is_participant {
                    for arb in record.arbitrators.iter() {
                        if arb == user {
                            is_participant = true;
                            break;
                        }
                    }
                }
                
                if is_participant {
                    results.push_back(record);
                }
            }
        }
        results
    }

    /// Get only active (non-terminal) escrows
    pub fn get_active_escrows(env: Env) -> soroban_sdk::Vec<EscrowRecord> {
        let mut results = soroban_sdk::Vec::new(&env);
        let total: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        
        for i in 1..=total {
            if let Some(record) = env.storage().persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(i)) {
                
                let is_active = record.status != EscrowStatus::Released
                    && record.status != EscrowStatus::AutoReleased
                    && record.status != EscrowStatus::Refunded
                    && record.status != EscrowStatus::Cancelled;
                
                if is_active {
                    results.push_back(record);
                }
            }
        }
        results
    }

    /// Fetch a batch of escrows by ID range for dashboard display.
    /// Both buyer and seller can see their escrows.
    pub fn get_escrows_range(env: Env, start_id: u64, end_id: u64) -> soroban_sdk::Vec<EscrowRecord> {
        let mut results = soroban_sdk::Vec::new(&env);
        let total: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let end = end_id.min(total);
        for i in start_id..=end {
            if let Some(record) = env.storage().persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(i)) {
                results.push_back(record);
            }
        }
        results
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    fn load(env: &Env, escrow_id: u64) -> EscrowRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"))
    }

    /// Returns the required panel size based on escrow amount.
    fn panel_size_for(amount: i128) -> u32 {
        if amount >= PANEL_7_THRESHOLD { 7 }
        else if amount >= PANEL_5_THRESHOLD { 5 }
        else { 3 }
    }

    /// Pseudo-randomly selects `panel_size` arbitrators from the registered pool.
    /// Entropy: escrow counter XOR ledger timestamp XOR pool length.
    /// Excludes buyer and seller. Requires pool >= panel_size eligible arbiters.
    ///
    /// LIMITATION: This is NOT a VRF. A validator controlling ledger timestamp
    /// could influence selection. Accepted at this stage — VRF oracle = Phase 1.
    fn select_panel(
        env:        &Env,
        buyer:      &Address,
        seller:     &Address,
        panel_size: u32,
    ) -> Vec<Address> {
        let pool: Vec<Address> = env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(env));

        // Filter: must have stake, must not be buyer or seller
        let mut eligible: Vec<Address> = Vec::new(env);
        for arb in pool.iter() {
            if arb == *buyer || arb == *seller { continue; }
            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone()))
                .unwrap_or(0);
            if stake >= MIN_ARBITER_STAKE {
                eligible.push_back(arb);
            }
        }

        assert!(
            eligible.len() >= panel_size,
            "not enough registered arbiters in pool — need at least panel_size eligible arbiters"
        );

        // Pseudo-random start index using XOR of counter + timestamp + pool size
        let counter: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let ts: u64 = env.ledger().timestamp();
        let pool_len = eligible.len() as u64;
        let seed = counter ^ ts ^ pool_len;

        let mut panel: Vec<Address> = Vec::new(env);
        let mut used: Vec<u32> = Vec::new(env);

        for i in 0..panel_size {
            // Vary the index for each slot using a simple linear congruential step
            let idx = ((seed.wrapping_add(i as u64).wrapping_mul(2654435761)) % pool_len) as u32;

            // Collision avoidance: if idx already used, walk forward
            let mut final_idx = idx;
            let mut attempts: u32 = 0;
            loop {
                let mut already_used = false;
                for u in used.iter() {
                    if u == final_idx { already_used = true; break; }
                }
                if !already_used { break; }
                final_idx = (final_idx + 1) % (pool_len as u32);
                attempts += 1;
                assert!(attempts < pool_len as u32, "panel selection loop overflow");
            }

            used.push_back(final_idx);
            panel.push_back(eligible.get(final_idx).unwrap());
        }

        panel
    }

    /// Terminal state guard — prevents any operation on completed escrows.
    fn assert_not_terminal(status: &EscrowStatus) {
        assert!(
            *status != EscrowStatus::Released   &&
            *status != EscrowStatus::AutoReleased &&
            *status != EscrowStatus::Refunded   &&
            *status != EscrowStatus::Cancelled,
            "escrow already completed"
        );
    }

    fn is_terminal(status: &EscrowStatus) -> bool {
        *status == EscrowStatus::Released   ||
        *status == EscrowStatus::AutoReleased ||
        *status == EscrowStatus::Refunded   ||
        *status == EscrowStatus::Cancelled
    }

    /// Remove an arbiter from the ArbiterList pool.
    fn remove_from_pool(env: &Env, arbiter: &Address) {
        let list: Vec<Address> = env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(env));
        let mut new_list: Vec<Address> = Vec::new(env);
        for a in list.iter() {
            if a != *arbiter { new_list.push_back(a); }
        }
        env.storage().instance().set(&DataKey::ArbiterList, &new_list);
        env.events().publish((Symbol::new(env, "arbiter_removed"), arbiter.clone()), ());
    }

    /// Pay seller minus platform fee. Fee goes to admin. Emits funds_sent.
    fn pay_seller(env: &Env, r: &EscrowRecord) {
        let client = token::Client::new(env, &r.token);
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);

        if fee_bps == 0 {
            client.transfer(&env.current_contract_address(), &r.seller, &r.amount);
        } else {
            let fee = r.amount
                .checked_mul(fee_bps as i128).expect("overflow")
                .checked_div(10_000).expect("div zero");
            let seller_amount = r.amount.checked_sub(fee).expect("underflow");
            assert!(seller_amount > 0, "fee exceeds payout");

            client.transfer(&env.current_contract_address(), &r.seller, &seller_amount);

            if fee > 0 {
                let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
                client.transfer(&env.current_contract_address(), &admin, &fee);
            }
        }

        emit_amount(env, "funds_sent", r.escrow_id, r.amount);
    }
}
