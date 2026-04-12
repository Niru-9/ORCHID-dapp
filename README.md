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
| Timestamp | Name | Email | Wallet Address | Experience | Ease | Issues | Liked | Improvements | Speed | Design | Loading | Stability | Accessibility |
|----------|------|-------|----------------|------------|------|--------|-------|--------------|-------|--------|---------|----------|--------------|
| 2026/03/31 4:14:51 pm GMT+5:30 | sudhakar sutar | sudhakarsutar101@gmail.com | GA3WKZPAEMGMMMB5PJKWPITIFD54SECIID3V4QKNB3ARROYQNCKHBPI2 | Good | Very Easy |  |  |  | 4 |  |  |  |  |
| 2026/03/31 4:52:59 pm GMT+5:30 | Aryan | ridere842@gmail.com | GBZZ6UDZN2RED53LA6RWNUGY4B23I6E463RNEKHASXDJCTBINX7LXMKF | Good | Easy |  |  | Nothing as of now | 3 | Neutral | Satisfied | Neutral | Neutral |
| 2026/03/31 5:05:36 pm GMT+5:30 | Aryan rahman | ridere842@gmail.com | GAPCPZRIRWSDR52DSYSSMITE4V4UL5SC222A6BP4RYFKNI2XN5WAOH2J | Good | Neutral |  |  | Nothing as of now | 3 | Neutral | Satisfied | Neutral | Neutral |
| 2026/03/31 5:34:07 pm GMT+5:30 | Aman Karankale | aman8e05@gmail.com | GAUK22PG5QLAUOILPLV7KPVW564VCFWPZNE5RMYHVYUU6LGXBUIDS6YA | Excellent | Easy |  | simple and fast | none as such because i have very limited knowledge regarding this | 5 | Satisfied | Very Satisfied | Very Satisfied | Satisfied |
| 2026/03/31 6:22:26 pm GMT+5:30 | Monika Tayade | monyamy2007@gmail.com | GAK3MUQZTU6KB3LFHPPK3YDSM5TRSGRAHL75QI7QIJ5JT6YHD6AYYRHG | Excellent | Easy |  | the interface | detailed description of features | 5 | Very Satisfied | Very Satisfied | Satisfied | Satisfied |
| 2026/03/31 6:34:37 pm GMT+5:30 | Sayali Sandip Nighot | sayali19425@gmail.com | GAHHWA4EMBFHGXN42EYODCP24G7YMT7FSMBARQZNMSEIPGVQWBYCDFCY | Excellent | Easy | -- | the website structured so good | no | 5 | Satisfied | Satisfied | Satisfied | Satisfied |
| 2026/03/31 7:22:06 pm GMT+5:30 | Aryan rahaman | ridere842@gmail.com | GAPCPZRIRWSDR52DSYSSMITE4V4UL5SC222A6BP4RYFKNI2XN5WAOH2J | Average | Difficult | The dashboard page is congested a lot and needs refining | Response of the site | Refining the design and clear congestion | 3 | Neutral | Satisfied | Neutral | Very Dissatisfied |
| 2026/03/31 7:34:44 pm GMT+5:30 | Lochana Pawar | lochana.sppu@gmail.com | GBNN4WHYFRZXWURQN2Z46FHWUNHPDDPTTAPI5JQGDUAZWLWPBBGM25LQ | Excellent | Easy |  | I liked the fast performance and user-friendly interface of the app the most. |  | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/03/31 8:35:59 pm GMT+5:30 | Vedika Manoj Chimanpure | manoj.chim77@gmail.com | GAYXJILAUDSMYPAOMN3SSLS36VL5CG7RNZ5Z6QXYXVRI2ZT3467LYQUD | Excellent | Very Easy | No issues or difficulties | Easy to used | Their is no need to improve | 5 | Very Satisfied | Satisfied | Very Satisfied | Very Satisfied |
| 2026/03/31 8:55:10 pm GMT+5:30 | Roshni Panjabi | roshnipanjabi29@gmail.com | GCEVM7ZQGWGM7ZQEYHWBYWIPWV5JOSOE7EKVE2JOHRTRDLPHLVYSJH27 | Excellent | Easy |  |  |  | 4 | Satisfied | Satisfied | Neutral | Satisfied |
| 2026/03/31 9:01:47 pm GMT+5:30 | Lavanya prakash kapadnis | lavanyakapadnis7@gmail.com | GAZ54WPABWHTTK4VNIZXMNFNJTGPMDC2HHUEWNO2KYELFSFYSA5U2JTE | Excellent | Very Easy |  |  |  | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/03/31 9:08:53 pm GMT+5:30 | Tauqeer Hahsmi | chickennugget69t@gmail.com | GB3K635LFVASBK2GTTNAVL63NIZ3LRSEUX227SF7UZKCTBRYWZU55TYM | Excellent | Very Easy |  | I really like the looks of this application it's really well organised & clean which makes it easy to use. | The credit score meter needs improvements , the text is behind the meter which makes it hard to see. | 4 | Very Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/03/31 9:17:50 pm GMT+5:30 | Khushi Shah | klshah1439@gmail.com | GAXDPV374Z5GO2OY7I7SMB3M6HQZUWA5IVAD25CRT22ARPN5N6NLFCE3 | Excellent | Easy |  | User friendly and easy to understand interface. Specially loved the credit meter. |  | 4 | Very Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/03/31 10:53:26 pm GMT+5:30 | Shashikira | shashikiransk817@gmail.com | GC4MQ3HRXOUKJ2ZMCVJJ3GHOFIK2LUKKCRKDMJLNURC76WPMTDSVY2TA | Excellent | Easy |  | Layout and the black and purple color is good touch also its so simple to use | For now its all good | 4 | Very Satisfied | Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 12:01:54 am GMT+5:30 | Samruddhi Nevse | nevsesamruddhi@gmail.com | GCWHSFPEKYG5OYYQT2M5VRRVM3LSCXACMBNKSZUTH7XCIUGQTGFDAYWD | Good | Very Easy | Nope | The smooth flow of working | Nope | 4 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 8:35:23 am GMT+5:30 | Kamal Tayade | nirmaan9105@gnail.com | GASM7HCZMM6K7QSRJVC6WG4KNQK5D4TGTFHLVCP2A24IQ7O5K4VIOD2N | Good | Easy |  | Interface of the application | Its not supported for IOS | 4 | Very Satisfied | Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 9:15:38 am GMT+5:30 | RASHMI DHARMRAJ KARANKALE | rashmi.karankale@podar.org | GCGPGU3NMOYGHQC263YE7XQ2KFG7IH6UBCVTQGCLKYLKURJGCD4BHBKT | Excellent | Very Easy |  | it was good | It could have dark and light both themes | 4 | Satisfied | Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 9:34:07 am GMT+5:30 | Dharmraj Karankale | dharmrajgirdhar@gmail.com | GCGPGU3NMOYGHQC263YE7XQ2KFG7IH6UBCVTQGCLKYLKURJGCD4BHBKT |  | Very Easy | Not Difficult | Display colour and All items clearlly wathing | It could have dark and light both themes | 4 | Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 10:31:49 am GMT+5:30 | Param Jain | paramiteducation@gmail.com | GDDNBMV47TIW77DFKLD7YVAWXEKAAZL4YVMXHIR5KVCN45TPA3T6M4VZ | Excellent | Very Easy |  | All things | Noting | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 10:43:06 am GMT+5:30 | Nikita Biradar | nikitabiradar300@gmail.com | GDSDCTRF7LK4DDGYWFWKFNXC7C4E5R2QRBXO6F2YOLPNOPSDUOVUDMJK | Good | Easy |  | Fast transction | UI for mobile | 4 | Satisfied | Very Satisfied | Very Satisfied | Satisfied |
| 2026/04/01 11:56:54 am GMT+5:30 | Vikas Padvi | eklaya.nandurbar@gmail.com | GCGPGU3NMOYGHQC263YE7XQ2KFG7IH6UBCVTQGCLKYLKURJGCD4BHBKT | Excellent | Very Easy | Not Difficult | colur combination | t could have dark and light both themes | 4 | Satisfied | Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 12:13:23 pm GMT+5:30 | Girish Harish Chaudhari | chaudharigirish1209@gmail.com | CGPGU3NMOYGHQC263YE7XQ2KFG7IH6UBCVTQGCLKYLKURJGCD4BHBKT | Excellent | Very Easy |  | t could have dark and light both themes | Nice Details information wathiching | 4 | Satisfied | Very Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 2:00:33 pm GMT+5:30 | Samruddhi Shahurao Pawar | pawarsamruddhi78@gmail.com | GCUMDB2WRUHZSNVZ6IFLL5XIHIUG3YNSC6Y5TQ3OGQUWUOHJNJTQAS75 | Excellent | Very Easy |  | NA | NA | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 2:29:48 pm GMT+5:30 | Vishvajit Bhagave | vishvajitbhagave@gmail.com | GDQCMJ4QRAAPAE6RGWHXWIDJEX76KKOWHKPS5S7LA2KOFW5O5SDK4OT2 | Excellent | Very Easy |  | Smart Escrow | Not Any | 5 | Very Satisfied | Very Satisfied | Very Satisfied | Very Satisfied |
| 2026/04/01 7:16:41 pm GMT+5:30 | Manvesh shah | Firegamingmonster@gmail.com | GCKITOXXCGASMIESVKBUAHEQMPVJTRTHDDXH4PXMRMT33A2R2BJ6TNXK | Excellent | Easy |  |  | Little improvement in uiux | 4 | Neutral | Satisfied | Satisfied | Very Satisfied |
| 2026/04/01 7:35:14 pm GMT+5:30 | prem bharne | prembharne455@gmail.com | GAU6W7VF7LRDQFJI7X4TBX3GBLBU6ELUIDG5UUQJ3JZVX2W4DUYPGK6B | Good | Easy |  | the smart escrow and suscripbtion part | the ui ,and there are still transanction failing | 4 | Neutral | Very Satisfied | Neutral | Dissatisfied |
| 2026/04/01 8:13:25 pm GMT+5:30 | Nabamita das | Nabamitadas1112@gmail.com |  | Excellent | Very Easy |  | Simple and easily understood | No | 4 | Satisfied | Satisfied | Satisfied | Satisfied |
| 2026/04/01 8:24:41 pm GMT+5:30 | Tanishka Bharadwaj | tanishkabharadwaj200206@gmail.com | GCKITOXXCGASMIESVKBUAHEQMPVJTRTHDDXH4PXMRMT33A2R2BJ6TNXK | Poor | Neutral |  | How detailed and thoroughly thought it was | It's lagging a bit in mobile | 4 | Satisfied | Neutral | Neutral | Satisfied |
| 2026/04/02 6:09:53 am GMT+5:30 | Aryan | ridere842@gmail.com | GAPCPZRIRWSDR52DSYSSMITE4V4UL5SC222A6BP4RYFKNI2XN5WAOH2J | Good | Very Easy |  | Smoothness | Change the font | 4 | Satisfied | Satisfied | Neutral | Satisfied |
| 2026/04/02 7:16:39 am GMT+5:30 | Salampuria simran | salampuriasimran@gmail.com | GD6VT6577O2AXCKQQNKRLNTTDTVXTLQ7WNXYO2BT7TQUNVQUIHQ6FJVY | Excellent | Easy |  | Interface | Everything is perfect | 5 | Very Dissatisfied | Very Dissatisfied | Very Dissatisfied | Neutral |
| 2026/04/02 7:23:17 am GMT+5:30 | Diablo | diablo8879@gmail.com | GDW5SG6LHVKQOM5RGMCFG3PYWDWE3TYCPRZHKMER3LJL55JJIR2XDJ2M | Excellent | Very Easy | Idk | Idk | Idk | 5 | Neutral | Neutral | Neutral | Neutral |
| 2026/04/02 8:13:36 am GMT+5:30 | Lalit Kailas Hire | lalithire110@gmail.com | GBKHL6WU5W2PYBJZW6ILPTBAHPSZPMQWHVJOAK2G2GNMLS2RPX3MLBZX | Excellent | Neutral | Hard to understand at first glance for the new user | UI & Feasible Integration | Some features does not work properly on some mobile devices | 2 | Very Satisfied | Very Satisfied | Very Satisfied | Satisfied |
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


## Monitoring

### Uptime Monitoring (Free)
1. Go to [uptimerobot.com](https://uptimerobot.com) — free account
2. Add monitor → HTTP(s) → URL: `https://orchid-dapp.onrender.com/`
3. Check interval: 5 minutes
4. Alert email: your email

This pings the backend every 5 minutes and emails you if it goes down. Also keeps the Render free tier awake (prevents cold starts).

### Metrics
- Live metrics: `https://orchid-dapp.onrender.com/api/metrics`
- Node count: `https://orchid-dapp.onrender.com/api/users/count`
- Recent txs: `https://orchid-dapp.onrender.com/api/transactions/recent`
