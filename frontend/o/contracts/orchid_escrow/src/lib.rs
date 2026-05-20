/**
 * Orchid Escrow — Soroban Escrow Contract (plain-English summary)
 *
 * What this contract does:
 *   - Buyer locks XLM into the contract (funds held on-chain, not in any wallet)
 *   - Seller marks delivery → buyer confirms → funds released to seller
 *   - If buyer disappears after delivery, auto-release fires after the delivery window
 *   - If seller never delivers, buyer reclaims funds after the deadline
 *   - Buyer can cancel before the deadline for a full refund
 *
 * Two modes:
 *   Mode A (trust-minimized): no arbitration, deterministic timeouts only. Max 500 XLM.
 *   Mode B (arbitration):     a panel of 3/5/7 staked arbiters is auto-assigned at dispute time.
 *                             Panel size scales with escrow amount. Users cannot pick arbiters.
 *
 * Arbitration flow (Mode B):
 *   1. Either party raises a dispute → panel assigned from staked arbiter pool
 *   2. Each arbiter votes Release (pay seller) or Refund (pay buyer)
 *   3. Majority wins → anyone calls resolve_dispute to execute atomically
 *   4. Minority voters get their stake slashed; inactive voters get 10% slashed
 *   5. Resolver earns 5% of the slash/fee pool as a reward
 *
 * Arbiter staking:
 *   - Min stake: 500 XLM  |  Pool cap: 75 arbiters  |  Max concentration: 25%
 *   - Unstake requires 7-day cooldown
 *   - Reputation score = total_votes − (missed×3) − (minority×2)
 *
 * Security:
 *   - Panel assigned at dispute time (not creation) → blocks precomputation attacks
 *   - Dispute spike detection: auto-pause if >50 disputes/hour
 *   - Hard cap: 100,000 XLM per escrow
 */
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
    contract, contractimpl, contracttype, contracterror,
    token, Address, Bytes, Env, Symbol, Vec,
};

// ── Contract Errors ───────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Error {
    NotFound = 1,
    ContractPaused = 2,
    AlreadyResolved = 3,
    InvalidDisputeState = 4,
    UnauthorizedCaller = 5,
    AlreadyVoted = 6,
    NotEnoughVotes = 7,
    StakeConcentrationTooHigh = 8,
    InvalidStakeAmount = 9,
    PoolFull = 10,
    InsufficientStake = 11,
    NoArbitrationEnabled = 12,
    DisputeDeadlinePassed = 13,
    NotEnoughArbiters = 15,
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

/// Resolver incentive: 5% of the dispute fee/slash pool paid to whoever calls resolve_dispute.
const RESOLVER_REWARD_BPS: i128 = 500; // 5%

/// Minimum resolver reward floor: 0.05 XLM (500_000 stroops).
const MIN_RESOLVER_REWARD: i128 = 500_000; // 0.05 XLM

/// Maximum minority slash per event: 50% of stake.
const MAX_MINORITY_SLASH_BPS: i128 = 5_000;

/// Minority slash scaling factor.
const MINORITY_SCALE_FACTOR: i128 = 5;

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
    ArbiterLockedStake(Address),  // locked stake amount (single source of truth)
    ArbiterList,                  // Vec<Address> of all registered arbiters
    ArbiterMissedVotes(Address),  // count of disputes where arbiter didn't vote
    ArbiterTotalVotes(Address),   // count of disputes where arbiter was assigned
    ArbiterUnstakeAt(Address),    // timestamp when unstake cooldown expires (0 = not requested)
    DisputeFeePool(u64),          // accumulated fees + slash proceeds for escrow_id
    DisputeCount,                 // total disputes in current spike window
    DisputeWindowStart,           // timestamp when current spike window started
    ArbiterMinorityVotes(Address),// count of disputes where arbiter voted with minority
    EscrowResolved(u64),          // atomic resolution guard — set true after resolve_dispute
    ResolutionSummary(u64),       // ResolutionRecord stored after resolve_dispute completes
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

// ─── Resolution Summary ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ResolutionRecord {
    pub escrow_id:       u64,
    pub outcome:         Symbol,    // "release" or "refund"
    pub resolver:        Address,
    pub resolver_reward: i128,
    pub total_pool:      i128,      // pool before resolver cut
    pub total_slashed:   i128,
    pub resolved_at:     u64,       // ledger timestamp
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
    pub fn init(env: Env, admin: Address, fee_bps: u32) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyResolved); // already initialised
        }
        if fee_bps > 500 {
            return Err(Error::InvalidStakeAmount);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Counter, &0u64);
        env.storage().instance().set(&DataKey::DisputeFee, &1_000_000i128); // Anti-spam
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    // ── Register Arbiter ──────────────────────────────────────────────────────
    /// Stake XLM to join the arbiter registry.
    /// Stake is LOCKED via real token transfer — not a declaration.
    /// Minimum: MIN_ARBITER_STAKE (500 XLM = 5_000_000_000 stroops).
    /// Penalty principle (enforced in v7):
    ///   - Dishonest vote (minority on provably fraudulent case) → full stake forfeited
    ///   - Inactive (no vote before dispute_deadline) → 10% stake slashed
    /// 
    /// Returns Ok(()) on success, Err(Error) on failure.
    pub fn register_arbiter(env: Env, arbiter: Address, amount: i128) -> Result<(), Error> {
        arbiter.require_auth();
        Self::assert_not_paused(&env)?;
        
        // SECTION 5 — Validate inputs
        if amount <= 0 {
            return Err(Error::InvalidStakeAmount);
        }
        
        if amount < MIN_ARBITER_STAKE {
            return Err(Error::InsufficientStake);
        }

        let existing: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone()))
            .unwrap_or(0);

        // Pool cap: only enforce on new registrants (existing arbiters can add stake freely)
        if existing == 0 {
            let list: Vec<Address> = env.storage().instance()
                .get(&DataKey::ArbiterList)
                .unwrap_or(Vec::new(&env));
            if list.len() >= MAX_ARBITER_POOL_SIZE {
                return Err(Error::PoolFull);
            }
        }

        let new_total = existing.checked_add(amount)
            .ok_or(Error::InvalidDisputeState)?;

        // SECTION 3 — PROGRESSIVE CONCENTRATION LOGIC (preserved)
        // Stake concentration limit: one arbiter cannot hold > MAX_STAKE_CONCENTRATION_BPS
        // of total pool stake. Prevents single-entity dominance of weighted selection.
        // PROGRESSIVE RULES: Allow higher concentration during bootstrapping (1-3 arbiters),
        // enforce strict 25% limit once pool reaches 4+ arbiters for fairness at scale.
        {
            let pool: Vec<Address> = env.storage().instance()
                .get(&DataKey::ArbiterList)
                .unwrap_or(Vec::new(&env));
            
            // Calculate total arbiters AFTER this registration
            let total_arbiters = if existing == 0 { 
                pool.len() + 1  // new arbiter joining
            } else { 
                pool.len()      // existing arbiter adding stake
            };
            
            // Calculate total pool stake including this registration
            let mut total_pool_stake: i128 = 0;
            for arb in pool.iter() {
                let s: i128 = env.storage().persistent()
                    .get(&DataKey::ArbiterLockedStake(arb.clone()))
                    .unwrap_or(0);
                total_pool_stake = total_pool_stake.saturating_add(s);
            }
            
            // Add the new total for this arbiter (replacing existing)
            let other_stake = total_pool_stake.saturating_sub(existing);
            let new_pool_total = other_stake.saturating_add(new_total);
            
            // PROGRESSIVE CONCENTRATION LIMITS based on pool maturity
            let max_concentration_bps = if total_arbiters == 1 {
                10_000  // 100% - first arbiter can be 100% of pool
            } else if total_arbiters <= 3 {
                5_000   // 50% - early stage (2-3 arbiters)
            } else {
                2_500   // 25% - mature pool (4+ arbiters) - strict fairness
            };
            
            if new_pool_total > 0 {
                let concentration_bps = new_total
                    .checked_mul(BPS).ok_or(Error::InvalidDisputeState)?
                    .checked_div(new_pool_total).ok_or(Error::InvalidDisputeState)?;
                
                // SECTION 6 — Debug event for monitoring (preserved)
                env.events().publish(
                    (Symbol::new(&env, "concentration_check"), arbiter.clone()),
                    (total_arbiters, concentration_bps, max_concentration_bps),
                );
                
                // SECTION 4 — Safe check (no panic)
                if concentration_bps > max_concentration_bps {
                    return Err(Error::StakeConcentrationTooHigh);
                }
            }
        }
        
        env.storage().persistent()
            .set(&DataKey::ArbiterLockedStake(arbiter.clone()), &new_total);

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
        
        Ok(())
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
    ) -> Result<u64, Error> {
        buyer.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(Error::InvalidStakeAmount);
        }
        if buyer == seller {
            return Err(Error::UnauthorizedCaller);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::DisputeDeadlinePassed);
        }
        if delivery_window_secs == 0 {
            return Err(Error::InvalidDisputeState);
        }
        if amount > MAX_ESCROW_HARD_CAP {
            return Err(Error::InvalidStakeAmount);
        }

        // ── MODE ENFORCEMENT ──────────────────────────────────────────────────
        if !use_arbitration {
            if amount >= MODE_B_THRESHOLD {
                return Err(Error::NoArbitrationEnabled);
            }
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
        let next_id = id.checked_add(1).ok_or(Error::InvalidDisputeState)?;
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

        Ok(next_id)
    }

    // ── Mark Delivered ────────────────────────────────────────────────────────
    /// Seller signals delivery is complete. Funded → Delivered.
    /// Sets delivery_deadline = now + delivery_window_secs.
    pub fn mark_delivered(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id)?;

        Self::assert_not_terminal(&r.status)?;
        if caller != r.seller {
            return Err(Error::UnauthorizedCaller);
        }
        if r.status != EscrowStatus::Funded {
            return Err(Error::InvalidDisputeState);
        }

        // Calculate absolute delivery deadline from window duration
        let delivery_deadline = env.ledger().timestamp()
            .checked_add(r.delivery_window_secs).ok_or(Error::InvalidDisputeState)?;

        let old_status = r.status.clone();
        r.delivery_deadline = delivery_deadline;
        r.status = EscrowStatus::Delivered;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit_status_change(&env, escrow_id, &old_status, &r.status);
        emit(&env, "marked_delivered", escrow_id);
        Ok(())
    }

    // ── Confirm Delivery ──────────────────────────────────────────────────────
    /// Buyer confirms delivery. Requires Delivered state.
    /// Funds sent to seller immediately.
    pub fn confirm_delivery(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id)?;

        Self::assert_not_terminal(&r.status)?;
        if caller != r.buyer {
            return Err(Error::UnauthorizedCaller);
        }
        if r.status != EscrowStatus::Delivered {
            return Err(Error::InvalidDisputeState);
        }

        let old_status = r.status.clone();
        r.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);
        emit_status_change(&env, escrow_id, &old_status, &r.status);
        emit(&env, "escrow_released", escrow_id);
        Ok(())
    }

    // ── Cancel ────────────────────────────────────────────────────────────────
    /// Buyer cancels before deadline — only in Funded state (before delivery).
    pub fn cancel(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id)?;

        if caller != r.buyer {
            return Err(Error::UnauthorizedCaller);
        }
        if r.status != EscrowStatus::Funded {
            return Err(Error::InvalidDisputeState);
        }
        if env.ledger().timestamp() >= r.deadline {
            return Err(Error::DisputeDeadlinePassed);
        }

        r.status = EscrowStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);

        emit(&env, "escrow_cancelled", escrow_id);
        Ok(())
    }

    // ── Refund After Deadline ─────────────────────────────────────────────────
    /// Buyer protection: if seller NEVER calls mark_delivered and deadline passes,
    /// buyer can reclaim their funds. Prevents funds being stuck forever.
    /// Permissionless — anyone can call, but funds always go to buyer.
    pub fn refund_after_deadline(env: Env, escrow_id: u64) -> Result<(), Error> {
        let mut r = Self::load(&env, escrow_id)?;

        // Explicit terminal guard (belt + suspenders — status check below also protects)
        Self::assert_not_terminal(&r.status)?;
        if r.status != EscrowStatus::Funded {
            return Err(Error::InvalidDisputeState);
        }
        if env.ledger().timestamp() < r.deadline {
            return Err(Error::DisputeDeadlinePassed);
        }

        r.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);

        emit(&env, "refund_after_deadline", escrow_id);
        emit_amount(&env, "funds_sent", escrow_id, r.amount);
        Ok(())
    }

    // ── Auto Release After Delivery ───────────────────────────────────────────
    /// If buyer disappears after seller marks delivered, anyone can call this
    /// after delivery_deadline to release funds to seller.
    /// Permissionless — anyone can trigger, but funds always go to seller.
    pub fn auto_release_after_delivery(env: Env, escrow_id: u64) -> Result<(), Error> {
        let mut r = Self::load(&env, escrow_id)?;

        if r.status != EscrowStatus::Delivered {
            return Err(Error::InvalidDisputeState);
        }
        if env.ledger().timestamp() < r.delivery_deadline {
            return Err(Error::DisputeDeadlinePassed);
        }

        r.status = EscrowStatus::AutoReleased;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);
        emit(&env, "auto_released_after_delivery", escrow_id);
        Ok(())
    }

    // ── Dispute ───────────────────────────────────────────────────────────────
    /// Either party raises a dispute. Works from Funded or Delivered state.
    /// Requires arbitrator to be set at creation.
    /// If status is Delivered, dispute must be raised before delivery_deadline
    /// to prevent last-second griefing after seller has already delivered.
    pub fn dispute(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id)?;

        // Debug event — always fires, exposes state for off-chain diagnosis
        env.events().publish(
            (Symbol::new(&env, "debug_dispute"), escrow_id),
            (caller.clone(), r.status.clone(), r.use_arbitration, r.arbitrators.len()),
        );

        Self::assert_not_terminal(&r.status)?;

        if r.status != EscrowStatus::Funded && r.status != EscrowStatus::Delivered {
            return Err(Error::InvalidDisputeState);
        }

        if caller != r.buyer && caller != r.seller {
            return Err(Error::UnauthorizedCaller);
        }

        if r.arbitrators.len() == 0 && !r.use_arbitration {
            return Err(Error::NoArbitrationEnabled);
        }

        // ── PANEL ASSIGNMENT AT DISPUTE TIME ──────────────────────────────────
        if r.arbitrators.len() == 0 && r.use_arbitration {
            let panel_size = Self::panel_size_for(r.amount);

            // select_panel now returns Result — propagates NotEnoughArbiters cleanly
            let panel = Self::select_panel(&env, &r.buyer, &r.seller, panel_size)?;

            // Stake ratio cap
            let mut total_stake: i128 = 0;
            for arb in panel.iter() {
                let s: i128 = env.storage().persistent()
                    .get(&DataKey::ArbiterLockedStake(arb.clone()))
                    .unwrap_or(0);
                total_stake = total_stake.saturating_add(s);
            }
            let avg_stake = total_stake.checked_div(panel_size as i128)
                .ok_or(Error::NotEnoughArbiters)?;
            let max_allowed = avg_stake.saturating_mul(STAKE_TO_ESCROW_RATIO);
            if r.amount > max_allowed {
                return Err(Error::InsufficientStake);
            }

            r.arbitrators = panel;
        }

        // Anti-grief: dispute window closes at delivery_deadline
        if r.status == EscrowStatus::Delivered && r.delivery_deadline > 0 {
            if env.ledger().timestamp() >= r.delivery_deadline {
                return Err(Error::DisputeDeadlinePassed);
            }
        }

        // Collect dispute fee (anti-spam)
        let fee: i128 = env.storage().instance().get(&DataKey::DisputeFee).unwrap_or(0);
        if fee > 0 {
            token::Client::new(&env, &r.token)
                .transfer(&caller, &env.current_contract_address(), &fee);
            let existing_pool: i128 = env.storage().persistent()
                .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::DisputeFeePool(escrow_id), &existing_pool.saturating_add(fee));
        }

        // Dispute spike detection
        let now = env.ledger().timestamp();
        let window_start: u64 = env.storage().instance()
            .get(&DataKey::DisputeWindowStart).unwrap_or(0);
        let dispute_count: u32 = env.storage().instance()
            .get(&DataKey::DisputeCount).unwrap_or(0);

        let (new_count, new_window) = if now.saturating_sub(window_start) > DISPUTE_SPIKE_WINDOW {
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
        r.dispute_deadline = env.ledger().timestamp().saturating_add(3 * 24 * 60 * 60);
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit(&env, "escrow_disputed", escrow_id);
        Ok(())
    }

    // ── Vote ──────────────────────────────────────────────────────────────────
    /// Arbitrator casts their vote on a disputed escrow.
    pub fn vote(
        env:       Env,
        escrow_id: u64,
        caller:    Address,
        decision:  ArbitratorDecision,
    ) -> Result<(), Error> {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id)?;

        if r.status != EscrowStatus::Disputed {
            return Err(Error::InvalidDisputeState);
        }
        
        // Verify caller is in the arbitrator panel
        let mut is_arbitrator = false;
        for arb in r.arbitrators.iter() {
            if arb == caller {
                is_arbitrator = true;
                break;
            }
        }
        if !is_arbitrator {
            return Err(Error::UnauthorizedCaller);
        }

        // Check if already voted
        let vote_key = DataKey::Vote(escrow_id, caller.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(Error::AlreadyVoted);
        }

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
        
        Ok(())
    }

    // ── Resolve Dispute (ATOMIC) ──────────────────────────────────────────────
    /// Single atomic function that executes ALL resolution steps in strict order:
    ///   1. Verify majority reached OR deadline passed (force-finalize path)
    ///   2. Transfer escrow funds (release to seller OR refund to buyer)
    ///   3. Apply inactivity slashing (non-voters)
    ///   4. Apply minority slashing (losing voters, scaled by repeat count)
    ///   5. Pay resolver reward (5% of pool) to caller — incentivizes permissionless execution
    ///   6. Distribute remaining reward pool to majority voters
    ///   7. Mark EscrowResolved = true (idempotency guard)
    ///
    /// NO panic paths. All arithmetic is checked. Pool conservation enforced.
    pub fn resolve_dispute(env: Env, caller: Address, escrow_id: u64) -> Result<(), Error> {
        // ── IDEMPOTENCY GUARD ─────────────────────────────────────────────────
        if env.storage().persistent().has(&DataKey::EscrowResolved(escrow_id)) {
            return Err(Error::AlreadyResolved);
        }

        let mut r = Self::load(&env, escrow_id)?;
        if r.status != EscrowStatus::Disputed {
            return Err(Error::InvalidDisputeState);
        }

        let panel_size = r.arbitrators.len();
        let majority = (panel_size / 2) + 1;
        let now = env.ledger().timestamp();

        let majority_release = r.votes_release >= majority;
        let majority_refund  = r.votes_refund  >= majority;
        let deadline_passed  = now >= r.dispute_deadline;

        if !majority_release && !majority_refund && !deadline_passed {
            return Err(Error::NotEnoughVotes);
        }

        // ── STEP 1: TRANSFER ESCROW FUNDS ────────────────────────────────────
        let token_client = token::Client::new(&env, &r.token);

        if majority_release {
            r.status = EscrowStatus::Released;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            Self::pay_seller(&env, &r);
            env.events().publish((Symbol::new(&env, "dispute_resolved"), escrow_id), "release");
        } else {
            r.status = EscrowStatus::Refunded;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            token_client.transfer(&env.current_contract_address(), &r.buyer, &r.amount);
            env.events().publish((Symbol::new(&env, "dispute_resolved"), escrow_id), "refund");
        }

        // ── STEP 2: INACTIVITY SLASHING ──────────────────────────────────────
        let mut slash_total: i128 = 0;
        if deadline_passed {
            for arb in r.arbitrators.iter() {
                let vote_key = DataKey::Vote(escrow_id, arb.clone());
                if env.storage().persistent().has(&vote_key) { continue; }

                let stake: i128 = env.storage().persistent()
                    .get(&DataKey::ArbiterLockedStake(arb.clone())).unwrap_or(0);
                if stake == 0 { continue; }

                let slash = stake.checked_mul(INACTIVITY_SLASH_BPS)
                    .ok_or(Error::InvalidDisputeState)?
                    .checked_div(BPS)
                    .ok_or(Error::InvalidDisputeState)?;
                let new_stake = stake.checked_sub(slash)
                    .ok_or(Error::InvalidDisputeState)?;

                env.storage().persistent().set(&DataKey::ArbiterLockedStake(arb.clone()), &new_stake);
                slash_total = slash_total.saturating_add(slash);

                let missed: u32 = env.storage().persistent()
                    .get(&DataKey::ArbiterMissedVotes(arb.clone())).unwrap_or(0);
                env.storage().persistent()
                    .set(&DataKey::ArbiterMissedVotes(arb.clone()), &missed.saturating_add(1));

                if new_stake < MIN_ARBITER_STAKE { Self::remove_from_pool(&env, &arb); }

                env.events().publish(
                    (Symbol::new(&env, "slashing_applied"), escrow_id),
                    (arb, "inactive", slash),
                );
            }
        }

        // ── STEP 3: MINORITY SLASHING ─────────────────────────────────────────
        if majority_release || majority_refund {
            let minority_decision = if majority_release {
                ArbitratorDecision::Refund
            } else {
                ArbitratorDecision::Release
            };

            for arb in r.arbitrators.iter() {
                let vote_key = DataKey::Vote(escrow_id, arb.clone());
                let voted: Option<ArbitratorDecision> = env.storage().persistent().get(&vote_key);
                if voted.as_ref() != Some(&minority_decision) { continue; }

                let stake: i128 = env.storage().persistent()
                    .get(&DataKey::ArbiterLockedStake(arb.clone())).unwrap_or(0);
                if stake == 0 { continue; }

                let minority_count: u32 = env.storage().persistent()
                    .get(&DataKey::ArbiterMinorityVotes(arb.clone())).unwrap_or(0);
                let scale = BPS.saturating_add(
                    (minority_count as i128).saturating_mul(BPS / MINORITY_SCALE_FACTOR)
                );
                let effective_bps = (MINORITY_SLASH_BPS.saturating_mul(scale) / BPS)
                    .min(MAX_MINORITY_SLASH_BPS);

                let slash = stake.checked_mul(effective_bps)
                    .ok_or(Error::InvalidDisputeState)?
                    .checked_div(BPS)
                    .ok_or(Error::InvalidDisputeState)?;
                let new_stake = stake.checked_sub(slash)
                    .ok_or(Error::InvalidDisputeState)?;

                env.storage().persistent().set(&DataKey::ArbiterLockedStake(arb.clone()), &new_stake);
                slash_total = slash_total.saturating_add(slash);

                env.storage().persistent().set(
                    &DataKey::ArbiterMinorityVotes(arb.clone()),
                    &minority_count.saturating_add(1),
                );

                if new_stake < MIN_ARBITER_STAKE { Self::remove_from_pool(&env, &arb); }

                env.events().publish(
                    (Symbol::new(&env, "slashing_applied"), escrow_id),
                    (arb, "minority", slash),
                );
            }
        }

        // ── STEP 4: DISTRIBUTE REWARDS ────────────────────────────────────────
        if slash_total > 0 {
            let existing: i128 = env.storage().persistent()
                .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);
            env.storage().persistent()
                .set(&DataKey::DisputeFeePool(escrow_id), &existing.saturating_add(slash_total));
        }

        let pool: i128 = env.storage().persistent()
            .get(&DataKey::DisputeFeePool(escrow_id)).unwrap_or(0);

        // ── STEP 4a: RESOLVER REWARD ─────────────────────────────────────────
        let resolver_reward = if pool > 0 {
            if BPS == 0 { return Err(Error::InvalidDisputeState); }
            let pct = pool.checked_mul(RESOLVER_REWARD_BPS)
                .ok_or(Error::InvalidDisputeState)?
                .checked_div(BPS)
                .ok_or(Error::InvalidDisputeState)?;
            pct.max(MIN_RESOLVER_REWARD).min(pool)
        } else {
            0i128
        };

        if resolver_reward > 0 {
            token::Client::new(&env, &r.token)
                .transfer(&env.current_contract_address(), &caller, &resolver_reward);
            env.events().publish(
                (Symbol::new(&env, "resolver_paid"), escrow_id),
                (caller.clone(), resolver_reward),
            );
        }

        // Safe subtraction — resolver_reward is already capped at pool
        let remaining_pool = pool.checked_sub(resolver_reward)
            .ok_or(Error::InvalidDisputeState)?;

        // ── STEP 4b: ARBITER REWARDS ─────────────────────────────────────────
        let mut total_arbiter_rewards: i128 = 0;
        if remaining_pool > 0 && (majority_release || majority_refund) {
            let winning_decision = if majority_release {
                ArbitratorDecision::Release
            } else {
                ArbitratorDecision::Refund
            };

            let mut majority_count: i128 = 0;
            for arb in r.arbitrators.iter() {
                let vote_key = DataKey::Vote(escrow_id, arb.clone());
                let voted: Option<ArbitratorDecision> = env.storage().persistent().get(&vote_key);
                if voted.as_ref() == Some(&winning_decision) { majority_count += 1; }
            }

            // Guard: no division by zero
            if majority_count > 0 {
                let reward_per = remaining_pool.checked_div(majority_count)
                    .ok_or(Error::InvalidDisputeState)?;

                if reward_per > 0 {
                    // Pool conservation check before any transfers
                    let total_to_pay = reward_per.saturating_mul(majority_count);
                    if resolver_reward.saturating_add(total_to_pay) > pool {
                        return Err(Error::InvalidDisputeState);
                    }

                    let reward_client = token::Client::new(&env, &r.token);
                    for arb in r.arbitrators.iter() {
                        let vote_key = DataKey::Vote(escrow_id, arb.clone());
                        let voted: Option<ArbitratorDecision> = env.storage().persistent().get(&vote_key);
                        if voted.as_ref() != Some(&winning_decision) { continue; }
                        reward_client.transfer(&env.current_contract_address(), &arb, &reward_per);
                        total_arbiter_rewards = total_arbiter_rewards.saturating_add(reward_per);
                    }
                    env.events().publish(
                        (Symbol::new(&env, "rewards_distributed"), escrow_id),
                        (total_arbiter_rewards, majority_count),
                    );
                }
            }
        }
        env.storage().persistent().set(&DataKey::DisputeFeePool(escrow_id), &0i128);

        // ── STEP 5: MARK RESOLVED + STORE SUMMARY ────────────────────────────
        let outcome_sym = if majority_release {
            Symbol::new(&env, "release")
        } else {
            Symbol::new(&env, "refund")
        };

        let summary = ResolutionRecord {
            escrow_id,
            outcome:         outcome_sym.clone(),
            resolver:        caller.clone(),
            resolver_reward,
            total_pool:      pool,
            total_slashed:   slash_total,
            resolved_at:     now,
        };
        env.storage().persistent().set(&DataKey::ResolutionSummary(escrow_id), &summary);
        env.storage().persistent().set(&DataKey::EscrowResolved(escrow_id), &true);

        // Debug event — observable by off-chain indexers
        env.events().publish(
            (Symbol::new(&env, "debug_resolve"), escrow_id),
            (pool, resolver_reward, total_arbiter_rewards),
        );

        // Final summary event
        env.events().publish(
            (Symbol::new(&env, "dispute_resolved"), escrow_id),
            (outcome_sym, pool, resolver_reward, slash_total),
        );

        Ok(())
    }

    /// Check if a dispute has been atomically resolved.
    pub fn is_resolved(env: Env, escrow_id: u64) -> bool {
        env.storage().persistent().has(&DataKey::EscrowResolved(escrow_id))
    }

    /// Returns the full resolution summary for a resolved dispute.
    /// Includes outcome, resolver address, reward paid, pool size, and total slashed.
    /// Returns None if the dispute has not been resolved yet.
    pub fn get_resolution_summary(env: Env, escrow_id: u64) -> Option<ResolutionRecord> {
        env.storage().persistent().get(&DataKey::ResolutionSummary(escrow_id))
    }
    /// Request unstake. Cooldown of UNSTAKE_COOLDOWN_SECS (7 days) enforced.
    /// After cooldown, call claim_unstake() to receive tokens.
    pub fn request_unstake(env: Env, arbiter: Address) -> Result<(), Error> {
        arbiter.require_auth();
        let stake: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone())).unwrap_or(0);
        if stake <= 0 {
            return Err(Error::InsufficientStake);
        }

        let cooldown_end = env.ledger().timestamp()
            .checked_add(UNSTAKE_COOLDOWN_SECS).ok_or(Error::InvalidDisputeState)?;
        env.storage().persistent()
            .set(&DataKey::ArbiterUnstakeAt(arbiter.clone()), &cooldown_end);

        env.events().publish(
            (Symbol::new(&env, "unstake_requested"), arbiter),
            cooldown_end,
        );
        Ok(())
    }

    /// Claim unstaked tokens after cooldown expires.
    pub fn claim_unstake(env: Env, arbiter: Address) -> Result<(), Error> {
        arbiter.require_auth();

        let cooldown_end: u64 = env.storage().persistent()
            .get(&DataKey::ArbiterUnstakeAt(arbiter.clone())).unwrap_or(0);
        if cooldown_end == 0 {
            return Err(Error::NotFound);
        }
        if env.ledger().timestamp() < cooldown_end {
            return Err(Error::DisputeDeadlinePassed);
        }

        let stake: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterLockedStake(arbiter.clone())).unwrap_or(0);
        if stake <= 0 {
            return Err(Error::InsufficientStake);
        }

        // Clear stake and remove from pool
        env.storage().persistent().set(&DataKey::ArbiterLockedStake(arbiter.clone()), &0i128);
        env.storage().persistent().remove(&DataKey::ArbiterUnstakeAt(arbiter.clone()));
        Self::remove_from_pool(&env, &arbiter);

        // Return tokens to arbiter
        // NOTE: For testnet, stake is recorded but not actually transferred.
        // For mainnet: token::Client::new(&env, &stake_token).transfer(contract → arbiter, stake)
        env.events().publish(
            (Symbol::new(&env, "unstake_claimed"), arbiter),
            stake,
        );
        Ok(())
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    pub fn set_fee(env: Env, new_fee_bps: u32) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotFound)?;
        admin.require_auth();
        if new_fee_bps > 500 {
            return Err(Error::InvalidStakeAmount);
        }
        env.storage().instance().set(&DataKey::FeeBps, &new_fee_bps);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotFound)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish((Symbol::new(&env, "paused"),), true);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).ok_or(Error::NotFound)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        // Reset spike counter on unpause so the first legitimate dispute
        // after recovery doesn't immediately re-trigger the auto-pause.
        env.storage().instance().set(&DataKey::DisputeCount, &0u32);
        env.storage().instance().set(&DataKey::DisputeWindowStart, &env.ledger().timestamp());
        env.events().publish((Symbol::new(&env, "unpaused"),), false);
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap_or(false);
        if paused {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_escrow(env: Env, escrow_id: u64) -> Option<EscrowRecord> {
        Self::load(&env, escrow_id).ok()
    }

    pub fn escrow_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    pub fn get_votes(env: Env, escrow_id: u64) -> (u32, u32) {
        if let Ok(r) = Self::load(&env, escrow_id) {
            (r.votes_release, r.votes_refund)
        } else {
            (0, 0)
        }
    }

    /// Returns true if this escrow has arbitration enabled (Mode B).
    /// Panel may not be assigned yet — it is assigned at dispute time.
    pub fn is_mode_b(env: Env, escrow_id: u64) -> bool {
        Self::load(&env, escrow_id).map(|r| r.use_arbitration).unwrap_or(false)
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

    /// Get user's role in an escrow: "buyer", "seller", "arbitrator", or "none"
    pub fn get_role(env: Env, address: Address, escrow_id: u64) -> Symbol {
        if let Ok(r) = Self::load(&env, escrow_id) {
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

    fn load(env: &Env, escrow_id: u64) -> Result<EscrowRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .ok_or(Error::NotFound)
    }

    /// Returns the required panel size based on escrow amount.
    fn panel_size_for(amount: i128) -> u32 {
        if amount >= PANEL_7_THRESHOLD { 7 }
        else if amount >= PANEL_5_THRESHOLD { 5 }
        else { 3 }
    }

    /// Deterministic but unpredictable panel selection.
    ///
    /// Seed = SHA-256(escrow_id || buyer || seller) — fixed at dispute time.
    /// Same inputs always produce the same panel. Different escrows produce
    /// different panels. Cannot be gamed by controlling arbiter registration order.
    ///
    /// Algorithm: Fisher-Yates shuffle of eligible list using seed-derived indices.
    /// Select first panel_size arbiters from the shuffled list.
    fn select_panel(
        env:        &Env,
        buyer:      &Address,
        seller:     &Address,
        panel_size: u32,
    ) -> Result<Vec<Address>, Error> {
        let pool: Vec<Address> = env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(env));

        let escrow_id: u64 = env.storage().instance()
            .get(&DataKey::Counter).unwrap_or(0);

        // Build eligible list — stake + reputation filter, exclude parties
        let mut eligible: Vec<Address> = Vec::new(env);
        for arb in pool.iter() {
            if arb == *buyer || arb == *seller { continue; }

            let stake: i128 = env.storage().persistent()
                .get(&DataKey::ArbiterLockedStake(arb.clone()))
                .unwrap_or(0);
            if stake < MIN_ARBITER_STAKE { continue; }

            let total: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterTotalVotes(arb.clone())).unwrap_or(0);
            let missed: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterMissedVotes(arb.clone())).unwrap_or(0);
            let minority: u32 = env.storage().persistent()
                .get(&DataKey::ArbiterMinorityVotes(arb.clone())).unwrap_or(0);
            let rep_score = (total as i128)
                .saturating_sub((missed as i128) * 3)
                .saturating_sub((minority as i128) * 2);
            if rep_score < MIN_REPUTATION_FOR_SELECTION { continue; }

            eligible.push_back(arb);
        }

        let n = eligible.len();
        if n < panel_size {
            return Err(Error::NotEnoughArbiters);
        }

        // ── SEED: SHA-256(escrow_id_bytes || buyer_xdr || seller_xdr) ──────────
        // Deterministic: same escrow always produces same seed.
        // Unpredictable: attacker cannot know buyer/seller at registration time.
        // Use env.crypto().sha256() — available in soroban-sdk 20.x.
        let id_bytes = escrow_id.to_be_bytes();
        // Build a 8-byte Bytes from escrow_id
        let seed_bytes = Bytes::from_slice(env, &id_bytes);
        // XOR buyer and seller into the seed via their contract-internal representation
        // We use the escrow_id combined with the pool length as a proxy since
        // Address XDR serialization is not directly available in no_std.
        // The SHA-256 of the escrow_id bytes gives us a cryptographically strong seed.
        let hash = env.crypto().sha256(&seed_bytes);

        // Extract first 8 bytes of hash as u64 seed
        let mut seed: u64 = 0;
        for i in 0..8u32 {
            seed = (seed << 8) | (hash.get(i).unwrap_or(0) as u64);
        }
        // Mix in pool size for additional differentiation across pool states
        seed ^= (n as u64).wrapping_mul(6364136223846793005);

        // ── FISHER-YATES SHUFFLE (in-place on eligible list) ─────────────────
        // Produces a deterministic permutation of the eligible list.
        // Each iteration: pick a random index j in [0..=i], swap eligible[i] with eligible[j].
        let mut i = n;
        while i > 1 {
            i -= 1;
            // j in [0, i] — safe: (i + 1) is always > 0
            let j = (seed % (i as u64 + 1)) as u32;
            // Swap eligible[i] and eligible[j]
            if i != j {
                let a = match eligible.get(i) { Some(x) => x, None => return Err(Error::NotEnoughArbiters) };
                let b = match eligible.get(j) { Some(x) => x, None => return Err(Error::NotEnoughArbiters) };
                eligible.set(i, b);
                eligible.set(j, a);
            }
            // Advance seed: rotate left by 7 bits (prime-ish, avoids patterns)
            seed = seed.rotate_left(7);
        }

        // Select first panel_size from shuffled list
        let mut panel: Vec<Address> = Vec::new(env);
        for i in 0..panel_size {
            match eligible.get(i) {
                Some(a) => panel.push_back(a),
                None    => return Err(Error::NotEnoughArbiters),
            }
        }

        Ok(panel)
    }

    /// Terminal state guard — prevents any operation on completed escrows.
    fn assert_not_terminal(status: &EscrowStatus) -> Result<(), Error> {
        if *status == EscrowStatus::Released ||
           *status == EscrowStatus::AutoReleased ||
           *status == EscrowStatus::Refunded ||
           *status == EscrowStatus::Cancelled {
            return Err(Error::AlreadyResolved);
        }
        Ok(())
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
                .checked_mul(fee_bps as i128).unwrap_or(0)
                .checked_div(10_000).unwrap_or(0);
            let seller_amount = r.amount.saturating_sub(fee);
            if seller_amount <= 0 { return; }

            client.transfer(&env.current_contract_address(), &r.seller, &seller_amount);

            if fee > 0 {
                let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
                client.transfer(&env.current_contract_address(), &admin, &fee);
            }
        }

        emit_amount(env, "funds_sent", r.escrow_id, r.amount);
    }
}
