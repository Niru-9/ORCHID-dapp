#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};
const LTV_RATIO: i128 = 6_600;
const MIN_HEALTH: i128 = 10_000;
const LIQUIDATION_BONUS: i128 = 500;
const BASE_BORROW_RATE: i128 = 500;
const RATE_SLOPE: i128 = 2_000;
const SECONDS_PER_YEAR: i128 = 31_536_000;
const MAX_LOANS: u32 = 3;
const PROTOCOL_FEE_BPS: i128 = 2_000;
const BPS: i128 = 10_000;
const EARLY_PENALTY_BPS: i128 = 1_000;
#[contracttype] #[derive(Clone)] pub enum DataKey { PoolState, Supply(Address), Collateral(Address), Loan(Address, u64), LoanCounter(Address), FD(Address, u64), FDCounter(Address), CreditScore(Address), Admin, Token, ProtocolFees }
#[contracttype] #[derive(Clone, Default)] pub struct PoolState { pub total_supplied: i128, pub total_borrowed: i128, pub total_lp_shares: i128, pub last_update: u64, pub accumulated_rate: i128 }
#[contracttype] #[derive(Clone)] pub struct SupplyPosition { pub lp_shares: i128, pub deposited_at: u64, pub apy_snapshot: i128 }
#[contracttype] #[derive(Clone)] pub struct CollateralPosition { pub amount: i128, pub deposited_at: u64 }
#[contracttype] #[derive(Clone, PartialEq)] pub enum LoanStatus { Active, Repaid, Liquidated }
#[contracttype] #[derive(Clone)] pub struct Loan { pub id: u64, pub borrower: Address, pub principal: i128, pub apy_bps: i128, pub rate_index_at: i128, pub originated_at: u64, pub due_date: u64, pub amount_repaid: i128, pub status: LoanStatus }
#[contracttype] #[derive(Clone, PartialEq)] pub enum FDStatus { Active, Claimed, EarlyWithdrawn }
#[contracttype] #[derive(Clone)] pub struct FixedDeposit { pub id: u64, pub owner: Address, pub principal: i128, pub apy_bps: i128, pub locked_at: u64, pub matures_at: u64, pub payout: i128, pub status: FDStatus }
#[contracttype] #[derive(Clone)] pub struct HealthInfo { pub collateral: i128, pub total_debt: i128, pub health_factor: i128, pub max_borrow: i128 }
#[contract] pub struct OrchidPool;
#[contractimpl] impl OrchidPool {
pub fn init(env: Env, admin: Address, token: Address) {
    admin.require_auth();
    if env.storage().instance().has(&DataKey::Admin) { panic!("already initialised"); }
    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().instance().set(&DataKey::Token, &token);
    env.storage().instance().set(&DataKey::ProtocolFees, &0i128);
    let pool = PoolState { total_supplied: 0, total_borrowed: 0, total_lp_shares: 0, last_update: env.ledger().timestamp(), accumulated_rate: BPS };
    env.storage().instance().set(&DataKey::PoolState, &pool);
}
fn accrue(env: &Env) -> PoolState {
    let mut pool: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
    let now = env.ledger().timestamp();
    let elapsed = (now - pool.last_update) as i128;
    if elapsed > 0 && pool.total_supplied > 0 {
        let rate = Self::borrow_rate(pool.total_borrowed, pool.total_supplied);
        let delta = pool.accumulated_rate * rate * elapsed / BPS / SECONDS_PER_YEAR;
        pool.accumulated_rate += delta;
    }
    pool.last_update = now;
    env.storage().instance().set(&DataKey::PoolState, &pool);
    pool
}
fn borrow_rate(borrowed: i128, supplied: i128) -> i128 {
    if supplied == 0 { return BASE_BORROW_RATE; }
    let util = borrowed * BPS / supplied;
    BASE_BORROW_RATE + util * RATE_SLOPE / BPS
}
fn supply_apy(borrowed: i128, supplied: i128) -> i128 {
    if supplied == 0 { return BASE_BORROW_RATE * 80 / 100; }
    let util = borrowed * BPS / supplied;
    let br = BASE_BORROW_RATE + util * RATE_SLOPE / BPS;
    br * util / BPS * (BPS - PROTOCOL_FEE_BPS) / BPS
}
fn hf(env: &Env, user: &Address, pool: &PoolState) -> i128 {
    let col = Self::col(env, user);
    let debt = Self::debt(env, user, pool);
    if debt == 0 { return i128::MAX; }
    col * LTV_RATIO / debt
}
fn debt(env: &Env, user: &Address, pool: &PoolState) -> i128 {
    let count: u64 = env.storage().persistent().get(&DataKey::LoanCounter(user.clone())).unwrap_or(0);
    let mut total = 0i128;
    for i in 1..=count {
        if let Some(loan) = env.storage().persistent().get::<DataKey, Loan>(&DataKey::Loan(user.clone(), i)) {
            if loan.status == LoanStatus::Active {
                let factor = pool.accumulated_rate - loan.rate_index_at;
                let accrued = loan.principal * factor / BPS;
                total += loan.principal + accrued - loan.amount_repaid;
            }
        }
    }
    total
}
fn col(env: &Env, user: &Address) -> i128 {
    env.storage().persistent().get::<DataKey, CollateralPosition>(&DataKey::Collateral(user.clone())).map(|c| c.amount).unwrap_or(0)
}
fn active_loans(env: &Env, user: &Address) -> u32 {
    let count: u64 = env.storage().persistent().get(&DataKey::LoanCounter(user.clone())).unwrap_or(0);
    let mut n = 0u32;
    for i in 1..=count {
        if let Some(l) = env.storage().persistent().get::<DataKey, Loan>(&DataKey::Loan(user.clone(), i)) {
            if l.status == LoanStatus::Active { n += 1; }
        }
    }
    n
}
fn tok(env: &Env) -> Address { env.storage().instance().get(&DataKey::Token).unwrap() }
pub fn deposit(env: Env, lender: Address, amount: i128) {
    lender.require_auth();
    assert!(amount > 0, "amount must be positive");
    let pool = Self::accrue(&env);
    let shares = if pool.total_lp_shares == 0 || pool.total_supplied == 0 { amount } else { amount * pool.total_lp_shares / pool.total_supplied };
    let mut pool = pool;
    pool.total_supplied += amount;
    pool.total_lp_shares += shares;
    env.storage().instance().set(&DataKey::PoolState, &pool);
    let existing: Option<SupplyPosition> = env.storage().persistent().get(&DataKey::Supply(lender.clone()));
    let pos = SupplyPosition { lp_shares: existing.map(|p| p.lp_shares).unwrap_or(0) + shares, deposited_at: env.ledger().timestamp(), apy_snapshot: Self::supply_apy(pool.total_borrowed, pool.total_supplied) };
    env.storage().persistent().set(&DataKey::Supply(lender.clone()), &pos);
    token::Client::new(&env, &Self::tok(&env)).transfer(&lender, &env.current_contract_address(), &amount);
    env.events().publish(("deposit", lender), (amount, shares));
}
pub fn withdraw(env: Env, lender: Address, amount: i128) {
    lender.require_auth();
    assert!(amount > 0, "amount must be positive");
    let pool = Self::accrue(&env);
    let pos: SupplyPosition = env.storage().persistent().get(&DataKey::Supply(lender.clone())).unwrap_or_else(|| panic!("no supply position"));
    let owned = pos.lp_shares * pool.total_supplied / pool.total_lp_shares;
    assert!(amount <= owned, "insufficient balance");
    let free = pool.total_supplied - pool.total_borrowed;
    assert!(amount <= free, "insufficient pool liquidity");
    let burn = amount * pool.total_lp_shares / pool.total_supplied;
    let mut pool = pool;
    pool.total_supplied -= amount;
    pool.total_lp_shares -= burn;
    env.storage().instance().set(&DataKey::PoolState, &pool);
    let new_shares = pos.lp_shares - burn;
    if new_shares == 0 { env.storage().persistent().remove(&DataKey::Supply(lender.clone())); }
    else { env.storage().persistent().set(&DataKey::Supply(lender.clone()), &SupplyPosition { lp_shares: new_shares, ..pos }); }
    token::Client::new(&env, &Self::tok(&env)).transfer(&env.current_contract_address(), &lender, &amount);
    env.events().publish(("withdraw", lender), amount);
}
pub fn deposit_collateral(env: Env, borrower: Address, amount: i128) {
    borrower.require_auth();
    assert!(amount > 0, "amount must be positive");
    let existing = Self::col(&env, &borrower);
    env.storage().persistent().set(&DataKey::Collateral(borrower.clone()), &CollateralPosition { amount: existing + amount, deposited_at: env.ledger().timestamp() });
    token::Client::new(&env, &Self::tok(&env)).transfer(&borrower, &env.current_contract_address(), &amount);
    env.events().publish(("deposit_collateral", borrower), amount);
}
pub fn withdraw_collateral(env: Env, borrower: Address, amount: i128) {
    borrower.require_auth();
    assert!(amount > 0, "amount must be positive");
    let pool = Self::accrue(&env);
    let collateral = Self::col(&env, &borrower);
    assert!(amount <= collateral, "insufficient collateral");
    let new_col = collateral - amount;
    let d = Self::debt(&env, &borrower, &pool);
    if d > 0 { assert!(new_col * LTV_RATIO / d >= MIN_HEALTH, "withdrawal makes position unsafe"); }
    if new_col == 0 { env.storage().persistent().remove(&DataKey::Collateral(borrower.clone())); }
    else { env.storage().persistent().set(&DataKey::Collateral(borrower.clone()), &CollateralPosition { amount: new_col, deposited_at: env.ledger().timestamp() }); }
    token::Client::new(&env, &Self::tok(&env)).transfer(&env.current_contract_address(), &borrower, &amount);
    env.events().publish(("withdraw_collateral", borrower), amount);
}
pub fn borrow(env: Env, borrower: Address, amount: i128, term_days: u64) -> u64 {
    borrower.require_auth();
    assert!(amount > 0, "amount must be positive");
    assert!(term_days >= 1 && term_days <= 365, "term 1-365 days");
    let pool = Self::accrue(&env);
    let collateral = Self::col(&env, &borrower);
    assert!(collateral > 0, "no collateral deposited");
    let existing_debt = Self::debt(&env, &borrower, &pool);
    let max_borrow = collateral * LTV_RATIO / BPS;
    assert!(existing_debt + amount <= max_borrow, "exceeds collateral limit");
    let free = pool.total_supplied - pool.total_borrowed;
    assert!(amount <= free, "insufficient pool liquidity");
    assert!(Self::active_loans(&env, &borrower) < MAX_LOANS, "max 3 concurrent loans");
    let credit: u32 = env.storage().persistent().get(&DataKey::CreditScore(borrower.clone())).unwrap_or(800);
    assert!(credit >= 400, "credit score too low");
    let loan_id: u64 = env.storage().persistent().get(&DataKey::LoanCounter(borrower.clone())).unwrap_or(0) + 1;
    env.storage().persistent().set(&DataKey::LoanCounter(borrower.clone()), &loan_id);
    let apy_bps = Self::borrow_rate(pool.total_borrowed, pool.total_supplied);
    let due_date = env.ledger().timestamp() + term_days * 86_400;
    let loan = Loan { id: loan_id, borrower: borrower.clone(), principal: amount, apy_bps, rate_index_at: pool.accumulated_rate, originated_at: env.ledger().timestamp(), due_date, amount_repaid: 0, status: LoanStatus::Active };
    let mut pool = pool;
    pool.total_borrowed += amount;
    env.storage().instance().set(&DataKey::PoolState, &pool);
    env.storage().persistent().set(&DataKey::Loan(borrower.clone(), loan_id), &loan);
    env.storage().persistent().set(&DataKey::CreditScore(borrower.clone()), &credit.saturating_sub(5).max(300));
    token::Client::new(&env, &Self::tok(&env)).transfer(&env.current_contract_address(), &borrower, &amount);
    env.events().publish(("borrow", borrower), (loan_id, amount, apy_bps, due_date));
    loan_id
}
pub fn repay(env: Env, borrower: Address, loan_id: u64, amount: i128) {
    borrower.require_auth();
    assert!(amount > 0, "amount must be positive");
    let pool = Self::accrue(&env);
    let mut loan: Loan = env.storage().persistent().get(&DataKey::Loan(borrower.clone(), loan_id)).unwrap_or_else(|| panic!("loan not found"));
    assert!(loan.status == LoanStatus::Active, "loan not active");
    assert!(loan.borrower == borrower, "not your loan");
    let factor = pool.accumulated_rate - loan.rate_index_at;
    let accrued = loan.principal * factor / BPS;
    let now = env.ledger().timestamp();
    let penalty = if now > loan.due_date { let days = ((now - loan.due_date) / 86_400) as i128; loan.principal * (days / 2) * 150 / BPS } else { 0 };
    let total_owed = loan.principal + accrued + penalty - loan.amount_repaid;
    let pay = amount.min(total_owed);
    loan.amount_repaid += pay;
    let fully_repaid = loan.amount_repaid >= loan.principal + accrued + penalty;
    if fully_repaid { loan.status = LoanStatus::Repaid; }
    env.storage().persistent().set(&DataKey::Loan(borrower.clone(), loan_id), &loan);
    let mut pool = pool;
    pool.total_borrowed = pool.total_borrowed.saturating_sub(pay);
    let interest_paid = pay.saturating_sub(loan.principal);
    let fee = interest_paid * PROTOCOL_FEE_BPS / BPS;
    pool.total_supplied += pay - fee;
    let ef: i128 = env.storage().instance().get(&DataKey::ProtocolFees).unwrap_or(0);
    env.storage().instance().set(&DataKey::ProtocolFees, &(ef + fee));
    env.storage().instance().set(&DataKey::PoolState, &pool);
    let credit: u32 = env.storage().persistent().get(&DataKey::CreditScore(borrower.clone())).unwrap_or(800);
    let new_score = if fully_repaid { if now <= loan.due_date { credit.saturating_add(20).min(800) } else { credit.saturating_add(5).min(800) } } else { credit };
    env.storage().persistent().set(&DataKey::CreditScore(borrower.clone()), &new_score);
    token::Client::new(&env, &Self::tok(&env)).transfer(&borrower, &env.current_contract_address(), &pay);
    env.events().publish(("repay", borrower), (loan_id, pay, fully_repaid));
}
pub fn liquidate(env: Env, liquidator: Address, borrower: Address, loan_id: u64) {
    liquidator.require_auth();
    assert!(liquidator != borrower, "cannot self-liquidate");
    let pool = Self::accrue(&env);
    assert!(Self::hf(&env, &borrower, &pool) < MIN_HEALTH, "position is healthy");
    let mut loan: Loan = env.storage().persistent().get(&DataKey::Loan(borrower.clone(), loan_id)).unwrap_or_else(|| panic!("loan not found"));
    assert!(loan.status == LoanStatus::Active, "loan not active");
    let factor = pool.accumulated_rate - loan.rate_index_at;
    let accrued = loan.principal * factor / BPS;
    let debt = loan.principal + accrued - loan.amount_repaid;
    let collateral = Self::col(&env, &borrower);
    let seize = (debt + debt * LIQUIDATION_BONUS / BPS).min(collateral);
    loan.status = LoanStatus::Liquidated;
    env.storage().persistent().set(&DataKey::Loan(borrower.clone(), loan_id), &loan);
    let remaining = collateral - seize;
    if remaining == 0 { env.storage().persistent().remove(&DataKey::Collateral(borrower.clone())); }
    else { env.storage().persistent().set(&DataKey::Collateral(borrower.clone()), &CollateralPosition { amount: remaining, deposited_at: env.ledger().timestamp() }); }
    let mut pool = pool;
    pool.total_borrowed = pool.total_borrowed.saturating_sub(debt);
    pool.total_supplied += debt;
    env.storage().instance().set(&DataKey::PoolState, &pool);
    env.storage().persistent().set(&DataKey::CreditScore(borrower.clone()), &300u32);
    let tc = token::Client::new(&env, &Self::tok(&env));
    tc.transfer(&liquidator, &env.current_contract_address(), &debt);
    tc.transfer(&env.current_contract_address(), &liquidator, &seize);
    env.events().publish(("liquidate", liquidator), (borrower, loan_id, debt, seize));
}
pub fn create_fd(env: Env, owner: Address, amount: i128, term_days: u64) -> u64 {
    owner.require_auth();
    assert!(amount > 0, "amount must be positive");
    assert!(term_days >= 30, "minimum 30 days");
    let pool = Self::accrue(&env);
    let apy_bps: i128 = match term_days { 0..=89 => 500, 90..=179 => 650, 180..=364 => 800, 365..=1094 => 1000, 1095..=1824 => 1250, _ => 1500 };
    let interest = amount * apy_bps * term_days as i128 / BPS / 365;
    let payout = amount + interest;
    let matures_at = env.ledger().timestamp() + term_days * 86_400;
    let fd_id: u64 = env.storage().persistent().get(&DataKey::FDCounter(owner.clone())).unwrap_or(0) + 1;
    env.storage().persistent().set(&DataKey::FDCounter(owner.clone()), &fd_id);
    let fd = FixedDeposit { id: fd_id, owner: owner.clone(), principal: amount, apy_bps, locked_at: env.ledger().timestamp(), matures_at, payout, status: FDStatus::Active };
    let mut pool = pool;
    pool.total_supplied += amount;
    env.storage().instance().set(&DataKey::PoolState, &pool);
    env.storage().persistent().set(&DataKey::FD(owner.clone(), fd_id), &fd);
    token::Client::new(&env, &Self::tok(&env)).transfer(&owner, &env.current_contract_address(), &amount);
    env.events().publish(("create_fd", owner), (fd_id, amount, apy_bps, matures_at, payout));
    fd_id
}
pub fn claim_fd(env: Env, owner: Address, fd_id: u64) {
    owner.require_auth();
    let mut fd: FixedDeposit = env.storage().persistent().get(&DataKey::FD(owner.clone(), fd_id)).unwrap_or_else(|| panic!("FD not found"));
    assert!(fd.owner == owner, "not your FD");
    assert!(fd.status == FDStatus::Active, "FD already claimed");
    assert!(env.ledger().timestamp() >= fd.matures_at, "FD not matured yet");
    fd.status = FDStatus::Claimed;
    env.storage().persistent().set(&DataKey::FD(owner.clone(), fd_id), &fd);
    let mut pool: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
    pool.total_supplied = pool.total_supplied.saturating_sub(fd.payout);
    env.storage().instance().set(&DataKey::PoolState, &pool);
    token::Client::new(&env, &Self::tok(&env)).transfer(&env.current_contract_address(), &owner, &fd.payout);
    env.events().publish(("claim_fd", owner), (fd_id, fd.payout));
}
pub fn early_withdraw_fd(env: Env, owner: Address, fd_id: u64) {
    owner.require_auth();
    let mut fd: FixedDeposit = env.storage().persistent().get(&DataKey::FD(owner.clone(), fd_id)).unwrap_or_else(|| panic!("FD not found"));
    assert!(fd.owner == owner, "not your FD");
    assert!(fd.status == FDStatus::Active, "FD not active");
    assert!(env.ledger().timestamp() < fd.matures_at, "already matured — use claim_fd");
    let penalty = fd.principal * EARLY_PENALTY_BPS / BPS;
    let payout = fd.principal - penalty;
    assert!(payout > 0, "penalty exceeds principal");
    fd.status = FDStatus::EarlyWithdrawn;
    env.storage().persistent().set(&DataKey::FD(owner.clone(), fd_id), &fd);
    let mut pool: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap();
    pool.total_supplied = pool.total_supplied.saturating_sub(fd.principal);
    env.storage().instance().set(&DataKey::PoolState, &pool);
    token::Client::new(&env, &Self::tok(&env)).transfer(&env.current_contract_address(), &owner, &payout);
    env.events().publish(("early_withdraw_fd", owner), (fd_id, payout, penalty));
}
pub fn get_pool_state(env: Env) -> PoolState { env.storage().instance().get(&DataKey::PoolState).unwrap() }
pub fn get_supply_apy(env: Env) -> i128 { let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap(); Self::supply_apy(p.total_borrowed, p.total_supplied) }
pub fn get_borrow_rate(env: Env) -> i128 { let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap(); Self::borrow_rate(p.total_borrowed, p.total_supplied) }
pub fn get_health_factor(env: Env, user: Address) -> i128 { let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap(); Self::hf(&env, &user, &p) }
pub fn get_collateral(env: Env, user: Address) -> i128 { Self::col(&env, &user) }
pub fn get_max_borrow(env: Env, user: Address) -> i128 { let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap(); let c = Self::col(&env, &user); let d = Self::debt(&env, &user, &p); (c * LTV_RATIO / BPS).saturating_sub(d) }
pub fn get_health_info(env: Env, user: Address) -> HealthInfo { let p: PoolState = env.storage().instance().get(&DataKey::PoolState).unwrap(); let c = Self::col(&env, &user); let d = Self::debt(&env, &user, &p); let hf = if d == 0 { i128::MAX } else { c * LTV_RATIO / d }; let mb = (c * LTV_RATIO / BPS).saturating_sub(d); HealthInfo { collateral: c, total_debt: d, health_factor: hf, max_borrow: mb } }
pub fn get_loan(env: Env, borrower: Address, loan_id: u64) -> Option<Loan> { env.storage().persistent().get(&DataKey::Loan(borrower, loan_id)) }
pub fn get_fd(env: Env, owner: Address, fd_id: u64) -> Option<FixedDeposit> { env.storage().persistent().get(&DataKey::FD(owner, fd_id)) }
pub fn get_credit_score(env: Env, user: Address) -> u32 { env.storage().persistent().get(&DataKey::CreditScore(user)).unwrap_or(800) }
pub fn get_supply_position(env: Env, lender: Address) -> Option<SupplyPosition> { env.storage().persistent().get(&DataKey::Supply(lender)) }
pub fn get_protocol_fees(env: Env) -> i128 { env.storage().instance().get(&DataKey::ProtocolFees).unwrap_or(0) }
}
