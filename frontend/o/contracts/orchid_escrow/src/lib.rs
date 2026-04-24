//! Orchid Escrow — Soroban Contract v4 (Production)
//!
//! ─── CLEAN STATE MACHINE ─────────────────────────────────────────────────────
//!
//!   create_escrow()              → FUNDED  (buyer creates + funds atomically)
//!
//!   FUNDED
//!     ├─ mark_delivered(seller)  → DELIVERED
//!     ├─ cancel(buyer)           → CANCELLED  (before deadline only)
//!     └─ refund_after_deadline() → REFUNDED   (buyer, after deadline, seller never delivered)
//!
//!   DELIVERED
//!     ├─ confirm_delivery(buyer) → RELEASED      (buyer confirms → seller paid)
//!     ├─ dispute(either)         → DISPUTED
//!     └─ auto_release_after_delivery() → AUTO_RELEASED (buyer timeout after delivery)
//!
//!   DISPUTED
//!     ├─ arbitrate(Release)      → RELEASED
//!     └─ arbitrate(Refund)       → REFUNDED
//!
//!   TERMINAL: RELEASED | AUTO_RELEASED | REFUNDED | CANCELLED
//!
//! ─── CHANGES FROM v3 ─────────────────────────────────────────────────────────
//!   1. auto_release() DELETED — was dangerous (paid seller without delivery)
//!   2. refund_after_deadline() ADDED — buyer protection if seller never delivers
//!   3. delivery_deadline split into delivery_window_secs + delivery_deadline
//!   4. approve() REMOVED — was confusing and duplicated logic
//!   5. assert_not_terminal() helper added — clean terminal state guard
//!   6. cancel() error message updated to reference refund_after_deadline
//!   7. funds_sent event on every payout for verification

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol, Vec,
};

const MIN_ARBITER_STAKE: i128 = 1_000_000; // Minimum stake to register as arbiter

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
    Vote(u64, Address),       // (escrow_id, arbitrator) -> ArbitratorDecision
    ArbiterStake(Address),    // arbitrator address -> stake amount
    ArbiterList,              // Vec<Address> of all registered arbiters
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
    /// Anyone can register as an arbiter by declaring a stake amount.
    /// For demo: stake is recorded on-chain. Full token transfer in production.
    pub fn register_arbiter(env: Env, arbiter: Address, amount: i128) {
        arbiter.require_auth();
        Self::assert_not_paused(&env);
        assert!(amount >= MIN_ARBITER_STAKE, "insufficient stake — minimum 1_000_000 stroops");

        let existing_stake: i128 = env.storage().persistent()
            .get(&DataKey::ArbiterStake(arbiter.clone()))
            .unwrap_or(0);

        env.storage().persistent()
            .set(&DataKey::ArbiterStake(arbiter.clone()), &(existing_stake + amount));

        // Add to list only if new registrant
        if existing_stake == 0 {
            let mut list: Vec<Address> = env.storage().instance()
                .get(&DataKey::ArbiterList)
                .unwrap_or(Vec::new(&env));
            list.push_back(arbiter.clone());
            env.storage().instance().set(&DataKey::ArbiterList, &list);
        }

        env.events().publish(
            (Symbol::new(&env, "arbiter_registered"), arbiter),
            amount,
        );
    }

    // ── Create + Fund (atomic) ────────────────────────────────────────────────
    /// Buyer creates AND funds the escrow in one signed transaction.
    /// deadline: absolute timestamp — if seller never delivers, buyer refunds after this
    /// delivery_window_secs: how long buyer has to confirm after seller marks delivered
    pub fn create_escrow(
        env:                  Env,
        buyer:                Address,
        seller:               Address,
        arbitrators:          soroban_sdk::Vec<Address>, // Panel of arbitrators
        token:                Address,
        amount:               i128,
        deadline:             u64,
        delivery_window_secs: u64,
    ) -> u64 {
        buyer.require_auth();
        Self::assert_not_paused(&env);

        assert!(amount > 0,                          "amount must be positive");
        assert!(buyer != seller,                     "buyer and seller must differ");
        assert!(deadline > env.ledger().timestamp(), "deadline must be in the future");
        assert!(delivery_window_secs > 0,            "delivery window must be positive");
        assert!(arbitrators.len() >= 1,              "at least one arbitrator required");
        assert!(arbitrators.len() <= 7,              "too many arbitrators");
        assert!(arbitrators.len() % 2 == 1,          "arbitrator count must be odd for majority");

        // Verify all arbitrators are third parties and no duplicates
        // Note: registry check is optional for demo — register via register_arbiter() for staking
        for i in 0..arbitrators.len() {
            let arb_i = arbitrators.get(i).unwrap();
            assert!(arb_i != buyer && arb_i != seller, "arbitrator must be a third party");

            // Check for duplicates
            for j in (i + 1)..arbitrators.len() {
                let arb_j = arbitrators.get(j).unwrap();
                assert!(arb_i != arb_j, "duplicate arbitrator");
            }
        }

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
            delivery_window_secs, // duration stored separately
            delivery_deadline:    0, // set when seller calls mark_delivered
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
        assert!(r.arbitrators.len() > 0, "no arbitrators set for this escrow");

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

    /// Get all registered arbiters
    pub fn get_arbiters(env: Env) -> Vec<Address> {
        env.storage().instance()
            .get(&DataKey::ArbiterList)
            .unwrap_or(Vec::new(&env))
    }

    /// Get stake amount for a specific arbiter
    pub fn get_arbiter_stake(env: Env, arbiter: Address) -> i128 {
        env.storage().persistent()
            .get(&DataKey::ArbiterStake(arbiter))
            .unwrap_or(0)
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
