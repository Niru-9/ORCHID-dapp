use soroban_sdk::{contractimpl, Address, Env, token};
use crate::{OrchidContract, OrchidContractClient, types::DataKey};

#[contractimpl]
impl OrchidContract {
    /// Supply liquidity to the pool
    pub fn supply(env: Env, lender: Address, token: Address, amount: i128) {
        lender.require_auth();
        let client = token::Client::new(&env, &token);
        client.transfer(&lender, &env.current_contract_address(), &amount);
        
        let current_supply: i128 = env.storage().persistent().get(&DataKey::Supply(lender.clone(), token.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Supply(lender, token.clone()), &(current_supply + amount));

        let total_supply: i128 = env.storage().persistent().get(&DataKey::TotalSupply(token.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::TotalSupply(token), &(total_supply + amount));
    }

    /// Borrow funds
    pub fn borrow(env: Env, borrower: Address, token: Address, amount: i128) {
        borrower.require_auth();
        
        let client = token::Client::new(&env, &token);
        client.transfer(&env.current_contract_address(), &borrower, &amount);
        
        let current_borrow: i128 = env.storage().persistent().get(&DataKey::Borrow(borrower.clone(), token.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::Borrow(borrower, token.clone()), &(current_borrow + amount));

        let total_borrow: i128 = env.storage().persistent().get(&DataKey::TotalBorrow(token.clone())).unwrap_or(0);
        env.storage().persistent().set(&DataKey::TotalBorrow(token), &(total_borrow + amount));
    }
}
