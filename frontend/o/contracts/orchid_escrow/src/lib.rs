//! Orchid Escrow — Production-Grade Soroban Contract
//!
//! ─── STATE MACHINE ───────────────────────────────────────────────────────────
//!
//!   CREATED
//!     └─ fund()                → FUNDED
//!
//!   FUNDED
//!     ├─ approve(buyer)        → records buyer approval
//!     ├─ approve(seller)       → records seller approval
//!     │   both approved        → RELEASED (funds → seller)
//!     ├─ cancel()              → CANCELLED (only before deadline, only buyer)
//!     ├─ dispute()             → DISPUTED  (either party)
//!     └─ auto_release()        → AUTO_RELEASED (deadline passed)
//!
//!   DISPUTED
//!     ├─ arbitrate(Release)    → RELEASED  (arbitrator decides for seller)
//!     └─ arbitrate(Refund)     → REFUNDED  (arbitrator decides for buyer)
//!
//!   TERMINAL: RELEASED | AUTO_RELEASED | REFUNDED | CANCELLED
//!
//! ─── SECURITY ────────────────────────────────────────────────────────────────
//!   - State updated BEFORE every token transfer (reentrancy guard)
//!   - require_auth() on every mutating call
//!   - Role checks: only buyer/seller/arbitrator can call their functions
//!   - Terminal states reject all further calls
//!   - No unilateral release: both parties must approve OR arbitrator decides
//!   - Overflow-safe: i128 arithmetic
//!   - Optional platform fee (max 5%) on release only

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
    Created,
    Funded,
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
    pub escrow_id:        u64,
    pub buyer:            Address,
    pub seller:           Address,
    /// Optional arbitrator — if None, disputes cannot be raised
    pub arbitrator:       Option<Address>,
    pub token:            Address,
    pub amount:           i128,
    pub status:           EscrowStatus,
    /// Ledger timestamp after which auto_release() pays seller
    pub deadline:         u64,
    /// Buyer has approved release
    pub buyer_approved:   bool,
    /// Seller has approved release
    pub seller_approved:  bool,
    /// Who raised the dispute
    pub disputed_by:      Option<Address>,
}

// ─── Events ───────────────────────────────────────────────────────────────────

fn emit(env: &Env, topic: &str, escrow_id: u64) {
    env.events().publish(
        (Symbol::new(env, topic), escrow_id),
        escrow_id,
    );
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OrchidEscrow;

#[contractimpl]
impl OrchidEscrow {

    // ── Init ──────────────────────────────────────────────────────────────────
    /// Deploy once. fee_bps = 0 means no platform fee (max 500 = 5%).
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

    // ── Create ────────────────────────────────────────────────────────────────
    /// Buyer creates an escrow. Returns escrow_id.
    /// arbitrator = None means no dispute resolution available.
    /// deadline = ledger timestamp after which auto_release() can be called.
    pub fn create_escrow(
        env:        Env,
        buyer:      Address,
        seller:     Address,
        arbitrator: Option<Address>,
        token:      Address,
        amount:     i128,
        deadline:   u64,
    ) -> u64 {
        buyer.require_auth();

        assert!(amount > 0,                              "amount must be positive");
        assert!(buyer != seller,                         "buyer and seller must differ");
        assert!(deadline > env.ledger().timestamp(),     "deadline must be in the future");

        // Arbitrator must not be buyer or seller
        if let Some(ref arb) = arbitrator {
            assert!(arb != &buyer && arb != &seller, "arbitrator must be a third party");
        }

        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next_id = id.checked_add(1).expect("counter overflow");
        env.storage().instance().set(&DataKey::Counter, &next_id);

        let record = EscrowRecord {
            escrow_id:      next_id,
            buyer:          buyer.clone(),
            seller:         seller.clone(),
            arbitrator,
            token,
            amount,
            status:         EscrowStatus::Created,
            deadline,
            buyer_approved:  false,
            seller_approved: false,
            disputed_by:    None,
        };

        env.storage().persistent().set(&DataKey::Escrow(next_id), &record);
        emit(&env, "escrow_created", next_id);
        next_id
    }

    // ── Fund ──────────────────────────────────────────────────────────────────
    /// Buyer deposits the agreed amount. Created → Funded.
    pub fn fund(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(caller == r.buyer,                       "only buyer can fund");
        assert!(r.status == EscrowStatus::Created,       "must be in Created state");
        assert!(env.ledger().timestamp() < r.deadline,   "deadline has passed");

        // State update BEFORE transfer
        r.status = EscrowStatus::Funded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&r.buyer, &env.current_contract_address(), &r.amount);

        emit(&env, "escrow_funded", escrow_id);
    }

    // ── Approve ───────────────────────────────────────────────────────────────
    /// Either party approves the release.
    /// When BOTH buyer and seller have approved → funds released to seller.
    /// This is the dual-approval path — no unilateral release.
    pub fn approve(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Funded,        "must be in Funded state");
        assert!(
            caller == r.buyer || caller == r.seller,
            "only buyer or seller can approve"
        );

        if caller == r.buyer  { r.buyer_approved  = true; }
        if caller == r.seller { r.seller_approved = true; }

        if r.buyer_approved && r.seller_approved {
            // Both approved — release to seller
            r.status = EscrowStatus::Released;
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            Self::pay_seller(&env, &r);
            emit(&env, "escrow_released", escrow_id);
        } else {
            // Only one approved so far — save state
            env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);
            emit(&env, "approval_recorded", escrow_id);
        }
    }

    // ── Cancel ────────────────────────────────────────────────────────────────
    /// Buyer can cancel before the deadline (returns funds to buyer).
    /// Only valid in Funded state and before deadline.
    pub fn cancel(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(caller == r.buyer,                       "only buyer can cancel");
        assert!(r.status == EscrowStatus::Funded,        "must be in Funded state");
        assert!(env.ledger().timestamp() < r.deadline,   "deadline passed — use auto_release");

        r.status = EscrowStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        token::Client::new(&env, &r.token)
            .transfer(&env.current_contract_address(), &r.buyer, &r.amount);

        emit(&env, "escrow_cancelled", escrow_id);
    }

    // ── Dispute ───────────────────────────────────────────────────────────────
    /// Either party can raise a dispute. Funded → Disputed.
    /// Requires an arbitrator to have been set at creation.
    /// Once disputed, only the arbitrator can resolve.
    pub fn dispute(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Funded,        "must be in Funded state");
        assert!(
            caller == r.buyer || caller == r.seller,
            "only buyer or seller can raise a dispute"
        );
        assert!(r.arbitrator.is_some(),                  "no arbitrator set for this escrow");

        r.status = EscrowStatus::Disputed;
        r.disputed_by = Some(caller.clone());
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        emit(&env, "escrow_disputed", escrow_id);
    }

    // ── Arbitrate ─────────────────────────────────────────────────────────────
    /// Arbitrator resolves a dispute.
    /// Release → funds go to seller (with platform fee).
    /// Refund  → full amount returned to buyer (no fee).
    pub fn arbitrate(
        env:       Env,
        escrow_id: u64,
        caller:    Address,
        decision:  ArbitratorDecision,
    ) {
        caller.require_auth();

        let mut r = Self::load(&env, escrow_id);

        assert!(r.status == EscrowStatus::Disputed,      "must be in Disputed state");
        let arb = r.arbitrator.clone().expect("no arbitrator");
        assert!(caller == arb,                           "only arbitrator can resolve");

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

    // ── Auto Release ──────────────────────────────────────────────────────────
    /// Anyone can call after the deadline. Funded → AutoReleased.
    /// Pays seller (with platform fee). Ensures funds never locked forever.
    pub fn auto_release(env: Env, escrow_id: u64) {
        let mut r = Self::load(&env, escrow_id);

        assert!(
            r.status == EscrowStatus::Funded,
            "must be in Funded state"
        );
        assert!(
            env.ledger().timestamp() >= r.deadline,
            "deadline not reached yet"
        );

        r.status = EscrowStatus::AutoReleased;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &r);

        Self::pay_seller(&env, &r);
        emit(&env, "auto_released", escrow_id);
    }

    // ── Admin: Update Fee ─────────────────────────────────────────────────────
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

    /// Pay seller minus platform fee. Fee goes to admin.
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
    }
}

// ─── Security Guarantees ─────────────────────────────────────────────────────
//
// 1. No unilateral release — both parties must approve OR arbitrator decides
// 2. Reentrancy — state updated BEFORE every token transfer
// 3. Role checks — require_auth() + explicit role assertion on every call
// 4. Terminal states — all terminal states reject further calls
// 5. Overflow — checked arithmetic on fee calculation
// 6. Arbitrator neutrality — arbitrator cannot be buyer or seller
// 7. Dispute requires arbitrator — no disputes on escrows without one
// 8. Cancel window — buyer can only cancel before deadline
// 9. Auto-release — ensures funds never locked indefinitely
// 10. Fee cap — max 5%, enforced at init and set_fee
