use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // Router
    Admin,
    FeePercent,
    // Escrow
    Escrow(u64),
    Nonce,
    // Lending
    Supply(Address, Address), // (user, token)
    Borrow(Address, Address), // (user, token)
    TotalSupply(Address),     // (token)
    TotalBorrow(Address),     // (token)
    // Subscription
    Sub(Address, Address), // (subscriber, merchant)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowState {
    pub buyer: Address,
    pub seller: Address,
    pub token: Address,
    pub amount: i128,
    pub is_released: bool,
    pub is_refunded: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionState {
    pub token: Address,
    pub amount: i128,
    pub interval: u64,
    pub last_paid: u64,
}
