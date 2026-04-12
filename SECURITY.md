# Orchid Security Checklist

## Smart Contract Security (Soroban)

### orchid_escrow
- [x] `require_auth()` on every state-changing function (buyer/seller role enforcement)
- [x] State updated BEFORE token transfers (reentrancy prevention)
- [x] Terminal states (Released/Refunded/AutoReleased) reject all further calls
- [x] Deadline enforced via `env.ledger().timestamp()` — cannot be manipulated
- [x] Buyer ≠ Seller enforced at creation
- [x] Amount > 0 enforced at creation
- [x] Platform fee capped at 10% maximum
- [x] No hidden balances — full amount always transferred on resolution
- [x] `overflow-checks = true` in Cargo.toml

### orchid_pool
- [x] `require_auth()` on every state-changing function
- [x] State updated BEFORE token transfers (reentrancy prevention)
- [x] Overcollateralized: 150% collateral ratio enforced on every borrow
- [x] Health factor checked before every borrow and collateral withdrawal
- [x] Liquidation only when health < 1.0 (prevents griefing)
- [x] Self-liquidation prevented (`liquidator != borrower`)
- [x] Double-borrow prevented: max 3 concurrent loans per address
- [x] Credit score gate: minimum 400 to borrow
- [x] FD claim idempotent: `FDStatus::Claimed` checked before payout
- [x] Pool drain prevented: free liquidity check before every borrow/withdraw
- [x] `overflow-checks = true` in Cargo.toml
- [x] Re-initialisation prevented: `Admin` key existence check in `init()`

## Backend Security

- [x] Secret keys stored only in environment variables (never in code)
- [x] `.env` files in `.gitignore` — never committed to repository
- [x] CORS configured — only known origins allowed
- [x] All disbursement endpoints validate required fields before processing
- [x] Upstash Redis uses TLS/SSL (enabled by default)
- [x] Transaction deduplication: `INSERT OR IGNORE` on `tx_hash` (Redis SADD)
- [x] No SQL injection surface (Redis key-value, no raw queries)

## Frontend Security

- [x] No secret keys or sensitive data in frontend code
- [x] All env vars prefixed with `VITE_` (public by design)
- [x] WalletConnect v2 — no private key handling in browser
- [x] Freighter extension — signs transactions without exposing keys
- [x] `sanitizeTransactions()` cleans malformed persisted data on connect
- [x] Destination account validated on-chain before sending (prevents `op_no_destination`)
- [x] Amount validation: `stellarAmount()` enforces positive, max 7 decimal places
- [x] `tx_bad_seq` auto-retry with fresh account sequence

## Known Limitations (Testnet)

- [ ] No formal third-party audit (required before mainnet)
- [ ] Price oracle not integrated — collateral valued in XLM only (no USD pricing)
- [ ] Pool secret key stored in Render env — should use HSM/KMS for mainnet
- [ ] No rate limiting on backend API endpoints

## Incident Response

If a vulnerability is discovered:
1. Pause new escrow/pool deposits immediately
2. Contact: [your contact]
3. Contracts on testnet — no real funds at risk until mainnet deployment
