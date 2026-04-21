//! Orchid Escrow — Soroban Contract v3
//!
//! ─── STATE MACHINE ───────────────────────────────────────────────────────────
//!
//!   create_escrow()          → FUNDED   (buyer creates + funds atomically)
//!
//!   FUNDED
//!     ├─ mark_delivered(seller) → DELIVERED  (seller signals delivery)
//!     ├─ cancel(buyer)          → CANCELLED  (only before delivery)
//!     ├─ dispute(either)        → DISPUTED   (requires arbitrator)
//!     └─ auto_release()         → AUTO_RELEASED (main deadline passed)
//!
//!   DELIVERED
//!     ├─ confirm_delivery(buyer) → RELEASED      (buyer confirms → seller paid)
//!     ├─ dispute(either)         → DISPUTED
//!     └─ auto_release_after_delivery() → AUTO_RELEASED (buyer timeout)
//!
//!   DISPUTED
//!     ├─ arbitrate(Release) → RELEASED
//!     └─ arbitrate(Refund)  → REFUNDED
//!
//!   TERMINAL: RELEASED | AUTO_RELEASED | REFUNDED | CANCELLED
//!
//! ─── CHANGES FROM v2 ─────────────────────────────────────────────────────────
//!   1. Added Delivered state — seller marks delivery before buyer can confirm
//!   2. confirm_delivery() now requires Delivered state (prevents random release)
//!   3. cancel() blocked after delivery (prevents buyer abuse)
//!   4. auto_release_after_delivery() — if buyer disappears after delivery
//!   5. funds_sent event emitted on every payout for verification
//!
//! ─── SECURITY ────────────────────────────────────────────────────────────────
//!   - State updated BEFORE every token transfer (reentrancy guard)
//!   - require_auth() on every mutating call
//!   - Terminal states reject all further calls
//!   - Overflow-safe: checked arithmetic

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol,
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64),
    Counter,
    Admin,
    FeeBps,
}

// ─── State Machine ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum EscrowStatus {
    Funded,
    Delivered,    // seller has marked delivery, awaiting buyer confirmation
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
    pub escrow_id:    u64,
    pub buyer:        Address,
    pub seller:       Address,
    pub arbitrator:   Option<Address>,
    pub token:        Address,
    pub amount:       i128,
    pub status:       EscrowStatus,
    /// Main deadline — auto_release() pays seller if buyer never confirms
    pub deadline:     u64,
    /// Delivery deadline — auto_release_after_delivery() fires after this
    /// Set to deadline by default; can be shorter for faster resolution
    pub delivery_deadline: u64,
    pub disputed_by:  Option<Address>,
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
    }

    // ── Create + Fund (atomic) ────────────────────────────────────────────────
    /// Buyer creates the escrow AND funds it in a single signed transaction.
    /// delivery_window_secs: how long after delivery buyer has to confirm
    ///   before auto_release_after_delivery() can fire (e.g. 3 days = 259200)
    pub fn create_escrow(
        env:                  Env,
        buyer:                Address,
        seller:               Address,
        arbitrator:           Option<Address>,
        token:                Address,
        amount:               i128,
        deadline:             u64,
        delivery_window_secs: u64,
    ) -> u64 {
        buyer.require_auth();

        assert!(amount > 0,                          "amount must be positive");
        assert!(buyer != seller,                     "buyer and seller must differ");
        assert!(deadline > env.ledger().timestamp(), "deadline must be in the future");
        assert!(delivery_window_secs > 0,            "delivery window must be positive");

        if let Some(ref arb) = arbitrator {
            assert!(arb != &buyer && arb != &seller, "arbitrator must be a third party");
        }

        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next_id = id.checked_add(1).expect("counter overflow");
        env.storage().instance().set(&DataKey::Counter, &next_id);

        let record = EscrowRecord {
            escrow_id:        next_id,
            buyer:            buyer.clone(),
            seller:           seller.clone(),
            arbitrator,
            token:            token.clone(),
            amount,
            status:           EscrowStatus::Funded,
            deadline,
            // delivery_deadline is set when seller calls mark_delivered
            // stored here as 0 until then
            delivery_deadline: delivery_window_secs, // window duration, not absolute time
            disputed_by:      None,
        };

        // State update BEFORE transfer (reentrancy guard)
        env.storage().persistent().set(&DataKey::Escrow(next_id), &record);

        // Fund atomically — buyer signs this transaction
        token::Client::new(&env, &token)
            .transfer(&buyer, &env.current_contract_address(), &amount);

        emit(&env, "escrow_created", next_id);
        emit(&env, "escrow_funded", next_id);

        next_id
    }

    // ── Mark Delivered ────────────────────────────────────────────────────────
    /// Seller signals that delivery is complete.
    /// Funded → Delivered
    /// After this, buyer has delivery_window_secs to confirm before auto-release.
    pub fn mark_delivered(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(caller == r.seller,                 "only seller can mark delivered");
        assert!(r.status == EscrowStatus::Funded,   "must be in Funded state");

        // Set the absolute delivery deadline = now + window
        let delivery_deadline = env.ledger().timestamp()
            .checked_add(r.delivery_deadline).expect("overflow");
        r.delivery_deadline = delivery_deadline;
        r.status = EscrowStatus::Delivered;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit(&env, "marked_delivered", escrow_id);
    }

    // ── Confirm Delivery ──────────────────────────────────────────────────────
    /// Buyer confirms delivery. Requires Delivered state.
    /// Funds sent to seller immediately.
    pub fn confirm_delivery(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(caller == r.buyer,                    "only buyer can confirm delivery");
        // CRITICAL: must be Delivered first — buyer cannot randomly release
        assert!(r.status == EscrowStatus::Delivered,  "seller must mark delivered first");

        r.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);

        emit(&env, "escrow_released", escrow_id);
    }

    // ── Approve (backward-compat alias) ───────────────────────────────────────
    /// Kept for frontend compatibility.
    /// Buyer calling approve() after delivery = confirm_delivery.
    pub fn approve(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let r = Self::load(&env, escrow_id);

        if caller == r.buyer && r.status == EscrowStatus::Delivered {
            // Delegate to confirm_delivery
            let mut r = r;
            r.status = EscrowStatus::Released;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            Self::pay_seller(&env, &r);
            emit(&env, "escrow_released", escrow_id);
        } else if caller == r.seller && r.status == EscrowStatus::Funded {
            // Seller calling approve = mark_delivered
            let delivery_deadline = env.ledger().timestamp()
                .checked_add(r.delivery_deadline).expect("overflow");
            let mut r = r;
            r.delivery_deadline = delivery_deadline;
            r.status = EscrowStatus::Delivered;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            emit(&env, "marked_delivered", escrow_id);
        } else {
            emit(&env, "approval_recorded", escrow_id);
        }
    }

    // ── Cancel ────────────────────────────────────────────────────────────────
    /// Buyer cancels — only allowed in Funded state (before delivery).
    /// Once seller marks delivered, buyer cannot cancel.
    pub fn cancel(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(caller == r.buyer,                  "only buyer can cancel");
        // Restricted to Funded only — cannot cancel after delivery
        assert!(r.status == EscrowStatus::Funded,   "cannot cancel after delivery is marked");
        assert!(env.ledger().timestamp() < r.deadline, "deadline passed — use auto_release");

        r.status = EscrowStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);

        emit(&env, "escrow_cancelled", escrow_id);
    }

    // ── Auto Release After Delivery ───────────────────────────────────────────
    /// If buyer disappears after seller marks delivered, anyone can call this
    /// after the delivery deadline to release funds to seller.
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

    // ── Auto Release ──────────────────────────────────────────────────────────
    /// Main deadline fallback — if buyer never confirmed and seller never
    /// marked delivered, anyone can call after deadline to pay seller.
    pub fn auto_release(env: Env, escrow_id: u64) {
        let mut r = Self::load(&env, escrow_id);

        assert!(
            r.status == EscrowStatus::Funded || r.status == EscrowStatus::Delivered,
            "must be Funded or Delivered"
        );
        assert!(
            env.ledger().timestamp() >= r.deadline,
            "main deadline not reached yet"
        );

        r.status = EscrowStatus::AutoReleased;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);
        emit(&env, "auto_released", escrow_id);
    }

    // ── Dispute ───────────────────────────────────────────────────────────────
    /// Either party raises a dispute. Works from Funded or Delivered state.
    pub fn dispute(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(
            r.status == EscrowStatus::Funded || r.status == EscrowStatus::Delivered,
            "must be Funded or Delivered"
        );
        assert!(
            caller == r.buyer || caller == r.seller,
            "only buyer or seller can raise a dispute"
        );
        assert!(r.arbitrator.is_some(), "no arbitrator set for this escrow");

        r.status = EscrowStatus::Disputed;
        r.disputed_by = Some(caller.clone());
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit(&env, "escrow_disputed", escrow_id);
    }

    // ── Arbitrate ─────────────────────────────────────────────────────────────
    pub fn arbitrate(
        env:       Env,
        escrow_id: u64,
        caller:    Address,
        decision:  ArbitratorDecision,
    ) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Disputed, "must be in Disputed state");
        let arb = r.arbitrator.clone().expect("no arbitrator");
        assert!(caller == arb, "only arbitrator can resolve");

        match decision {
            ArbitratorDecision::Release => {
                r.status = EscrowStatus::Released;
                env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
                Self::pay_seller(&env, &r);
                emit(&env, "arbitrated_release", escrow_id);
            }
            ArbitratorDecision::Refund => {
                r.status = EscrowStatus::Refunded;
                env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
                token::Client::new(&env, &r.token)
                    .transfer(&env.current_contract_address(), &r.buyer, &r.amount);
                emit(&env, "arbitrated_refund", escrow_id);
            }
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    pub fn set_fee(env: Env, new_fee_bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(new_fee_bps <= 500, "fee cannot exceed 5%");
        env.storage().instance().set(&DataKey::FeeBps, &new_fee_bps);
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

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    fn load(env: &Env, escrow_id: u64) -> EscrowRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"))
    }

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

        // Emit funds_sent event for verification
        emit_amount(env, "funds_sent", r.escrow_id, r.amount);
    }
}
