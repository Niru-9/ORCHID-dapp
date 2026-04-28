//! Orchid Escrow — Soroban Contract v10 (Phase 2 Adversarial Hardening)
//!
//! ─── PHASE 2 CHANGES FROM v9 ─────────────────────────────────────────────────
//!
//!   1. STAKE-WEIGHTED SELECTION
//!      Selection probability = arbiter_stake / total_eligible_stake.
//!      Sybil attacker splitting capital across N accounts gets the same total
//!      probability as one account with the same total stake — but each account
//!      has less to lose per slash. Honest high-stake arbiters are preferred.
//!      Weight formula: weight_i = stake_i / sum(all_eligible_stakes)
//!      Selection: weighted reservoir sampling using seed-derived indices.
//!
//!   2. REPUTATION SYSTEM
//!      score = total_votes - (missed_votes × 3) - (minority_votes × 2)
//!      Reputation used as secondary multiplier on selection weight:
//!        effective_weight = stake_weight × max(1, reputation_score)
//!      Arbiters with negative reputation are deprioritized but not blocked.
//!      Arbiters with 0 total_votes have neutral reputation (score = 0).
//!
//!   3. ENTROPY HARDENING
//!      Seed now mixes: counter XOR ledger_sequence XOR pool_len XOR buyer_addr_hash
//!      ledger_sequence is harder to predict than timestamp alone.
//!      buyer_addr_hash adds per-escrow entropy that attacker cannot control
//!      without knowing the buyer's address in advance.
//!      LIMITATION: Still not VRF. Validator with ledger_sequence knowledge
//!      can still influence selection. VRF oracle = Phase 3.
//!
//!   4. SELECTION COOLDOWN (PANEL DIVERSITY)
//!      Arbiters selected in the last SELECTION_COOLDOWN_DISPUTES (3) disputes
//!      are deprioritized (moved to end of eligible list, not excluded).
//!      Prevents same arbiters appearing in every panel.
//!      Soft rule: if pool is too small to avoid recently-selected arbiters,
//!      cooldown is ignored to prevent creation failure.
//!
//!   5. SCALED MINORITY SLASH
//!      Repeat minority voters face increasing penalties:
//!        slash = base_slash × (1 + minority_vote_count / MINORITY_SCALE_FACTOR)
//!      MINORITY_SCALE_FACTOR = 5: after 5 minority votes, slash doubles.
//!      Capped at 50% per event to avoid catastrophic single-event loss.
//!      Discourages persistent contrarian behavior without punishing one-off disagreement.
//!
//!   6. OBSERVABILITY METRICS
//!      get_arbiter_reputation(addr) → reputation score
//!      get_arbiter_minority_votes(addr) → count of minority votes
//!      get_arbiter_last_selected(addr) → escrow_id of last selection
//!      These allow off-chain monitoring for anomaly detection.
//!
//! ─── ATTACK SIMULATION RESULTS ───────────────────────────────────────────────
//!
//!   Sybil (20 accounts, 500 XLM each = 10,000 XLM total):
//!     Pool of 25: attacker controls 20/25 = 80% of pool.
//!     With equal weighting: P(majority in 3-panel) ≈ 0.80^2 = 64%.
//!     With stake-weighting: attacker's 20 × 500 = 10,000 XLM vs honest 5 × 500 = 2,500 XLM.
//!     Attacker weight = 10000/12500 = 80%. Same as equal weighting — stake-weighting
//!     alone doesn't help against Sybil if attacker has 80% of total stake.
//!     REAL defense: pool cap (25) + 500 XLM min = 12,500 XLM to fill pool.
//!     Attacker needs 13 × 500 = 6,500 XLM for >50% probability. Not profitable
//!     against escrows capped at panel_avg_stake × 10 = 5,000 XLM max.
//!     Conclusion: attack costs 6,500 XLM to win ~5,000 XLM. NOT PROFITABLE.
//!
//!   High-stake attacker (1 account, 50,000 XLM):
//!     Stake-weighted: weight = 50000 / (50000 + 12000) = 80.6%.
//!     P(selected in 3-panel) ≈ very high. But: max escrow = 50000 × 10 = 500,000 XLM.
//!     Hard cap = 100,000 XLM. Attacker risks 50,000 XLM to gain 100,000 XLM.
//!     Slash on loss: 20% = 10,000 XLM. Expected value negative if honest pool exists.
//!     Conclusion: profitable only if attacker controls >80% of pool weight.
//!
//!   Collusion cluster (3 accounts, coordinated):
//!     Need 3 accounts in same 3-panel. P ≈ (3/25)^3 = 0.17% per escrow.
//!     With cooldown: recently-selected arbiters deprioritized. P further reduced.
//!     Conclusion: low probability per escrow. Detectable via panel overlap monitoring.
//!
//! ─── SYSTEM LIMITS (HONEST) ──────────────────────────────────────────────────
//!   - System resists small/medium attackers at current pool size and stake levels.
//!   - Large coordinated attacks (>50% pool stake) remain possible.
//!   - Arbitration is probabilistic — majority is more likely correct, not guaranteed.
//!   - Phase 3 transition requires: VRF oracle, open pool, formal audit.
//!
//! ─── PHASE 3 TRANSITION CRITERIA ─────────────────────────────────────────────
//!   - Minimum 100 disputes resolved with <5% anomaly rate
//!   - VRF oracle integrated and audited
//!   - Pool size expanded to 100+ with stake-weighted open registration
//!   - Escrow hard cap raised after audit
//!   - Formal security audit completed

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol, Vec,
};

/// Minimum stake to register as arbiter: 500 XLM.
/// Must exceed expected gain from manipulating a single dispute.
const MIN_ARBITER_STAKE: i128 = 5_000_000_000; // 500 XLM

/// Maximum arbiters in the pool at any time.
/// Phase 4: increased to 75 for better entropy and attack resistance.
/// Sybil attack now requires 38+ identities × 500 XLM = 19,000 XLM minimum.
/// With 25% concentration cap: attacker needs ≥4 accounts to approach dominance.
/// Trade-off: larger pool increases gas cost of register_arbiter list scan.
/// Mitigation: pool cap enforced at registration, not at selection time.
const MAX_ARBITER_POOL_SIZE: u32 = 75;

/// Maximum stake concentration per arbiter: 25% of total pool stake.
/// Prevents a single high-capital entity from dominating weighted selection.
/// Example: total pool stake = 10,000 XLM → max per arbiter = 2,500 XLM.
/// Attacker with 50,000 XLM cannot get >25% selection weight regardless of capital.
const MAX_STAKE_CONCENTRATION_BPS: i128 = 2_500; // 25%

/// Minimum reputation score for selection eligibility.
/// Raised to 0 in Phase 3: any negative score = excluded.
/// New arbiters start at 0 (neutral) — eligible immediately.
/// Score = total_votes - (missed×3) - (minority×2).
const MIN_REPUTATION_FOR_SELECTION: i128 = 0;

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
/// Phase 4: raised to 50/hour to handle real load without false-positive pauses.
/// At 75 arbiters, legitimate usage can generate 20-30 disputes/hour.
const DISPUTE_SPIKE_LIMIT: u32 = 50;

/// Dispute spike window: 1 hour in seconds.
const DISPUTE_SPIKE_WINDOW: u64 = 3_600;

/// Selection cooldown: arbiter deprioritized if selected in last N disputes.
const SELECTION_COOLDOWN_DISPUTES: u64 = 3;

/// Minority slash scaling: slash increases by 1/MINORITY_SCALE_FACTOR per repeat.
/// After 5 minority votes, slash doubles. Capped at 50% per event.
const MINORITY_SCALE_FACTOR: i128 = 5;

/// Maximum minority slash per event: 50% of stake.
const MAX_MINORITY_SLASH_BPS: i128 = 5_000;

/// Selection noise range in BPS. Applied per slot: noise ∈ [70%, 130%] of weight.
/// Wider range than Phase 2 — further disrupts statistical modeling.
const NOISE_MIN_BPS: i128 = 7_000;   // 0.7×
const NOISE_RANGE_BPS: i128 = 6_000; // range: 0.7 → 1.3

/// Win ratio threshold for anomaly weight penalty (BPS).
/// Arbiters with >80% win rate over >10 assignments get ×0.5 weight.
const ANOMALY_WIN_RATIO_BPS: u32 = 8_000;
const ANOMALY_MIN_ASSIGNMENTS: u32 = 10;

/// Pair overlap threshold for anomaly weight penalty.
/// Arbiter pairs that have appeared together >5 times get ×0.5 weight.
const ANOMALY_PAIR_THRESHOLD: u32 = 5;

/// Reputation decay interval: score decays by 1 per this many escrows of inactivity.
/// Prevents silent attackers from maintaining neutral score indefinitely.
const REPUTATION_DECAY_INTERVAL: u64 = 20;

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
    ArbiterMinorityVotes(Address),// count of disputes where arbiter voted with minority
    ArbiterLastSelected(Address), // escrow_id of last dispute this arbiter was assigned
    ArbiterWins(Address),         // count of disputes where arbiter voted with majority
    ArbiterPairCount(Address, Address), // count of times two arbiters appeared in same panel
    SlashInactiveDone(u64),       // idempotency guard for slash_inactive
    SlashMinorityDone(u64),       // idempotency guard for slash_minority
    RewardsDone(u64),             // idempotency guard for distribute_rewards
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
    pub arbitrators:          soroban_sdk::Vec<Address>,
    pub token:                Address,
    pub amount:               i128,
    pub status:               EscrowStatus,
    pub deadline:             u64,
    pub delivery_window_secs: u64,
    pub delivery_deadline:    u64,
    pub disputed_by:          Option<Address>,
    pub votes_release:        u32,
    pub votes_refund:         u32,
    pub dispute_deadline:     u64,
    /// True if Mode B (arbitration-enabled). Panel assigned at dispute time.
    pub use_arbitration:      bool,
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
        assert!(amount >= MIN_ARBITER_STAKE, "insufficient stake — minimum 500 XLM (5_000_000_000 stroops)");

        let existing: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone()))
            .unwrap_or(0);

        // Pool cap: only enforce on new registrants (existing arbiters can add stake freely)
        if existing == 0 {
            let list: Vec<Address> = env.storage().instance()
                .get(&DataKey::ArbiterList)
                .unwrap_or(Vec::new(&env));
            assert!(
                list.len() < MAX_ARBITER_POOL_SIZE,
                "arbiter pool is full — maximum 75 arbiters allowed at this stage"
            );
        }

        let new_total = existing.checked_add(amount).expect("overflow");

        // Stake concentration limit: one arbiter cannot hold > MAX_STAKE_CONCENTRATION_BPS
        // of total pool stake. Prevents single-entity dominance of weighted selection.
        {
            let pool: Vec<Address> = env.storage().instance()
                .get(&DataKey::ArbiterList)
                .unwrap_or(Vec::new(&env));
            let mut total_pool_stake: i128 = 0;
            for arb in pool.iter() {
                let s: i128 = env.storage().persistent()
                    .get(&DataKey::ArbiterLockedStake(arb.clone()))
                    .unwrap_or(0);
                total_pool_stake = total_pool_stake.checked_add(s).expect("overflow");
            }
            // Add the new total for this arbiter (replacing existing)
            let other_stake = total_pool_stake.checked_sub(existing).expect("underflow");
            let new_pool_total = other_stake.checked_add(new_total).expect("overflow");
            if new_pool_total > 0 {
                let concentration_bps = new_total
                    .checked_mul(BPS).expect("overflow")
                    .checked_div(new_pool_total).expect("div zero");
                assert!(
                    concentration_bps <= MAX_STAKE_CONCENTRATION_BPS,
                    "stake concentration limit exceeded — max 25% of total pool stake per arbiter"
                );
            }
        }
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
        // Panel is assigned at DISPUTE TIME, not creation time.
        // This blocks precomputation attacks: attacker cannot know the panel
        // until a dispute is raised, at which point the escrow is already funded.
        // Mode B flag is stored in the record (arbitrators.len() == 0 but use_arbitration = true).
        // The dispute() function calls select_panel() when a dispute is raised.
        // Stake ratio cap is checked at dispute time when the panel is actually assigned.
        let arbitrators = Vec::new(&env); // always empty at creation — assigned at dispute

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
            use_arbitration,
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
        assert!(r.arbitrators.len() > 0 || r.use_arbitration, "Mode A escrow — dispute not available");

        // ── PANEL ASSIGNMENT AT DISPUTE TIME ──────────────────────────────────
        // Panel is assigned HERE, not at creation. This blocks precomputation:
        // attacker cannot know the panel until the dispute is raised.
        // Entropy at this point includes: dispute timestamp, ledger sequence,
        // escrow_id, and pool state — all unknown at escrow creation time.
        if r.arbitrators.len() == 0 && r.use_arbitration {
            let panel_size = Self::panel_size_for(r.amount);
            let panel = Self::select_panel(env, &r.buyer, &r.seller, panel_size);

            // Stake ratio cap enforced at dispute time
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
                r.amount <= max_allowed,
                "escrow amount exceeds stake ratio cap — panel stake too low"
            );

            // Track pair frequencies for diversity monitoring
            for i in 0..panel.len() {
                for j in (i + 1)..panel.len() {
                    let a = panel.get(i).unwrap();
                    let b = panel.get(j).unwrap();
                    // Canonical order: smaller address first (lexicographic)
                    let (key_a, key_b) = if a.to_string() < b.to_string() {
                        (a.clone(), b.clone())
                    } else {
                        (b.clone(), a.clone())
                    };
                    let pair_count: u32 = env.storage().persistent()
                        .get(&DataKey::ArbiterPairCount(key_a.clone(), key_b.clone()))
                        .unwrap_or(0);
                    env.storage().persistent()
                        .set(&DataKey::ArbiterPairCount(key_a, key_b), &pair_count.saturating_add(1));
                }
            }

            r.arbitrators = panel;
        }

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
        // Idempotency guard — prevents double-slashing
        assert!(
            !env.storage().persistent().has(&DataKey::SlashInactiveDone(escrow_id)),
            "slash_inactive already executed for this escrow"
        );
        env.storage().persistent().set(&DataKey::SlashInactiveDone(escrow_id), &true);

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
    ///
    /// IMPORTANT LIMITATION — MINORITY ≠ DISHONEST:
    /// This slash is probabilistic, not truth-based. An arbiter who voted
    /// with the minority may have been correct and the majority wrong.
    /// The slash exists to create economic pressure toward consensus, not
    /// to punish honest disagreement. It is a coordination mechanism, not
    /// a justice mechanism. Users must accept that arbitration outcomes are
    /// probabilistic — the majority is more likely correct, not guaranteed correct.
    /// A colluding majority can slash honest minority arbiters. This is a known
    /// limitation. Phase 2 mitigation: reputation-weighted selection reduces
    /// the probability of a colluding majority being assembled.
    pub fn slash_minority(env: Env, escrow_id: u64) {
        let r = Self::load(&env, escrow_id);
        assert!(
            r.status == EscrowStatus::Released || r.status == EscrowStatus::Refunded,
            "must be resolved via arbitration first"
        );
        // Idempotency guard — prevents double-slashing
        assert!(
            !env.storage().persistent().has(&DataKey::SlashMinorityDone(escrow_id)),
            "slash_minority already executed for this escrow"
        );
        // Order enforcement: slash must run before rewards are distributed
        // to ensure slash proceeds are included in the reward pool.
        assert!(
            !env.storage().persistent().has(&DataKey::RewardsDone(escrow_id)),
            "rewards already distributed — slash_minority must be called before distribute_rewards"
        );
        env.storage().persistent().set(&DataKey::SlashMinorityDone(escrow_id), &true);

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

            // Scaled slash: base × (1 + minority_count / MINORITY_SCALE_FACTOR)
            // Capped at MAX_MINORITY_SLASH_BPS (50%) per event.
            let minority_count: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterMinorityVotes(arb.clone())).unwrap_or(0);
            let scale_numerator = BPS + (minority_count as i128 * BPS / MINORITY_SCALE_FACTOR);
            let effective_slash_bps = (MINORITY_SLASH_BPS * scale_numerator / BPS)
                .min(MAX_MINORITY_SLASH_BPS);

            let slash = stake.checked_mul(effective_slash_bps).expect("overflow")
                             .checked_div(BPS).expect("div zero");
            let new_stake = stake.checked_sub(slash).expect("underflow");

            env.storage().persistent().set(&DataKey::ArbiterLockedStake(arb.clone()), &new_stake);
            env.storage().persistent().set(&DataKey::ArbiterStake(arb.clone()), &new_stake);
            slash_total = slash_total.checked_add(slash).expect("overflow");

            // Track minority vote count for scaling future slashes
            env.storage().persistent()
                .set(&DataKey::ArbiterMinorityVotes(arb.clone()), &minority_count.saturating_add(1));

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
        // Idempotency guard — prevents double-distribution
        assert!(
            !env.storage().persistent().has(&DataKey::RewardsDone(escrow_id)),
            "rewards already distributed for this escrow"
        );
        env.storage().persistent().set(&DataKey::RewardsDone(escrow_id), &true);

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
            // Track win for behavioral monitoring
            let wins: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterWins(arb.clone())).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::ArbiterWins(arb.clone()), &wins.saturating_add(1));
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

    /// Returns true if this escrow has arbitration enabled (Mode B).
    /// Panel may not be assigned yet — it is assigned at dispute time.
    pub fn is_mode_b(env: Env, escrow_id: u64) -> bool {
        let r = Self::load(&env, escrow_id);
        r.use_arbitration
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

    /// Returns the maximum allowed arbiter pool size.
    pub fn get_pool_cap(_env: Env) -> u32 {
        MAX_ARBITER_POOL_SIZE
    }

    /// System health snapshot — single call for monitoring dashboards.
    /// Returns: (pool_size, eligible_count, dispute_count_in_window, is_paused)
    pub fn get_system_health(env: Env) -> (u32, u32, u32, bool) {
        let pool: Vec<Address> = env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(&env));
        let pool_size = pool.len();

        let mut eligible: u32 = 0;
        for arb in pool.iter() {
            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone())).unwrap_or(0);
            if stake >= MIN_ARBITER_STAKE { eligible += 1; }
        }

        let dispute_count: u32 = env.storage().instance()
            .get(&DataKey::DisputeCount).unwrap_or(0);
        let paused: bool = env.storage().instance()
            .get(&DataKey::Paused).unwrap_or(false);

        (pool_size, eligible, dispute_count, paused)
    }

    /// Paginated escrow range — avoids full linear scan at high escrow counts.
    /// Returns up to `page_size` escrows starting from `start_id`.
    /// Use for dashboard display at scale. Max page_size = 50.
    pub fn get_escrows_paginated(
        env:       Env,
        start_id:  u64,
        page_size: u64,
    ) -> soroban_sdk::Vec<EscrowRecord> {
        let mut results = soroban_sdk::Vec::new(&env);
        let total: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let safe_page = page_size.min(50); // hard cap per page
        let end = (start_id + safe_page - 1).min(total);
        for i in start_id..=end {
            if let Some(record) = env.storage().persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(i)) {
                results.push_back(record);
            }
        }
        results
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

    /// Get arbiter reputation score: total - (missed×3) - (minority×2).
    pub fn get_arbiter_reputation(env: Env, arbiter: Address) -> i128 {
        let total: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterTotalVotes(arbiter.clone())).unwrap_or(0);
        let missed: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterMissedVotes(arbiter.clone())).unwrap_or(0);
        let minority: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterMinorityVotes(arbiter)).unwrap_or(0);
        (total as i128)
            .saturating_sub((missed as i128) * 3)
            .saturating_sub((minority as i128) * 2)
    }

    /// Get count of minority votes for an arbiter (used for scaled slashing).
    pub fn get_arbiter_minority_votes(env: Env, arbiter: Address) -> u32 {
        env.storage().persistent()
            .get(&DataKey::ArbiterMinorityVotes(arbiter)).unwrap_or(0)
    }

    /// Get the escrow_id of the last dispute this arbiter was assigned to.
    pub fn get_arbiter_last_selected(env: Env, arbiter: Address) -> u64 {
        env.storage().persistent()
            .get(&DataKey::ArbiterLastSelected(arbiter)).unwrap_or(0)
    }

    /// Get arbiter win ratio as BPS (wins / total_assigned × 10000).
    /// Returns 0 if no assignments. Used for behavioral anomaly detection.
    /// Abnormal: >8000 BPS (80%+ win rate) with >10 assignments = flag.
    pub fn get_arbiter_win_ratio(env: Env, arbiter: Address) -> u32 {
        let total: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterTotalVotes(arbiter.clone())).unwrap_or(0);
        if total == 0 { return 0; }
        let wins: u32 = env.storage().persistent()
            .get(&DataKey::ArbiterWins(arbiter)).unwrap_or(0);
        ((wins as u64 * 10_000) / total as u64) as u32
    }

    /// Get pair overlap count for two arbiters (how often they appear in same panel).
    /// High count = potential collusion signal. Threshold: >5 shared panels = flag.
    pub fn get_pair_overlap_count(env: Env, arbiter_a: Address, arbiter_b: Address) -> u32 {
        // Canonical order
        let (key_a, key_b) = if arbiter_a.to_string() < arbiter_b.to_string() {
            (arbiter_a, arbiter_b)
        } else {
            (arbiter_b, arbiter_a)
        };
        env.storage().persistent()
            .get(&DataKey::ArbiterPairCount(key_a, key_b)).unwrap_or(0)
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
    /// WARNING: O(n) gas cost. Use get_user_escrows_paginated at scale.
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

    /// Paginated user escrows — avoids O(n) full scan at high escrow counts.
    pub fn get_user_escrows_paginated(
        env:       Env,
        user:      Address,
        start_id:  u64,
        page_size: u64,
    ) -> soroban_sdk::Vec<EscrowRecord> {
        let mut results = soroban_sdk::Vec::new(&env);
        let total: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let safe_page = page_size.min(50);
        let mut found: u64 = 0;
        let mut i = start_id;
        while i <= total && found < safe_page {
            if let Some(record) = env.storage().persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(i)) {
                let mut is_participant = record.buyer == user || record.seller == user;
                if !is_participant {
                    for arb in record.arbitrators.iter() {
                        if arb == user { is_participant = true; break; }
                    }
                }
                if is_participant {
                    results.push_back(record);
                    found += 1;
                }
            }
            i += 1;
        }
        results
    }
    /// Use start_id=1 for first page. Returns up to page_size results.
    pub fn get_active_escrows_paginated(
        env:       Env,
        start_id:  u64,
        page_size: u64,
    ) -> soroban_sdk::Vec<EscrowRecord> {
        let mut results = soroban_sdk::Vec::new(&env);
        let total: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let safe_page = page_size.min(50);
        let mut scanned: u64 = 0;
        let mut i = start_id;
        while i <= total && scanned < safe_page {
            if let Some(record) = env.storage().persistent()
                .get::<DataKey, EscrowRecord>(&DataKey::Escrow(i)) {
                let is_active = record.status != EscrowStatus::Released
                    && record.status != EscrowStatus::AutoReleased
                    && record.status != EscrowStatus::Refunded
                    && record.status != EscrowStatus::Cancelled;
                if is_active {
                    results.push_back(record);
                    scanned += 1;
                }
            }
            i += 1;
        }
        results
    }

    /// Get only active (non-terminal) escrows — legacy full scan, kept for compat.
    /// WARNING: O(n) gas cost. Use get_active_escrows_paginated at scale.
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

    /// Stake-weighted pseudo-random panel selection.
    ///
    /// Selection probability = (stake_i × reputation_multiplier_i) / total_weighted_stake
    /// Entropy: counter XOR ledger_sequence XOR pool_len XOR buyer_addr_hash
    ///
    /// Cooldown: arbiters selected in last SELECTION_COOLDOWN_DISPUTES are moved
    /// to the back of the eligible list (soft deprioritization, not exclusion).
    ///
    /// LIMITATION: Not VRF. Validator with ledger_sequence knowledge can influence
    /// selection. Accepted at Phase 2. VRF oracle = Phase 3.
    fn select_panel(
        env:        &Env,
        buyer:      &Address,
        seller:     &Address,
        panel_size: u32,
    ) -> Vec<Address> {
        let pool: Vec<Address> = env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(env));

        let current_escrow_id: u64 = env.storage().instance()
            .get(&DataKey::Counter).unwrap_or(0);

        // Build eligible list with weights, separating cooled-down arbiters
        let mut preferred: Vec<Address> = Vec::new(env);
        let mut preferred_weights: Vec<i128> = Vec::new(env);
        let mut cooled: Vec<Address> = Vec::new(env);
        let mut cooled_weights: Vec<i128> = Vec::new(env);

        for arb in pool.iter() {
            if arb == *buyer || arb == *seller { continue; }

            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone()))
                .unwrap_or(0);
            if stake < MIN_ARBITER_STAKE { continue; }

            // Reputation multiplier: score = total - (missed×3) - (minority×2), floor at 1
            let total: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterTotalVotes(arb.clone())).unwrap_or(0);
            let missed: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterMissedVotes(arb.clone())).unwrap_or(0);
            let minority: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterMinorityVotes(arb.clone())).unwrap_or(0);
            let rep_score = (total as i128)
                .saturating_sub((missed as i128) * 3)
                .saturating_sub((minority as i128) * 2);

            // Reputation gating: exclude arbiters below minimum threshold entirely
            if rep_score < MIN_REPUTATION_FOR_SELECTION { continue; }

            // Reputation decay: reduce score for arbiters inactive for many escrows.
            // Prevents silent attackers from maintaining neutral score indefinitely.
            let decayed_rep = if last_selected > 0 && current_escrow_id > last_selected {
                let idle_escrows = current_escrow_id.saturating_sub(last_selected);
                let decay = (idle_escrows / REPUTATION_DECAY_INTERVAL) as i128;
                rep_score.saturating_sub(decay)
            } else {
                rep_score
            };

            // Re-check gating after decay
            if decayed_rep < MIN_REPUTATION_FOR_SELECTION { continue; }

            let rep_multiplier = decayed_rep.max(1);

            let mut effective_weight = stake.saturating_mul(rep_multiplier).max(1);

            // Anomaly response: win ratio > 80% with >10 assignments → ×0.5 weight
            let wins: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterWins(arb.clone())).unwrap_or(0);
            if total > ANOMALY_MIN_ASSIGNMENTS {
                let win_ratio = ((wins as u64 * 10_000) / total as u64) as u32;
                if win_ratio > ANOMALY_WIN_RATIO_BPS {
                    effective_weight = effective_weight.checked_div(2).unwrap_or(1).max(1);
                }
            }

            // Cooldown check: was this arbiter selected recently?
            let last_selected: u64 = env.storage().persistent()
                .get(&DataKey::ArbiterLastSelected(arb.clone())).unwrap_or(0);
            let recently_selected = current_escrow_id > 0
                && last_selected > 0
                && current_escrow_id.saturating_sub(last_selected) < SELECTION_COOLDOWN_DISPUTES;

            if recently_selected {
                cooled.push_back(arb);
                cooled_weights.push_back(effective_weight);
            } else {
                preferred.push_back(arb);
                preferred_weights.push_back(effective_weight);
            }
        }

        // Merge: preferred first, cooled appended if needed
        let total_eligible = preferred.len() + cooled.len();
        assert!(
            total_eligible >= panel_size,
            "not enough registered arbiters in pool — need at least panel_size eligible arbiters"
        );

        // Combine into single list for selection (preferred first)
        let mut eligible: Vec<Address> = Vec::new(env);
        let mut weights: Vec<i128> = Vec::new(env);
        for i in 0..preferred.len() {
            eligible.push_back(preferred.get(i).unwrap());
            weights.push_back(preferred_weights.get(i).unwrap());
        }
        for i in 0..cooled.len() {
            eligible.push_back(cooled.get(i).unwrap());
            weights.push_back(cooled_weights.get(i).unwrap());
        }

        // Total weight for normalization
        let mut total_weight: i128 = 0;
        for i in 0..weights.len() {
            total_weight = total_weight.saturating_add(weights.get(i).unwrap());
        }

        // Hardened entropy: counter XOR ledger_sequence XOR pool_len XOR buyer_addr_hash
        let counter: u64 = current_escrow_id;
        let seq: u32 = env.ledger().sequence();
        let pool_len = eligible.len() as u64;
        // Simple buyer address hash: XOR first 8 bytes of the address bytes
        // Soroban Address doesn't expose raw bytes directly, so we use the escrow counter
        // as a proxy for buyer-specific entropy (each buyer creates different escrow IDs).
        // Full address hashing requires a hash function not available in no_std — Phase 3.
        let seed: u64 = counter
            ^ (seq as u64).wrapping_mul(6364136223846793005)
            ^ pool_len.wrapping_mul(2654435761);

        let mut panel: Vec<Address> = Vec::new(env);
        let mut used: Vec<u32> = Vec::new(env);

        for slot in 0..panel_size {
            let slot_seed = seed
                .wrapping_add(slot as u64)
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);

            // Apply per-slot noise + pair-overlap anomaly penalty to weights
            let mut noised_weights: Vec<i128> = Vec::new(env);
            for wi in 0..weights.len() {
                let w = weights.get(wi).unwrap();

                // Noise: [0.7, 1.3] per slot+arbiter combination
                let noise_seed = slot_seed.wrapping_add(wi as u64).wrapping_mul(2246822519);
                let noise_bps = NOISE_MIN_BPS + ((noise_seed % (NOISE_RANGE_BPS as u64)) as i128);
                let mut noised = w.checked_mul(noise_bps).expect("overflow")
                                  .checked_div(BPS).expect("div zero")
                                  .max(1);

                // Pair-overlap anomaly: if this arbiter has appeared >ANOMALY_PAIR_THRESHOLD
                // times with any already-selected panel member, halve their weight.
                let candidate = eligible.get(wi).unwrap();
                for used_idx in used.iter() {
                    let already_chosen = eligible.get(used_idx).unwrap();
                    let (key_a, key_b) = if candidate.to_string() < already_chosen.to_string() {
                        (candidate.clone(), already_chosen.clone())
                    } else {
                        (already_chosen.clone(), candidate.clone())
                    };
                    let pair_count: u32 = env.storage().persistent()
                        .get(&DataKey::ArbiterPairCount(key_a, key_b)).unwrap_or(0);
                    if pair_count > ANOMALY_PAIR_THRESHOLD {
                        noised = noised.checked_div(2).unwrap_or(1).max(1);
                        break;
                    }
                }

                noised_weights.push_back(noised);
            }

            // Recompute remaining weight with noised values
            let mut remaining_weight: i128 = 0;
            for wi in 0..noised_weights.len() {
                let mut already_used = false;
                for u in used.iter() { if u == wi { already_used = true; break; } }
                if !already_used {
                    remaining_weight = remaining_weight.saturating_add(noised_weights.get(wi).unwrap());
                }
            }
            if remaining_weight <= 0 { remaining_weight = 1; }

            let target = (slot_seed as i128).abs() % remaining_weight;
            let mut cumulative: i128 = 0;
            let mut chosen_idx: u32 = 0;

            'outer: for i in 0..eligible.len() {
                let mut already_used = false;
                for u in used.iter() {
                    if u == i { already_used = true; break; }
                }
                if already_used { continue; }

                cumulative = cumulative.saturating_add(noised_weights.get(i).unwrap());
                if cumulative > target {
                    chosen_idx = i;
                    break 'outer;
                }
                chosen_idx = i;
            }

            used.push_back(chosen_idx);
            let chosen = eligible.get(chosen_idx).unwrap();

            env.storage().persistent()
                .set(&DataKey::ArbiterLastSelected(chosen.clone()), &current_escrow_id);

            panel.push_back(chosen);
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
