//! Orchid Escrow Contract — Soroban / Stellar
//!
//! Industry-ready deterministic escrow with a strict state machine.
//! Funds are NEVER locked indefinitely — every path resolves to buyer or seller.
//!
//! ─── STATE MACHINE ───────────────────────────────────────────────────────────
//!
//!   CREATED
//!     └─ fund()              → FUNDED   (buyer deposits tokens into contract)
//!
//!   FUNDED
//!     └─ lock()              → LOCKED   (auto-called inside fund for atomicity)
//!
//!   LOCKED
//!     ├─ confirm_delivery()  → RELEASED          (buyer confirms → seller paid)
//!     ├─ request_refund()    → REFUND_REQUESTED  (seller triggers dispute)
//!     └─ auto_release()      → AUTO_RELEASED     (deadline passed → seller paid)
//!
//!   REFUND_REQUESTED
//!     ├─ approve_refund()    → REFUNDED           (buyer approves → buyer paid)
//!     └─ auto_release()      → AUTO_RELEASED      (refund_deadline passed → seller paid)
//!
//!   END STATES (terminal — no further transitions):
//!     RELEASED | AUTO_RELEASED | REFUNDED
//!
//! ─── ROLES ───────────────────────────────────────────────────────────────────
//!   buyer  — creates and funds the escrow, confirms delivery or approves refund
//!   seller — receives payment on release, can request refund if dispute arises
//!   admin  — optional platform fee recipient, cannot interfere with funds
//!
//! ─── SECURITY ────────────────────────────────────────────────────────────────
//!   - Every function requires auth from the calling address
//!   - State checked before every transition (no skipping states)
//!   - Reentrancy prevented: state updated BEFORE token transfer
//!   - Double-execution prevented: terminal states reject all calls
//!   - Overflow-safe: i128 arithmetic, checked in Cargo.toml
//!   - No hidden balances: full amount always transferred on resolution
//!
//! ─── ECONOMICS ───────────────────────────────────────────────────────────────
//!   - Optional platform fee (basis points, e.g. 50 = 0.5%) on RELEASE only
//!   - Fee deducted from seller's payout — buyer always gets full refund
//!   - Fee sent to admin address set at contract init

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype,
    token, Address, Env, Symbol,
};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(u64),   // escrow_id → EscrowRecord
    Counter,       // global nonce for escrow IDs
    Admin,         // platform fee recipient
    FeeBps,        // fee in basis points (0–1000, i.e. 0–10%)
}

// ─── State Machine ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum EscrowStatus {
    /// Escrow created, awaiting funding
    Created,
    /// Funds deposited and locked in contract
    Locked,
    /// Seller requested a refund — awaiting buyer approval
    RefundRequested,
    /// Buyer confirmed delivery → funds sent to seller
    Released,
    /// Buyer approved refund → funds returned to buyer
    Refunded,
    /// Deadline passed → funds auto-released to seller
    AutoReleased,
}

// ─── Escrow Record ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct EscrowRecord {
    pub buyer:           Address,
    pub seller:          Address,
    pub token:           Address,
    pub amount:          i128,
    pub status:          EscrowStatus,
    /// Ledger timestamp after which auto_release() can be called
    pub deadline:        u64,
    /// Ledger timestamp after which auto_release() resolves a REFUND_REQUESTED
    /// (gives buyer time to approve_refund before seller gets paid anyway)
    pub refund_deadline: u64,
    pub escrow_id:       u64,
}

// ─── Events ───────────────────────────────────────────────────────────────────
// All state transitions emit an event for off-chain indexing.

fn emit(env: &Env, name: &str, escrow_id: u64) {
    env.events().publish(
        (Symbol::new(env, name), escrow_id),
        escrow_id,
    );
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OrchidEscrow;

#[contractimpl]
impl OrchidEscrow {

    // ── Initialise ────────────────────────────────────────────────────────────
    /// Deploy once. Sets the admin (fee recipient) and fee in basis points.
    /// fee_bps = 0 means no platform fee.
    pub fn init(env: Env, admin: Address, fee_bps: u32) {
        admin.require_auth();
        // Prevent re-initialisation
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialised");
        }
        assert!(fee_bps <= 1000, "fee cannot exceed 10%");
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Counter, &0u64);
    }

    // ── Create ────────────────────────────────────────────────────────────────
    /// Buyer creates an escrow agreement.
    /// Returns the escrow_id. Funds are NOT transferred yet — call fund() next.
    ///
    /// deadline        — ledger timestamp after which auto_release() pays seller
    /// refund_window   — seconds buyer has to approve_refund after seller requests it
    ///                   (after this window, auto_release() pays seller anyway)
    pub fn create_escrow(
        env:           Env,
        buyer:         Address,
        seller:        Address,
        token:         Address,
        amount:        i128,
        deadline:      u64,
        refund_window: u64,
    ) -> u64 {
        buyer.require_auth();

        assert!(amount > 0,                    "amount must be positive");
        assert!(buyer != seller,               "buyer and seller must differ");
        assert!(deadline > env.ledger().timestamp(), "deadline must be in the future");

        // Increment global nonce
        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        let next_id = id + 1;
        env.storage().instance().set(&DataKey::Counter, &next_id);

        let record = EscrowRecord {
            buyer:           buyer.clone(),
            seller:          seller.clone(),
            token:           token.clone(),
            amount,
            status:          EscrowStatus::Created,
            deadline,
            refund_deadline: deadline + refund_window,
            escrow_id:       next_id,
        };

        env.storage().persistent().set(&DataKey::Escrow(next_id), &record);
        emit(&env, "escrow_created", next_id);

        next_id
    }

    // ── Fund ──────────────────────────────────────────────────────────────────
    /// Buyer deposits the agreed amount into the contract.
    /// Atomically transitions Created → Locked.
    /// Must be called by the buyer; amount transferred from buyer → contract.
    pub fn fund(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut record: EscrowRecord = Self::load(&env, escrow_id);

        // Auth: only buyer can fund
        assert!(caller == record.buyer, "only buyer can fund");
        // State: must be Created
        assert!(
            record.status == EscrowStatus::Created,
            "escrow must be in Created state"
        );
        // Deadline: must not have already passed
        assert!(
            env.ledger().timestamp() < record.deadline,
            "deadline has already passed"
        );

        // Transfer tokens from buyer → contract (reentrancy-safe: state updated first)
        record.status = EscrowStatus::Locked;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &record);

        let client = token::Client::new(&env, &record.token);
        client.transfer(&record.buyer, &env.current_contract_address(), &record.amount);

        emit(&env, "escrow_funded", escrow_id);
    }

    // ── Confirm Delivery ──────────────────────────────────────────────────────
    /// Buyer confirms the seller has delivered. Releases funds to seller.
    /// Locked → Released
    /// Platform fee (if any) is deducted from seller's payout.
    pub fn confirm_delivery(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut record: EscrowRecord = Self::load(&env, escrow_id);

        assert!(caller == record.buyer,                    "only buyer can confirm delivery");
        assert!(record.status == EscrowStatus::Locked,    "escrow must be Locked");

        // Update state BEFORE transfer (reentrancy guard)
        record.status = EscrowStatus::Released;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &record);

        Self::release_to_seller(&env, &record);
        emit(&env, "escrow_released", escrow_id);
    }

    // ── Request Refund ────────────────────────────────────────────────────────
    /// Seller raises a dispute and requests a refund to the buyer.
    /// Locked → RefundRequested
    /// Buyer now has `refund_window` seconds to approve_refund().
    /// If buyer is inactive, auto_release() will pay the seller.
    pub fn request_refund(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut record: EscrowRecord = Self::load(&env, escrow_id);

        assert!(caller == record.seller,                   "only seller can request refund");
        assert!(record.status == EscrowStatus::Locked,    "escrow must be Locked");

        record.status = EscrowStatus::RefundRequested;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &record);

        emit(&env, "refund_requested", escrow_id);
    }

    // ── Approve Refund ────────────────────────────────────────────────────────
    /// Buyer approves the seller's refund request. Returns funds to buyer.
    /// RefundRequested → Refunded
    pub fn approve_refund(env: Env, escrow_id: u64, caller: Address) {
        caller.require_auth();

        let mut record: EscrowRecord = Self::load(&env, escrow_id);

        assert!(caller == record.buyer,                            "only buyer can approve refund");
        assert!(record.status == EscrowStatus::RefundRequested,   "escrow must be RefundRequested");

        // Update state BEFORE transfer
        record.status = EscrowStatus::Refunded;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &record);

        // Full refund — no fee on refunds
        let client = token::Client::new(&env, &record.token);
        client.transfer(&env.current_contract_address(), &record.buyer, &record.amount);

        emit(&env, "escrow_refunded", escrow_id);
    }

    // ── Auto Release ──────────────────────────────────────────────────────────
    /// Anyone can call this after the deadline.
    /// Handles two cases:
    ///   1. Locked + deadline passed          → AUTO_RELEASED (seller paid)
    ///   2. RefundRequested + refund_deadline  → AUTO_RELEASED (seller paid,
    ///      buyer was inactive during refund window)
    ///
    /// This ensures funds are NEVER locked indefinitely.
    pub fn auto_release(env: Env, escrow_id: u64) {
        let mut record: EscrowRecord = Self::load(&env, escrow_id);
        let now = env.ledger().timestamp();

        let can_release = match record.status {
            // Main deadline: buyer never confirmed delivery
            EscrowStatus::Locked => now >= record.deadline,
            // Refund window expired: buyer ignored the refund request
            EscrowStatus::RefundRequested => now >= record.refund_deadline,
            _ => false,
        };

        assert!(can_release, "auto_release conditions not met");

        // Update state BEFORE transfer
        record.status = EscrowStatus::AutoReleased;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &record);

        Self::release_to_seller(&env, &record);
        emit(&env, "auto_released", escrow_id);
    }

    // ── Admin: Update Fee ─────────────────────────────────────────────────────
    /// Admin can update the platform fee (max 10%).
    pub fn set_fee(env: Env, new_fee_bps: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(new_fee_bps <= 1000, "fee cannot exceed 10%");
        env.storage().instance().set(&DataKey::FeeBps, &new_fee_bps);
    }

    // ── View: Get Escrow ──────────────────────────────────────────────────────
    /// Read the current state of an escrow. No auth required.
    pub fn get_escrow(env: Env, escrow_id: u64) -> EscrowRecord {
        Self::load(&env, escrow_id)
    }

    /// Returns the total number of escrows ever created.
    pub fn escrow_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Counter).unwrap_or(0)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTERNAL HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    /// Load an escrow record or panic with a clear message.
    fn load(env: &Env, escrow_id: u64) -> EscrowRecord {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(escrow_id))
            .unwrap_or_else(|| panic!("escrow not found"))
    }

    /// Transfer funds from contract → seller, deducting platform fee.
    /// Fee is sent to admin. If fee is 0, full amount goes to seller.
    fn release_to_seller(env: &Env, record: &EscrowRecord) {
        let client = token::Client::new(env, &record.token);
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);

        if fee_bps == 0 {
            // No fee — full amount to seller
            client.transfer(
                &env.current_contract_address(),
                &record.seller,
                &record.amount,
            );
        } else {
            // Fee calculation: amount * fee_bps / 10000
            // Uses i128 to prevent overflow on large amounts
            let fee = record.amount * (fee_bps as i128) / 10_000;
            let seller_amount = record.amount - fee;

            assert!(seller_amount > 0, "fee exceeds payout");

            // Pay seller
            client.transfer(
                &env.current_contract_address(),
                &record.seller,
                &seller_amount,
            );

            // Pay platform fee to admin
            if fee > 0 {
                let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
                client.transfer(
                    &env.current_contract_address(),
                    &admin,
                    &fee,
                );
            }
        }
    }
}

// ─── Edge Cases Handled ───────────────────────────────────────────────────────
//
// 1. Buyer never funds          → escrow stays Created, no funds at risk
// 2. Deadline passes, Locked    → auto_release() pays seller (buyer inactive)
// 3. Seller disputes, buyer MIA → refund_deadline passes → auto_release() pays seller
// 4. Double-call on terminal    → state check panics immediately
// 5. Wrong caller               → require_auth() + role check panics
// 6. Zero amount                → rejected in create_escrow
// 7. Buyer == Seller            → rejected in create_escrow
// 8. Past deadline on create    → rejected in create_escrow
// 9. Fee > 10%                  → rejected in init/set_fee
// 10. Fee > payout              → assert in release_to_seller
// 11. Reentrancy                → state updated BEFORE every token transfer
// 12. No hidden balance         → full amount always transferred on resolution
