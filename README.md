# 🌸 ORCHID — Optimized Real-time Cross-border Hub for Intelligent Disbursements

**A high-performance Web3 financial orchestration platform built on the Stellar Network — enabling real-time, trustless, and scalable cross-border financial operations through an intuitive and visually immersive interface.**

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

### Payment Hub — Payment Router
<img width="1520" height="970" alt="Image" src="https://github.com/user-attachments/assets/d3c9da57-f048-4569-a887-5a55e2bc2119" />
> *Split-payment routing with atomic settlement and saved templates*

## Mobile Screenshots

### Landing Page
![Landing Page]
<img width="1914" height="1079" alt="Image" src="https://github.com/user-attachments/assets/3ab1d909-7639-4707-a972-9bf7e65e9d9c" />
> *v2.0 Interstellar Protocol Live — Connect Wallet, real-time network stats*

### Dashboard
<img width="467" height="843" alt="image" src="https://github.com/user-attachments/assets/bcecced6-4170-4c16-bf49-c57c2de01147" />


### Smart Escrow Payments
<img width="473" height="839" alt="image" src="https://github.com/user-attachments/assets/e14982bb-4ebe-4068-9d6a-d5c26df77b0e" />


### DeFi Lending & Yield — Provide Liquidity
<img width="476" height="844" alt="image" src="https://github.com/user-attachments/assets/69f0827f-7acd-4f02-9121-e6fc55a42169" />
<img width="476" height="840" alt="image" src="https://github.com/user-attachments/assets/731c322e-57ad-44a0-8a26-970a8ade76ef" />


### DeFi Lending — Instant Micro-Loans
<img width="474" height="839" alt="image" src="https://github.com/user-attachments/assets/c958a36f-fe1d-41b6-b0f1-c8eed2516c94" />


### DeFi Lending — Fixed Deposit
<img width="470" height="838" alt="image" src="https://github.com/user-attachments/assets/6288463b-b827-446e-8d38-65cd09495417" />


### Credit Score
<img width="475" height="836" alt="image" src="https://github.com/user-attachments/assets/f1b960b9-a7f8-447d-9ed7-14baa33aa2a2" />


### Payment Hub — Payment Router
<img width="475" height="842" alt="image" src="https://github.com/user-attachments/assets/e88f4753-8af3-426e-ad57-e6b6b84221c2" />


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
🚀 Advanced Feature 1: Global Dashboard Hub

Description
Provides a unified interface for real-time Stellar ledger monitoring, analytics visualization, and network operations.

Implementation
Backend: Rust (Actix)
Logic: Fetches live ledger data → processes metrics → renders glassmorphic UI layer

Code Reference
/src/routes/dashboard.rs
/src/services/dashboard_service.rs

API Endpoint
GET /api/dashboard/{wallet_address}

Proof
Real-time ledger sync + analytics rendering
<img width="1899" height="935" alt="image" src="https://github.com/user-attachments/assets/dd5ecefa-0908-4b14-9d12-36a31252efa7" />



🚀 Advanced Feature 2: Smart Escrow System (/escrow)

Description
Enables trustless conditional transactions where funds are locked until predefined milestones are met.

Implementation
Backend: Rust (Actix)
Logic: Create escrow contract → lock assets → release on condition validation

Code Reference
/src/routes/escrow.rs
/src/services/escrow_service.rs

API Endpoint
POST /api/escrow/create
POST /api/escrow/release

Proof
Asset locking + milestone-based release
<img width="1898" height="937" alt="image" src="https://github.com/user-attachments/assets/c0fdfb18-46ef-40af-a071-41f45b57acb1" />


🚀 Advanced Feature 3: DeFi Lending & Yield (/lending)

Description
Facilitates automated liquidity allocation with dynamic APY optimization.

Implementation
Backend: Rust (Actix)
Logic: Pool funds → calculate APY → redistribute capital dynamically

Code Reference
/src/routes/lending.rs
/src/services/lending_service.rs

API Endpoint
POST /api/lending/deposit
GET /api/lending/apy

Proof
Dynamic yield calculation + pool interaction
<img width="1919" height="934" alt="image" src="https://github.com/user-attachments/assets/f3211633-69d3-40b8-ae31-7d18157e32f0" />


🚀 Advanced Feature 4: Payment Router (/merchant-payments)

Description
Supports multi-recipient transaction splitting with atomic execution.

Implementation
Backend: Rust (Actix)
Logic: Construct transaction → split outputs → execute via Stellar TransactionBuilder

Code Reference
/src/routes/payments.rs
/src/services/payment_service.rs

API Endpoint
POST /api/payments/split

Proof
Atomic multi-recipient transfers
<img width="1900" height="937" alt="image" src="https://github.com/user-attachments/assets/15a7303e-fa52-43c5-9f60-86270c6c09d5" />


🚀 Advanced Feature 5: Atomic Bulk Payouts (/bulk-payouts)

Description
Enables large-scale payouts in a single transaction payload with minimal overhead.

Implementation
Backend: Rust (Actix)
Logic: Batch recipients → construct atomic transaction → execute payout

Code Reference
/src/routes/bulk_payout.rs
/src/services/bulk_payout_service.rs

API Endpoint
POST /api/bulk-payout/execute

Proof
Mass payout execution in one transaction
<img width="1919" height="937" alt="image" src="https://github.com/user-attachments/assets/d906362e-718b-41cf-a98d-0dea86735288" />


🚀 Advanced Feature 6: Credit Score Module (/credit-score)

Description
Tracks on-chain financial behavior to generate dynamic credit scores.

Implementation
Backend: Rust (Actix)
Logic: Analyze transaction history → assign weights → compute score

Code Reference
/ src/routes/credit_score.rs
/ src/services/credit_score_service.rs

API Endpoint
GET /api/credit-score/{wallet_address}

Proof
On-chain reputation scoring
<img width="1901" height="935" alt="image" src="https://github.com/user-attachments/assets/28731169-f4c0-4135-940e-89bab44162a8" />

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
## Verified Wallet Addresses
The following wallet addresses have interacted with the ORCHID platform and are verifiable on the Stellar Testnet Explorer.
| Timestamp | Name | Email | Wallet | Experience | Ease | Issues | Liked | Improvements | Speed | Design | Loading | Stability | Accessibility |
|----------|------|-------|--------|------------|------|--------|-------|--------------|-------|--------|---------|----------|--------------|
| 2026/03/31 4:14 | sudhakar sutar | sudhakarsutar101@gmail.com | GA3WKZ... | Good | Very Easy |  |  |  | 4 |  |  |  |  |
| 2026/03/31 4:52 | Aryan | ridere842@gmail.com | 0x4a5F... | Good | Easy |  |  | Nothing as of now | 3 | Neutral | Satisfied | Neutral | Neutral |
| 2026/03/31 5:05 | Aryan rahman | ridere842@gmail.com | GAPCPZ... | Good | Neutral |  |  | Nothing as of now | 3 | Neutral | Satisfied | Neutral | Neutral |
| 2026/03/31 5:34 | Aman Karankale | aman8e05@gmail.com | GAUK22... | Excellent | Easy |  | simple and fast | none | 5 | Satisfied | Very Satisfied | Very Satisfied | Satisfied |
| 2026/03/31 6:22 | Monika Tayade | monyamy2007@gmail.com | GAK3MU... | Excellent | Easy |  | interface | detailed description needed | 5 | Very Satisfied | Very Satisfied | Satisfied | Satisfied |
| 2026/03/31 6:34 | Sayali Nighot | sayali19425@gmail.com | GAHHWA... | Excellent | Easy | -- | well structured | no | 5 | Satisfied | Satisfied | Satisfied | Satisfied |
| 2026/03/31 7:22 | Aryan rahaman | ridere842@gmail.com | GAPCPZ... | Average | Difficult | dashboard congested | Response of site | refine design | 3 | Neutral | Satisfied | Neutral | Very Dissatisfied |
| 2026/03/31 7:34 | Lochana Pawar | lochana.sppu@gmail.com | GBNN4W... | Excellent | Easy |  | fast + user-friendly |  | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/03/31 8:35 | Vedika Chimanpure | manoj.chim77@gmail.com | address | Excellent | Very Easy | none | easy to use | no need | 5 | Very Satisfied | Satisfied | Very Satisfied | Very Satisfied |
| 2026/03/31 8:55 | Roshni Panjabi | roshnipanjabi29@gmail.com | GCEVM7... | Excellent | Easy |  |  |  | 4 | Satisfied | Satisfied | Neutral | Satisfied |
| 2026/03/31 9:01 | Lavanya Kapadnis | lavanyakapadnis7@gmail.com | GAZ54W... | Excellent | Very Easy |  |  |  | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/03/31 9:08 | Tauqeer Hashmi | chickennugget69t@gmail.com | GB3K63... | Excellent | Very Easy |  | clean design | fix credit meter | 4 | Very Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/03/31 9:17 | Khushi Shah | klshah1439@gmail.com | GAXDPV... | Excellent | Easy |  | user friendly |  | 4 | Very Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/03/31 10:53 | Shashikira | shashikiransk817@gmail.com | GC4MQ3... | Excellent | Easy |  | layout + colors | all good | 4 | Very Satisfied | Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 12:01 | Samruddhi Nevse | nevsesamruddhi@gmail.com | GCWHSF... | Good | Very Easy | no | smooth flow | no | 4 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 8:35 | Kamal Tayade | nirmaan9105@gnail.com | GASM7H... | Good | Easy |  | interface | no iOS support | 4 | Very Satisfied | Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 9:15 | Rashmi Karankale | rashmi.karankale@podar.org | GCGPGU... | Excellent | Very Easy |  | good | add themes | 4 | Satisfied | Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 9:34 | Dharmraj Karankale | dharmrajgirdhar@gmail.com | GCGPGU... |  | Very Easy | not difficult | color clarity | add themes | 4 | Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 10:31 | Param Jain | paramiteducation@gmail.com | GDDNBM... | Excellent | Very Easy |  | all things | nothing | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 10:43 | Nikita Biradar | nikitabiradar300@gmail.com | GDSDCT... | Good | Easy |  | fast transaction | mobile UI | 4 | Satisfied | Very Satisfied | Very Satisfied | Satisfied |
| 2026/04/01 11:56 | Vikas Padvi | eklaya.nandurbar@gmail.com | GCGPGU... | Excellent | Very Easy | no | color combo | add themes | 4 | Satisfied | Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 12:13 | Girish Chaudhari | chaudharigirish1209@gmail.com | CGPGU... | Excellent | Very Easy |  | add themes | detailed info | 4 | Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 2:00 | Samruddhi Pawar | pawarsamruddhi78@gmail.com | GCUMDB... | Excellent | Very Easy |  | NA | NA | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 2:29 | Vishvajit Bhagave | vishvajitbhagave@gmail.com | GDQCMJ... | Excellent | Very Easy |  | smart escrow | none | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 7:16 | Manvesh Shah | Firegamingmonster@gmail.com | Sorry personal | Excellent | Easy |  |  | improve UI | 4 | Neutral | Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 7:35 | Prem Bharne | prembharne455@gmail.com | GAU6W7... | Good | Easy |  | escrow + subscription | UI + tx fail | 4 | Neutral | Very Satisfied | Neutral | Dissatisfied |
| 2026/04/01 8:13 | Nabamita Das | Nabamitadas1112@gmail.com |  | Excellent | Very Easy |  | simple | no | 4 | Satisfied | Satisfied | Satisfied | Satisfied |
| 2026/04/01 8:24 | Tanishka Bharadwaj | tanishkabharadwaj200206@gmail.com |  | Poor | Neutral |  | detailed thinking | mobile lag | 4 | Satisfied | Neutral | Neutral | Satisfied |
| 2026/04/02 6:09 | Aryan | ridere842@gmail.com | GAPCPZ... | Good | Very Easy |  | smoothness | change font | 4 | Satisfied | Satisfied | Neutral | Satisfied |
| 2026/04/02 7:16 | Simran Salampuria | salampuriasimran@gmail.com |  | Excellent | Easy |  | interface | perfect | 5 | Very Dissatisfied | Very Dissatisfied | Very Dissatisfied | Neutral |
| 2026/04/02 7:23 | Diablo | diablo8879@gmail.com | Idk | Excellent | Very Easy | idk | idk | idk | 5 | Neutral | Neutral | Neutral | Neutral |
| 2026/04/02 8:13 | Lalit Hire | lalithire110@gmail.com | GDDK5J... | Excellent | Neutral | hard initially | UI | fix mobile bugs | 2 | Very Satisfied | Very Satisfied | Very Satisfied | Satisfied |

### this is the form's response excel sheet 
https://docs.google.com/spreadsheets/d/e/2PACX-1vRi-2CtTCfkYe-xxU8pETjIAWSuqqxK3gIbvzNIMTv9ZGvX6wS25-MOGM-bmU7haUxX00DM6XciKlPr/pubhtml

---

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
