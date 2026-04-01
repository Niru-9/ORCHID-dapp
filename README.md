# 🌸 ORCHID — Optimized Real-time Cross-border Hub for Intelligent Disbursements

> **A high-performance Web3 financial orchestration platform built on the Stellar Network — enabling real-time, trustless, and scalable cross-border financial operations through an intuitive and visually immersive interface.**

---

## Live Demo

**🔗 [https://orchid-dapp.vercel.app](https://orchid-dapp.vercel.app)**

---

## Demo Video

**Full MVP walkthrough — wallet connect, dashboard, escrow, lending, credit score, subscriptions, payment hub & bulk payouts:**

https://github.com/user-attachments/assets/d1db4d4e-085c-42d6-9ec7-ab4a22eb1434

---

## Screenshots

### Landing Page
![Landing Page]
<img width="1914" height="1079" alt="Image" src="https://github.com/user-attachments/assets/3ab1d909-7639-4707-a972-9bf7e65e9d9c" />
> *v2.0 Interstellar Protocol Live — Connect Wallet, real-time network stats*

### Dashboard
![Dashboard]
<img width="1919" height="1079" alt="Image" src="https://github.com/user-attachments/assets/eb60f5db-d0df-4e80-8b6f-0519cf8d1a34" />
> *Overview of network activity, credit score, recent transactions & quick transfer*

### Smart Escrow Payments
![Smart Escrow]
<img width="1919" height="1079" alt="Image" src="https://github.com/user-attachments/assets/cca34872-bc4c-43c5-9696-19f823135232" />
> *Trustless milestone-based payments — lock funds until delivery is confirmed*

### DeFi Lending & Yield — Provide Liquidity
<img width="1919" height="1079" alt="Image" src="https://github.com/user-attachments/assets/e8fc29ec-fd92-4bf4-8a18-e3dd8e121e90" />
> *Supply assets to the decentralized lending pool at 9.6% APY*

### DeFi Lending — Instant Micro-Loans
<img width="1543" height="964" alt="Image" src="https://github.com/user-attachments/assets/482be07d-173c-42bc-a2f6-d1a07bc3d859" />
> *Borrow working capital instantly at 12.0%–14.0% APY with flexible loan terms*

### DeFi Lending — Fixed Deposit
<img width="1506" height="980" alt="Image" src="https://github.com/user-attachments/assets/c7e70729-72c2-4222-9b48-232cee8fb74a" />
> *Lock funds for a fixed term and earn guaranteed 5.7% bank APY*

### Credit Score
<img width="1546" height="1079" alt="Image" src="https://github.com/user-attachments/assets/ae4201f2-6a78-40f6-8ef6-620528717a28" />
> *Real-time on-chain credit assessment — score updates on every confirmed repayment event*

### Subscription & Recurring Payments
<img width="1510" height="830" alt="Image" src="https://github.com/user-attachments/assets/24557594-fd7e-429c-bdb0-8fc3775dbd68" />
> *Automate billing cycles with on-chain recurring payment streams*

### Payment Hub — Payment Router
<img width="1520" height="970" alt="Image" src="https://github.com/user-attachments/assets/d3c9da57-f048-4569-a887-5a55e2bc2119" />
> *Split-payment routing with atomic settlement and saved templates*

---

## Table of Contents

- [Live Demo](#-live-demo)
- [Demo Video](#-demo-video)
- [Screenshots](#-screenshots)
- [Overview](#-overview)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Wallet Integration](#-wallet-integration)
- [Testnet Behavior](#-testnet-behavior)
- [Security Behavior](#-security-behavior)
- [Use Cases](#-use-cases)
- [User Feedback](#-user-feedback)
- [Vision](#-vision)
- [License](#-license)

---

## Overview

ORCHID combines advanced UI/UX with decentralized financial primitives to deliver a **unified platform** for cross-border payments, escrow, DeFi lending, subscription billing, and bulk payouts.

It acts as a **one-stop Web3 financial control layer**, optimized for both individuals and enterprises — powered by the speed and low fees of the Stellar Network.

---

## Features

### 🌐 Global Dashboard Hub
- Real-time Stellar ledger tracking
- Glassmorphic analytics UI
- One-click network operations

### 🔒 Smart Escrow System (`/escrow`)
- Trustless conditional transactions
- Asset locking until milestone completion

### 💰 DeFi Lending & Yield (`/lending`)
- Automated liquidity pool interactions
- Dynamic APY-based capital distribution

### 🔁 Subscription Engine (`/subscriptions`)
- Recurring payment automation
- Web3 SaaS billing infrastructure

### 💳 Payment Router (`/merchant-payments`)
- Multi-recipient transaction splitting
- Atomic execution using Stellar `TransactionBuilder`

### 📤 Atomic Bulk Payouts (`/bulk-payouts`)
- Mass payouts in a single payload
- Near-zero overhead for enterprise payroll

### 🏦 Credit Score Module (`/credit-score`)
- On-chain financial reputation tracking
- Dynamic scoring based on transaction history

---

## Tech Stack

### Frontend

| Technology | Purpose |
|---|---|
| React + Vite | SPA Framework |
| Framer Motion | Animations & transitions |
| React Three Fiber | 3D visuals |
| Stellar SDK (JS) | Blockchain operations |
| @creit.tech/stellar-wallets-kit | Multi-wallet connector |
| Zustand (Persistent) | State management |
| Custom Vanilla CSS | Styling |

### Blockchain

| Technology | Purpose |
|---|---|
| Stellar Testnet | Blockchain network |
| Soroban (Rust) | Smart contract platform |
| Stellar Horizon API | On-chain data queries |
| Freighter / Browser Wallets | Wallet integration |

### Smart Contracts (Soroban / Rust)

| Contract | Purpose |
|---|---|
| `escrow.rs` | Trustless escrow logic |
| `lending.rs` | Lending & yield distribution |
| `payment_router.rs` | Multi-recipient payment splitting |
| `subscription.rs` | Recurring billing automation |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   React SPA (Vite)                           │
│  Landing | Dashboard | Escrow | Lending | Subscriptions      │
│  BulkPayouts | MerchantPayments | CreditScore | PaymentHub   │
└────────────────────────┬─────────────────────────────────────┘
                         │ Stellar SDK / Horizon REST
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                  Stellar Testnet                             │
│         Horizon API — balance, transactions, submit XDR      │
│                         │                                    │
│            ┌────────────┴────────────┐                       │
│            ▼                         ▼                       │
│     Soroban Smart Contracts     Stellar Accounts             │
│  (Escrow | Lending | Router |   (XLM balances, payments)    │
│   Subscriptions)                                             │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   Backend (Node / API)                       │
│              Auth | Profile | Analytics | Health             │
└──────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```text
ORCHID/
│
├── backend/                            # API server
│
├── frontend/
│   ├── contracts/
│   │   └── orchid_core/                # Soroban smart contracts (Rust)
│   │       └── src/
│   │           ├── escrow.rs           # Escrow contract logic
│   │           ├── lending.rs          # Lending & yield logic
│   │           ├── lib.rs              # Contract entry point
│   │           ├── payment_router.rs   # Payment routing logic
│   │           ├── subscription.rs     # Subscription billing logic
│   │           └── types.rs            # Shared contract types
│   │
│   ├── dist/                           # Production build output
│   ├── node_modules/
│   ├── public/                         # Static assets
│   │
│   └── src/
│       ├── components/                 # Reusable UI components
│       ├── store/                      # Zustand state management
│       │   ├── create_pool.js          # Liquidity pool state
│       │   ├── networkStats.js         # Network stats state
│       │   ├── sim_test.js             # Simulation/testing state
│       │   └── wallet.js               # Wallet connection state
│       ├── views/                      # Route-level page components
│       │   ├── BulkPayouts.jsx         # Bulk payout interface
│       │   ├── CreditScore.jsx         # Credit score dashboard
│       │   ├── Dashboard.jsx           # Main analytics hub
│       │   ├── Escrow.jsx              # Escrow management
│       │   ├── Landing.jsx             # Landing page
│       │   ├── Lending.jsx             # DeFi lending interface
│       │   ├── MerchantPayments.jsx    # Merchant payment routing
│       │   ├── PaymentHub.jsx          # Unified payment hub
│       │   └── Subscriptions.jsx       # Subscription management
│       ├── App.jsx                     # Root component & routing
│       ├── main.jsx                    # Vite entry point
│       └── main.css                    # Global styles
│
├── .env                                # Environment variables
├── index.html                          # HTML shell
├── package.json                        # NPM dependencies
└── README.md
```

---

## Getting Started

### Prerequisites

- Node.js v18+
- Rust 1.70+ (for contract development)
- A Stellar wallet extension — [Freighter](https://freighter.app) recommended
- Wallet must be configured to **Testnet**

### Installation

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)

Then:
1. Connect your wallet
2. Authorize the app in your wallet extension
3. Explore the dashboard features

### Smart Contract Deployment (Soroban)

```bash
cd frontend/contracts/orchid_core
cargo build --target wasm32-unknown-unknown --release

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/orchid_core.wasm \
  --network testnet \
  --source <YOUR_KEYPAIR>
```

---

## Wallet Integration

ORCHID uses `@creit.tech/stellar-wallets-kit` for multi-wallet support.

- Requires a browser wallet (Freighter recommended)
- Ensure Testnet is enabled in your wallet settings
- Authorize the app when prompted on first connection

---

## Testnet Behavior

- All transactions are executed on **Stellar Testnet**
- Uses Horizon Testnet endpoints for live operation simulation
- Safe for testing — no real funds involved
- Fund your testnet wallet via [Stellar Friendbot](https://friendbot.stellar.org)

---

## Security Behavior

On wallet disconnect, ORCHID automatically:

- Clears all transaction logs
- Purges local cache
- Resets session state

This ensures **zero cross-session data leakage**.

---

## Use Cases

- Cross-border payments for individuals and enterprises
- Payroll distribution and bulk disbursements
- Subscription billing platforms (Web3 SaaS)
- DeFi capital management and yield farming
- Merchant payment routing with multi-recipient splits
- Trustless escrow for milestone-based contracts

---

## User Feedback

The following feedback was collected from real users who tested the ORCHID platform during the MVP phase.

### Feedback Summary

[📊 View Full Feedback Spreadsheet](https://docs.google.com/spreadsheets/d/1nHv6Fjfr_ofXEZk3G8o3dtk96sfYfnI-CmHvpAJffv4/edit?usp=sharing)

---

## Vision

ORCHID aims to become a **universal decentralized financial operating system** — removing inefficiencies in global finance through speed, transparency, and composability on the Stellar Network.

---

## License

MIT License

---

> Built on [Stellar](https://stellar.org) · Powered by [Soroban](https://soroban.stellar.org) · Crafted with 🌸
