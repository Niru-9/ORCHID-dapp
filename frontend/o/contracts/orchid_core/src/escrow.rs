use soroban_sdk::{contractimpl, Address, Env, token};
use crate::{OrchidContract, OrchidContractClient, types::{DataKey, EscrowState}};

#[contractimpl]
impl OrchidContract {
    /// Initializes the escrow with a buyer, seller, token, and amount. Returns the escrow ID.
    pub fn create_escrow(env: Env, buyer: Address, seller: Address, token: Address, amount: i128) -> u64 {
        buyer.require_auth();
        
        // Transfer funds from buyer to the contract
        let client = token::Client::new(&env, &token);
        client.transfer(&buyer, &env.current_contract_address(), &amount);
        
        // Generate a new escrow ID
        let mut nonce: u64 = env.storage().instance().get(&DataKey::Nonce).unwrap_or(0);
        nonce += 1;
        env.storage().instance().set(&DataKey::Nonce, &nonce);

        // Store state
        let escrow = EscrowState {
            buyer,
            seller,
            token,
            amount,
            is_released: false,
            is_refunded: false,
        };

        env.storage().persistent().set(&DataKey::Escrow(nonce), &escrow);
        
        nonce
    }

    /// Releases funds to the seller (can be called by buyer)
    pub fn release_escrow(env: Env, escrow_id: u64, approver: Address) {
        approver.require_auth();
        let mut escrow: EscrowState = env.storage().persistent().get(&DataKey::Escrow(escrow_id)).unwrap();
        
        if approver != escrow.buyer {
            panic!("Only buyer can release funds");
        }
        if escrow.is_released || escrow.is_refunded {
            panic!("Escrow already resolved");
        }

        let client = token::Client::new(&env, &escrow.token);
        client.transfer(&env.current_contract_address(), &escrow.seller, &escrow.amount);
        
        escrow.is_released = true;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
    }

    /// Refunds funds to the buyer (can be called by seller)
    pub fn refund_escrow(env: Env, escrow_id: u64, approver: Address) {
        approver.require_auth();
        let mut escrow: EscrowState = env.storage().persistent().get(&DataKey::Escrow(escrow_id)).unwrap();
        
        if approver != escrow.seller {
            panic!("Only seller can approve a refund");
        }
        if escrow.is_released || escrow.is_refunded {
            panic!("Escrow already resolved");
        }

        let client = token::Client::new(&env, &escrow.token);
        client.transfer(&env.current_contract_address(), &escrow.buyer, &escrow.amount);
        
        escrow.is_refunded = true;
        env.storage().persistent().set(&DataKey::Escrow(escrow_id), &escrow);
    }
}
