use soroban_sdk::{contractimpl, Address, Env, String, Symbol};
use crate::{OrchidContract, OrchidContractClient, types::DataKey};

#[contractimpl]
impl OrchidContract {
    /// Initialize the router with an admin and a fee percentage (e.g., 50 = 0.5%)
    pub fn init(env: Env, admin: Address, fee_percent: u32) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::FeePercent, &fee_percent);
    }

    /// Route a payment from sender to receiver.
    pub fn route_payment(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        path_id: String,
    ) -> i128 {
        sender.require_auth();

        let fee_percent: u32 = env
            .storage()
            .instance()
            .get(&DataKey::FeePercent)
            .unwrap_or(0);

        let fee = (amount * (fee_percent as i128)) / 10000;
        let amount_after_fee = amount - fee;

        env.events().publish(
            (Symbol::new(&env, "payment_routed"), sender.clone(), receiver.clone()),
            (token, amount, amount_after_fee, fee, path_id),
        );

        amount_after_fee
    }

    /// Update the fee percentage
    pub fn set_fee(env: Env, new_fee: u32) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::FeePercent, &new_fee);
    }
}
