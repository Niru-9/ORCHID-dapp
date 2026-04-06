import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useLendingStore, FD_APY, BORROW_BASE_APY, calcSupplyApy, CREDIT_GATE, calcRepayAmount, calcFdPayout } from '../store/lending';

const MS_PER_DAY = 86_400_000;
const TERM_LABELS = { 30:'30 Days', 90:'90 Days', 180:'6 Months', 365:'1 Year', 1095:'3 Years', 1825:'5 Years' };

function daysUntil(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return 'Overdue';
  const d = Math.floor(diff / MS_PER_DAY);
  const h = Math.floor((diff % MS_PER_DAY) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function daysLateNow(iso) {
  const diff = Date.now() - new Date(iso);
  return diff > 0 ? Math.ceil(diff / MS_PER_DAY) : 0;
}

export default function Lending() {
  const { supplyLendingPool, withdrawSupply, depositCollateral, borrowFunds, createFixedDeposit, repayLoan, address } = useWalletStore();
  const { loans, deposits, fixedDeposits, creditScore, poolBalance, poolUtilization, fetchPoolBalance, tickPenalties, claimFd } = useLendingStore();

  const [tab, setTab] = useState('supply');
  const [supplyAmt, setSupplyAmt] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [supplyAsset, setSupplyAsset] = useState('XLM');
  const [isSupplying, setIsSupplying] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [collateralAmt, setCollateralAmt] = useState('');
  const [isDepositingCollateral, setIsDepositingCollateral] = useState(false);
  const [onChainCollateral, setOnChainCollateral] = useState(null);
  const [onChainHealth, setOnChainHealth] = useState(null);
  const [onChainMaxBorrow, setOnChainMaxBorrow] = useState(null);
  const [borrowAmt, setBorrowAmt] = useState('');
  const [borrowTerm, setBorrowTerm] = useState(30);
  const [paymentType, setPaymentType] = useState('One-Time Payment');
  const [isBorrowing, setIsBorrowing] = useState(false);
  const [repayingId, setRepayingId] = useState(null);
  const [partialAmt, setPartialAmt] = useState('');
  const [fdAmt, setFdAmt] = useState('');
  const [fdAsset, setFdAsset] = useState('XLM');
  const [fdTerm, setFdTerm] = useState(365);
  const [isDepositing, setIsDepositing] = useState(false);

  useEffect(() => {
    fetchPoolBalance();
    tickPenalties();
    const t = setInterval(() => { fetchPoolBalance(); tickPenalties(); }, 60_000);
    return () => clearInterval(t);
  }, [fetchPoolBalance, tickPenalties]);

  // Fetch on-chain collateral, health factor, max borrow when address changes
  useEffect(() => {
    if (!address) return;
    const fetchOnChain = async () => {
      try {
        const { getCollateral, getHealthFactor, getMaxBorrow } = await import('../store/pool_contract.js');
        const [col, health, maxB] = await Promise.all([
          getCollateral(address),
          getHealthFactor(address),
          getMaxBorrow(address),
        ]);
        setOnChainCollateral(col !== null ? Number(col) / 1e7 : 0);
        setOnChainHealth(health !== null ? Number(health) / 10000 : null);
        setOnChainMaxBorrow(maxB !== null ? Number(maxB) / 1e7 : 0);
      } catch (_) {}
    };
    fetchOnChain();
    const t = setInterval(fetchOnChain, 30_000);
    return () => clearInterval(t);
  }, [address]);

  // Dynamic supply APY based on pool utilization
  const supplyApy = calcSupplyApy(poolUtilization);

  // Borrow rate depends on term AND payment type
  const baseBorrowApy = creditScore < CREDIT_GATE
    ? 22.0
    : (BORROW_BASE_APY[borrowTerm]?.[paymentType] ?? BORROW_BASE_APY[90]?.['One-Time Payment'] ?? 14.0);
  const borrowRateColor = baseBorrowApy >= 20 ? '#ef4444' : baseBorrowApy >= 16 ? '#eab308' : '#22c55e';
  const borrowPreview = borrowAmt ? calcRepayAmount(parseFloat(borrowAmt) || 0, baseBorrowApy, borrowTerm, 0) : null;
  const fdApy = FD_APY[fdTerm] ?? 5.7;
  const fdPayout = fdAmt ? calcFdPayout(parseFloat(fdAmt) || 0, fdApy, fdTerm) : null;
  const activeLoans = loans.filter(l => l.status === 'Active' || l.status === 'Partial');
  const scoreColor = creditScore >= 720 ? '#10b981' : creditScore >= 640 ? '#34d399' : creditScore >= 540 ? '#f59e0b' : creditScore >= 400 ? '#f97316' : '#ef4444';

  const handleSupply = async (e) => {
    e.preventDefault(); setIsSupplying(true);
    try { const h = await supplyLendingPool(supplyAmt, supplyAsset); alert(`Supplied!\nHash: ${h}`); setSupplyAmt(''); }
    catch (err) { alert(err.message); } finally { setIsSupplying(false); }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault(); setIsWithdrawing(true);
    try { const h = await withdrawSupply(withdrawAmt); alert(`Withdrawn!\nHash: ${h}`); setWithdrawAmt(''); }
    catch (err) { alert(err.message); } finally { setIsWithdrawing(false); }
  };

  const handleDepositCollateral = async (e) => {
    e.preventDefault(); setIsDepositingCollateral(true);
    try {
      const h = await depositCollateral(collateralAmt);
      alert(`Collateral deposited!\nHash: ${h}`);
      setCollateralAmt('');
      // Refresh on-chain values
      const { getCollateral, getHealthFactor, getMaxBorrow } = await import('../store/pool_contract.js');
      const [col, health, maxB] = await Promise.all([getCollateral(address), getHealthFactor(address), getMaxBorrow(address)]);
      setOnChainCollateral(col !== null ? Number(col) / 1e7 : 0);
      setOnChainHealth(health !== null ? Number(health) / 10000 : null);
      setOnChainMaxBorrow(maxB !== null ? Number(maxB) / 1e7 : 0);
    } catch (err) { alert(err.message); } finally { setIsDepositingCollateral(false); }
  };

  const handleBorrow = async (e) => {
    e.preventDefault(); setIsBorrowing(true);
    try {
      const id = await borrowFunds(borrowAmt, 'XLM', borrowTerm, paymentType);
      alert(`Loan recorded! ID: ${id}\nRepay ${borrowPreview} XLM by due date.`);
      setBorrowAmt('');
    } catch (err) { alert(err.message); } finally { setIsBorrowing(false); }
  };

  const handleRepay = async (loanId, partial) => {
    setRepayingId(loanId);
    try {
      const r = await repayLoan(loanId, partial || undefined);
      alert(r.isFullyRepaid ? `Fully repaid! Credit ${r.delta > 0 ? '+' : ''}${r.delta} pts\nHash: ${r.hash}` : `Partial repayment done.\nHash: ${r.hash}`);
      setPartialAmt('');
    } catch (err) { alert(err.message); } finally { setRepayingId(null); }
  };

  const handleFd = async (e) => {
    e.preventDefault(); setIsDepositing(true);
    try { const h = await createFixedDeposit(fdAmt, fdAsset, fdTerm, fdApy); alert(`FD locked! Payout at maturity: ${fdPayout} ${fdAsset}\nHash: ${h}`); setFdAmt(''); }
    catch (err) { alert(err.message); } finally { setIsDepositing(false); }
  };

  const handleClaimFd = async (fdId) => {
    const { address } = useWalletStore.getState();
    try {
      const p = await claimFd(fdId, address);
      alert(`FD payout of ${p} XLM sent to your wallet!`);
    } catch (err) { alert(err.message); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="view-header">
        <h2 className="view-title">DeFi Lending & Yield</h2>
        <p className="view-subtitle">Decentralized liquidity pool — supply to earn, borrow against your credit score.</p>
      </div>

      {/* Pool Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {[
          { label: 'Pool Liquidity', value: poolBalance > 0 ? `${poolBalance.toLocaleString(undefined,{maximumFractionDigits:2})} XLM` : 'Loading...', color: '#eab308' },
          { label: 'Pool Utilization', value: `${poolUtilization}%`, color: poolUtilization >= 80 ? '#ef4444' : poolUtilization >= 50 ? '#eab308' : '#10b981' },
          { label: 'Supply APY', value: `${supplyApy}%`, color: '#38bdf8' },
          { label: 'Credit Score', value: creditScore, color: scoreColor },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.35rem', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {activeLoans.some(l => daysLateNow(l.dueDate) > 0) && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1.5rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.85rem', color: '#ef4444' }}>
          ⚠ Overdue loans detected. Interest +1.5% every 2 days, credit score -5 pts/day.
        </div>
      )}

      {creditScore < CREDIT_GATE && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1.5rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.85rem', color: '#ef4444' }}>
          🚫 Credit score too low ({creditScore}/{CREDIT_GATE} minimum). Repay existing loans to restore borrowing access.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid var(--glass-border)' }}>
        {[['supply','Provide Liquidity'],['borrow','Borrow'],['fixed-deposit','Fixed Deposit']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500, color: tab === id ? 'var(--accent-glow)' : 'var(--text-muted)', borderBottom: tab === id ? '2px solid var(--accent-glow)' : '2px solid transparent' }}>{label}</button>
        ))}
      </div>

      {/* SUPPLY */}
      {tab === 'supply' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <div className="grid-2">
            <div className="card">
              <h3 className="card-title">Supply to Pool</h3>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>Funds go directly to the protocol liquidity pool. Earn {supplyApy}% APY.</p>
              <div style={{ padding: '1rem', background: 'rgba(56,189,248,0.05)', borderRadius: '12px', border: '1px solid rgba(56,189,248,0.1)', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Current Yield (APY)</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#38bdf8' }}>{supplyApy}%</div>
              </div>
              <form onSubmit={handleSupply} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <div className="input-wrapper">
                    <input type="number" step="0.01" min="0.01" value={supplyAmt} onChange={e => setSupplyAmt(e.target.value)} placeholder="0.00" className="form-input large" required disabled={isSupplying} />
                    <select className="input-suffix" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)' }} value={supplyAsset} onChange={e => setSupplyAsset(e.target.value)}><option value="XLM">XLM</option></select>
                  </div>
                </div>
                <button type="submit" disabled={isSupplying || !supplyAmt} className="submit-btn">{isSupplying ? 'Supplying...' : 'Supply Liquidity'}</button>
              </form>
            </div>

            <div className="card">
              <h3 className="card-title">Withdraw Supply</h3>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>Withdraw your supplied liquidity + accrued interest from the contract.</p>
              <form onSubmit={handleWithdraw} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className="form-group">
                  <label className="form-label">Amount to Withdraw (XLM)</label>
                  <input type="number" step="0.01" min="0.01" value={withdrawAmt} onChange={e => setWithdrawAmt(e.target.value)} placeholder="0.00" className="form-input large" required disabled={isWithdrawing} />
                </div>
                <button type="submit" disabled={isWithdrawing || !withdrawAmt} className="submit-btn" style={{ backgroundImage: 'linear-gradient(45deg,#38bdf8,#0ea5e9)' }}>
                  {isWithdrawing ? 'Withdrawing...' : 'Withdraw + Interest'}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">My Supplies</h3>
            <div className="table-container">
              <table>
                <thead><tr><th>ID</th><th>Amount</th><th>APY</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {deposits.length > 0 ? deposits.map((d, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: '0.75rem' }}>{d.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${d.hash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-glow)' }}>{d.id}</a> : d.id}</td>
                      <td style={{ color: '#10b981', fontWeight: 600 }}>{d.amount} {d.asset}</td>
                      <td style={{ color: '#38bdf8' }}>+{d.apy}%</td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(d.time).toLocaleDateString()}</td>
                      <td><span className="badge success">{d.status}</span></td>
                    </tr>
                  )) : <tr><td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No supplies yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* BORROW */}
      {tab === 'borrow' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Collateral Panel */}
          <div className="card" style={{ border: '1px solid rgba(168,85,247,0.2)', background: 'rgba(168,85,247,0.04)' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Your Collateral Position</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Collateral Locked</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a855f7', marginTop: '0.25rem' }}>
                  {onChainCollateral !== null ? `${onChainCollateral.toFixed(2)} XLM` : 'Loading...'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Health Factor</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem',
                  color: onChainHealth === null ? 'var(--text-muted)' : onChainHealth >= 1.5 ? '#10b981' : onChainHealth >= 1.1 ? '#f59e0b' : '#ef4444' }}>
                  {onChainHealth !== null ? onChainHealth.toFixed(2) : '—'}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>≥ 1.0 = safe</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Max Borrow</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a855f7', marginTop: '0.25rem' }}>
                  {onChainMaxBorrow !== null ? `${onChainMaxBorrow.toFixed(2)} XLM` : 'Loading...'}
                </div>
              </div>
            </div>
            <form onSubmit={handleDepositCollateral} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Deposit More Collateral (XLM)</label>
                <input type="number" step="0.01" min="0.01" value={collateralAmt} onChange={e => setCollateralAmt(e.target.value)}
                  placeholder="0.00" className="form-input" style={{ marginTop: '0.5rem' }} disabled={isDepositingCollateral} />
              </div>
              <button type="submit" disabled={isDepositingCollateral || !collateralAmt} className="action-btn"
                style={{ background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: '#a855f7', padding: '0.75rem 1.25rem', marginBottom: '0' }}>
                {isDepositingCollateral ? 'Depositing...' : 'Add Collateral'}
              </button>
            </form>
          </div>

          <div className="grid-2">
          <div className="card">
            <h3 className="card-title">Request Loan</h3>
            <p style={{ fontSize: '0.875rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>Rate based on credit score & term. Penalty: +1.5% per 2 days overdue, -5 credit pts/day.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: `1px solid ${borrowRateColor}33` }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Borrow Rate</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: borrowRateColor }}>{baseBorrowApy}% APY</div>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(168,85,247,0.06)', borderRadius: '10px', border: '1px solid rgba(168,85,247,0.12)' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Max Borrow</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#a855f7' }}>{(poolBalance * 0.8).toFixed(2)} XLM</div>
              </div>
            </div>
            <form onSubmit={handleBorrow} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Amount (XLM)</label>
                  <input type="number" step="0.01" min="0.01" value={borrowAmt} onChange={e => setBorrowAmt(e.target.value)} placeholder="0.00" className="form-input" style={{ marginTop: '0.5rem' }} required disabled={isBorrowing} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Term</label>
                  <select className="form-input" style={{ marginTop: '0.5rem' }} value={borrowTerm} onChange={e => setBorrowTerm(parseInt(e.target.value))} disabled={isBorrowing}>
                    <option value={30}>30 Days</option>
                    <option value={90}>90 Days</option>
                    <option value={180}>180 Days</option>
                  </select>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Payment Type</label>
                <select className="form-input" style={{ marginTop: '0.5rem' }} value={paymentType} onChange={e => setPaymentType(e.target.value)} disabled={isBorrowing}>
                  <option value="One-Time Payment">One-Time Payment</option>
                  <option value="EMI">Monthly Installment (EMI)</option>
                </select>
              </div>
              {borrowPreview && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Total repay (no penalty)</span>
                  <span style={{ fontWeight: 700 }}>{borrowPreview} XLM</span>
                </div>
              )}
              <button type="submit" disabled={isBorrowing || !borrowAmt || activeLoans.length >= 3} className="submit-btn">
                {isBorrowing ? 'Processing...' : activeLoans.length >= 3 ? 'Max 3 concurrent loans' : 'Request Loan'}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 className="card-title">My Loans</h3>
            <div className="table-container" style={{ maxHeight: '480px', overflowY: 'auto' }}>
              <table>
                <thead><tr><th>ID</th><th>Amount</th><th>Rate</th><th>Due</th><th>Remaining</th><th>Action</th></tr></thead>
                <tbody>
                  {loans.length > 0 ? loans.map((loan, i) => {
                    const late = daysLateNow(loan.dueDate);
                    const currentRepay = calcRepayAmount(loan.amount, loan.apy, loan.term, late);
                    const remaining = Math.max(0, currentRepay - loan.amountRepaid);
                    const isActive = loan.status === 'Active' || loan.status === 'Partial';
                    const effectiveRate = loan.apy + Math.floor(late / 2) * 1.5;
                    return (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: '0.7rem', color: 'var(--accent-glow)' }}>{loan.id.slice(-8)}</td>
                        <td style={{ fontWeight: 600 }}>{loan.amount} {loan.asset}</td>
                        <td style={{ color: late > 0 ? '#ef4444' : '#eab308' }}>{effectiveRate.toFixed(1)}%{late > 0 ? '⚠' : ''}</td>
                        <td style={{ fontSize: '0.8rem', color: late > 0 ? '#ef4444' : 'var(--text-muted)', fontWeight: late > 0 ? 700 : 400 }}>
                          {late > 0 ? `${late}d late` : daysUntil(loan.dueDate)}
                        </td>
                        <td style={{ fontSize: '0.85rem', fontWeight: 600 }}>{remaining.toFixed(4)} XLM</td>
                        <td>
                          {isActive ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              <button onClick={() => handleRepay(loan.id)} disabled={repayingId === loan.id}
                                style={{ padding: '0.3rem 0.6rem', borderRadius: '4px', border: 'none', background: 'var(--accent-glow)', color: '#fff', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>
                                {repayingId === loan.id ? '...' : 'Full Repay'}
                              </button>
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <input type="number" step="0.01" placeholder="Partial XLM" value={partialAmt} onChange={e => setPartialAmt(e.target.value)}
                                  style={{ width: '80px', padding: '0.25rem 0.4rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.3)', color: '#fff', fontSize: '0.7rem' }} />
                                <button onClick={() => handleRepay(loan.id, partialAmt)} disabled={!partialAmt || repayingId === loan.id}
                                  style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>
                                  Partial
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className={`badge ${loan.status === 'Completed' ? 'success' : 'warning'}`}>{loan.status}</span>
                          )}
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No loans yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* FIXED DEPOSIT */}
      {tab === 'fixed-deposit' && (
        <div className="grid-2">
          <div className="card">
            <h3 className="card-title">Create Fixed Deposit</h3>
            <p style={{ fontSize: '0.875rem', marginBottom: '1.5rem', color: 'var(--text-muted)' }}>Lock funds for a fixed term. Principal + interest released at maturity.</p>
            <div style={{ padding: '1rem', background: 'rgba(34,197,94,0.05)', borderRadius: '12px', border: '1px solid rgba(34,197,94,0.1)', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Fixed APY</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>{fdApy}%</div>
            </div>
            <form onSubmit={handleFd} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Amount</label>
                <div className="input-wrapper">
                  <input type="number" step="0.01" min="0.01" value={fdAmt} onChange={e => setFdAmt(e.target.value)} placeholder="0.00" className="form-input large" required disabled={isDepositing} />
                  <select className="input-suffix" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-main)' }} value={fdAsset} onChange={e => setFdAsset(e.target.value)}><option value="XLM">XLM</option></select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Lock Term</label>
                <select className="form-input" value={fdTerm} onChange={e => setFdTerm(parseInt(e.target.value))} disabled={isDepositing}>
                  {Object.entries(TERM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {fdPayout && (
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Payout at maturity</span>
                  <span style={{ fontWeight: 700, color: '#22c55e' }}>{fdPayout} {fdAsset}</span>
                </div>
              )}
              <button type="submit" disabled={isDepositing || !fdAmt} className="submit-btn" style={{ backgroundImage: 'linear-gradient(45deg,#22c55e,#16a34a)' }}>
                {isDepositing ? 'Locking...' : 'Lock in Fixed Deposit'}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 className="card-title">My Fixed Deposits</h3>
            <div className="table-container" style={{ maxHeight: '480px', overflowY: 'auto' }}>
              <table>
                <thead><tr><th>ID</th><th>Locked</th><th>Term</th><th>APY</th><th>Payout</th><th>Matures</th><th></th></tr></thead>
                <tbody>
                  {fixedDeposits.length > 0 ? fixedDeposits.map((fd, i) => {
                    const matured = new Date(fd.maturesAt) <= new Date();
                    return (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: '0.7rem', color: 'var(--accent-glow)' }}>
                          {fd.hash ? <a href={`https://stellar.expert/explorer/testnet/tx/${fd.hash}`} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{fd.id.slice(-8)}</a> : fd.id.slice(-8)}
                        </td>
                        <td style={{ fontWeight: 600, color: '#22c55e' }}>{fd.amount} {fd.asset}</td>
                        <td style={{ fontSize: '0.8rem' }}>{TERM_LABELS[fd.term] || `${fd.term}d`}</td>
                        <td style={{ color: '#22c55e' }}>{fd.apy}%</td>
                        <td style={{ fontWeight: 600 }}>{fd.payout} {fd.asset}</td>
                        <td style={{ fontSize: '0.8rem', color: matured ? '#10b981' : 'var(--text-muted)' }}>{matured ? 'Matured ✓' : daysUntil(fd.maturesAt)}</td>
                        <td>
                          {fd.status === 'Active' && matured
                            ? <button onClick={() => handleClaimFd(fd.id)} style={{ padding: '0.3rem 0.6rem', borderRadius: '4px', border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>Claim</button>
                            : <span className={`badge ${fd.status === 'Matured' ? 'success' : 'info'}`}>{fd.status}</span>}
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No fixed deposits yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
