use soroban_sdk::{contractimpl, Address, Env, token};
use crate::{OrchidContract, OrchidContractClient, types::{DataKey, SubscriptionState}};

#[contractimpl]
impl OrchidContract {
    /// Sets up a recurring payment agreement
    pub fn subscribe(env: Env, subscriber: Address, merchant: Address, token: Address, amount: i128, interval_seconds: u64) {
        subscriber.require_auth();
        
        let sub = SubscriptionState {
            token,
            amount,
            interval: interval_seconds,
            last_paid: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Sub(subscriber, merchant), &sub);
    }

    /// Processes the payment if the interval has passed
    pub fn process_payment(env: Env, subscriber: Address, merchant: Address) {
        let mut sub: SubscriptionState = env.storage().persistent().get(&DataKey::Sub(subscriber.clone(), merchant.clone())).unwrap();
        
        let current_time = env.ledger().timestamp();
        if current_time < sub.last_paid + sub.interval {
            panic!("Subscription interval has not passed yet");
        }

        let client = token::Client::new(&env, &sub.token);
        client.transfer_from(&env.current_contract_address(), &subscriber, &merchant, &sub.amount);

        sub.last_paid = current_time;
        env.storage().persistent().set(&DataKey::Sub(subscriber, merchant), &sub);
    }
}
