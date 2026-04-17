/**
 * Overview — combines Portfolio (my positions) + Network Stats (protocol metrics)
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletStore } from '../store/wallet';
import { useLendingStore, calcRepayAmount } from '../store/lending';
import { useAnalytics } from '../store/analytics';
import { useNetworkStats } from '../store/networkStats';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Shield, Landmark, Coins, BarChart2, ExternalLink, AlertTriangle, Users, Activity, Globe } from 'lucide-react';

function StatCard({ label, value, sub, color, icon: Icon, onClick, desc }) {
  return (
    <motion.div
      className="card"
      style={{ cursor: onClick ? 'pointer' : 'default', borderTop: `2px solid ${color}`, background: `linear-gradient(135deg,var(--bg-surface) 0%,${color}08 100%)` }}
      whileHover={onClick ? { scale: 1.01 } : {}}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={16} color={color} />
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
      </div>
      <div style={{ fontSize: '1.9rem', fontWeight: 800, fontFamily: 'Orbitron,sans-serif', color, lineHeight: 1, marginBottom: '0.4rem' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 500 }}>{sub}</div>}
      {desc && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.65, marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '0.6rem' }}>{desc}</p>}
      {onClick && <div style={{ fontSize: '0.75rem', color, marginTop: '0.75rem', fontWeight: 600 }}>Manage →</div>}
    </motion.div>
  );
}

// ── My Portfolio Tab ──────────────────────────────────────────────────────────
function MyPortfolio() {
  const { address, balance } = useWalletStore();
  const { loans, deposits, fixedDeposits, creditScore, fetchPoolBalance } = useLendingStore();
  const navigate = useNavigate();
  const [onChainCollateral, setOnChainCollateral] = useState(null);
  const [onChainHealth, setOnChainHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPoolBalance();
    if (!address) return;
    const fetch = async () => {
      setLoading(true);
      try {
        const { getCollateral, getHealthFactor } = await import('../store/pool_contract.js');
        const [col, health] = await Promise.all([getCollateral(address), getHealthFactor(address)]);
        setOnChainCollateral(col!==null?Number(col)/1e7:0);
        setOnChainHealth(health!==null?Number(health)/10000:null);
      } catch(_) {}
      setLoading(false);
    };
    fetch();
    const t = setInterval(fetch, 30_000);
    return () => clearInterval(t);
  }, [address, fetchPoolBalance]);

  const totalSupplied = deposits.reduce((a,d)=>a+d.amount,0);
  const activeLoans = loans.filter(l=>l.status==='Active'||l.status==='Partial');
  const totalBorrowed = activeLoans.reduce((a,l)=>{const dl=Math.max(0,Math.ceil((Date.now()-new Date(l.dueDate))/86400000));return a+calcRepayAmount(l.amount,l.apy,l.term,dl)-l.amountRepaid;},0);
  const activeFDs = fixedDeposits.filter(f=>f.status==='Active');
  const totalFDLocked = activeFDs.reduce((a,f)=>a+f.amount,0);
  const maturedFDs = activeFDs.filter(f=>new Date(f.maturesAt)<=new Date());
  const netPosition = totalSupplied+totalFDLocked-totalBorrowed;
  const netColor = netPosition>=0?'#10b981':'#ef4444';
  const scoreColor = creditScore>=720?'#10b981':creditScore>=640?'#34d399':creditScore>=540?'#f59e0b':creditScore>=400?'#f97316':'#ef4444';
  const healthColor = onChainHealth===null?'var(--text-muted)':onChainHealth>=1.5?'#10b981':onChainHealth>=1.1?'#f59e0b':'#ef4444';

  return (
    <div>
      {maturedFDs.length>0&&<motion.div initial={{opacity:0}} animate={{opacity:1}} style={{padding:'0.875rem 1rem',marginBottom:'1.5rem',borderRadius:'10px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',display:'flex',alignItems:'center',gap:'0.75rem',cursor:'pointer'}} onClick={()=>navigate('/lending')}><Coins size={18} color="#22c55e"/><span style={{fontSize:'0.875rem',color:'#22c55e',fontWeight:600}}>{maturedFDs.length} Fixed Deposit{maturedFDs.length>1?'s':''} matured — claim your payout →</span></motion.div>}
      {onChainHealth!==null&&onChainHealth<1.2&&onChainHealth>0&&<motion.div initial={{opacity:0}} animate={{opacity:1}} style={{padding:'0.875rem 1rem',marginBottom:'1.5rem',borderRadius:'10px',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',display:'flex',alignItems:'center',gap:'0.75rem'}}><AlertTriangle size={18} color="#ef4444"/><span style={{fontSize:'0.875rem',color:'#ef4444',fontWeight:600}}>Health factor {onChainHealth.toFixed(2)} — at risk of liquidation. Add collateral or repay loans.</span></motion.div>}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'1.25rem', marginBottom:'2rem' }}>
        <StatCard label="Wallet Balance" value={`${parseFloat(balance||0).toFixed(2)} XLM`} sub="Available to spend" desc="Your current XLM balance available for payments, escrow, or collateral deposits." color="#38bdf8" icon={Coins}/>
        <StatCard label="Total Supplied" value={`${totalSupplied.toFixed(2)} XLM`} sub={`${deposits.length} position${deposits.length!==1?'s':''}`} desc="XLM you have supplied to the lending pool. Earning dynamic APY on every block." color="#10b981" icon={TrendingUp} onClick={()=>navigate('/lending')}/>
        <StatCard label="Total Borrowed" value={`${totalBorrowed.toFixed(2)} XLM`} sub={`${activeLoans.length} active loan${activeLoans.length!==1?'s':''}`} desc="Outstanding debt including accrued interest. Repay on time to protect your credit score." color={totalBorrowed>0?'#ef4444':'var(--text-muted)'} icon={TrendingDown} onClick={()=>navigate('/lending')}/>
        <StatCard label="FD Locked" value={`${totalFDLocked.toFixed(2)} XLM`} sub={`${activeFDs.length} deposit${activeFDs.length!==1?'s':''}`} desc="Funds locked in fixed deposits earning guaranteed APY. Released automatically at maturity." color="#a855f7" icon={Landmark} onClick={()=>navigate('/lending')}/>
        <StatCard label="Collateral" value={loading?'...':`${(onChainCollateral||0).toFixed(2)} XLM`} sub="Locked in pool contract" desc="XLM deposited as collateral. Determines your maximum borrowing capacity and health factor." color="#f59e0b" icon={Shield} onClick={()=>navigate('/lending')}/>
        <StatCard label="Health Factor" value={loading?'...':onChainHealth!==null?onChainHealth.toFixed(2):'—'} sub={onChainHealth===null?'No active debt':onChainHealth>=1.5?'Safe — well collateralised':onChainHealth>=1.1?'Caution — add collateral':'At Risk — liquidation possible'} desc="Ratio of collateral value to debt. Must stay above 1.0 to avoid liquidation. Above 1.5 is safe." color={healthColor} icon={BarChart2}/>
      </div>

      <div className="card" style={{ marginBottom:'2rem', border:`1px solid ${netColor}22`, background:`linear-gradient(135deg,var(--bg-surface) 0%,${netColor}06 100%)` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap: '2rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:700, marginBottom:'0.5rem' }}>Net DeFi Position</div>
            <div style={{ fontSize:'2.5rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color:netColor, lineHeight: 1 }}>{netPosition>=0?'+':''}{netPosition.toFixed(2)} XLM</div>
            <p style={{ fontSize:'0.875rem', color:'var(--text-muted)', marginTop:'0.6rem', lineHeight: 1.7 }}>
              Your net position is calculated as total supplied liquidity plus fixed deposits, minus all outstanding debt. A positive number means you are a net lender — you have more capital working for you than you owe.
            </p>
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.5rem', fontFamily:'JetBrains Mono, monospace' }}>
              {totalSupplied.toFixed(2)} supplied + {totalFDLocked.toFixed(2)} FD − {totalBorrowed.toFixed(2)} debt
            </div>
          </div>
          <div style={{ textAlign:'right', flexShrink: 0 }}>
            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:700, marginBottom:'0.5rem' }}>Credit Score</div>
            <div style={{ fontSize:'2.5rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color:scoreColor, lineHeight: 1 }}>{creditScore}</div>
            <div style={{ fontSize:'0.72rem', padding:'0.25rem 0.75rem', borderRadius:'999px', background:`${scoreColor}18`, color:scoreColor, fontWeight:700, display:'inline-block', marginTop:'0.5rem' }}>{creditScore>=720?'Excellent':creditScore>=640?'Good':creditScore>=540?'Fair':creditScore>=400?'Poor':'Very Poor'}</div>
            <p style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.5rem', lineHeight: 1.6, maxWidth: 180 }}>
              {creditScore >= 720 ? 'Best rates available.' : creditScore >= 640 ? 'Good standing. Most products available.' : creditScore >= 400 ? 'Repay on time to improve.' : 'Borrowing restricted.'}
            </p>
          </div>
        </div>
      </div>

      {activeLoans.length>0&&(
        <div className="card">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
            <h3 className="card-title" style={{ margin:0 }}>Active Loans</h3>
            <button onClick={()=>navigate('/lending')} style={{ fontSize:'0.75rem', color:'var(--accent-glow)', background:'none', border:'none', cursor:'pointer' }}>Manage →</button>
          </div>
          <div className="table-container">
            <table>
              <thead><tr><th>ID</th><th>Amount</th><th>Rate</th><th>Due</th><th>Remaining</th><th>Status</th></tr></thead>
              <tbody>
                {activeLoans.map((loan,i)=>{
                  const dl=Math.max(0,Math.ceil((Date.now()-new Date(loan.dueDate))/86400000));
                  const rem=calcRepayAmount(loan.amount,loan.apy,loan.term,dl)-loan.amountRepaid;
                  return(<tr key={i}><td className="mono" style={{fontSize:'0.72rem',color:'var(--accent-glow)'}}>{loan.id.slice(-8)}</td><td style={{fontWeight:600}}>{loan.amount} {loan.asset}</td><td style={{color:dl>0?'#ef4444':'#eab308'}}>{(loan.apy+Math.floor(dl/2)*1.5).toFixed(1)}%</td><td style={{color:dl>0?'#ef4444':'var(--text-muted)',fontWeight:dl>0?700:400,fontSize:'0.8rem'}}>{dl>0?`${dl}d overdue`:new Date(loan.dueDate).toLocaleDateString()}</td><td style={{fontWeight:600,color:dl>0?'#ef4444':'var(--text-main)'}}>{rem.toFixed(4)} XLM</td><td><span className={`badge ${dl>0?'error':'warning'}`}>{dl>0?'Overdue':'Active'}</span></td></tr>);
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Network Stats Tab ─────────────────────────────────────────────────────────
function NetworkStatsTab() {
  const { totalVolume, nodeCount, successCount, failCount, poolBalance, escrowBalance, ledgerSettlementSec, networkStatus, networkColor, fetchBalances, fetchSettlementTime, fetchBackendMetrics, backendAccuracy } = useAnalytics();
  const { settlementTime } = useNetworkStats();
  const { loans, deposits, fixedDeposits } = useLendingStore();
  const { transactions } = useWalletStore();

  useEffect(() => {
    fetchBalances(); fetchSettlementTime(); fetchBackendMetrics();
    const t1=setInterval(fetchBalances,30_000); const t2=setInterval(fetchBackendMetrics,15_000);
    return ()=>{clearInterval(t1);clearInterval(t2);};
  }, [fetchBalances, fetchSettlementTime, fetchBackendMetrics]);

  const totalAttempted=successCount+failCount;
  // Use real backend accuracy — fall back to local only if backend hasn't responded
  const accuracy = backendAccuracy !== null && backendAccuracy !== undefined
    ? backendAccuracy.toFixed(1)
    : totalAttempted > 0
    ? ((successCount/totalAttempted)*100).toFixed(1)
    : '—';
  const accuracyColor=parseFloat(accuracy)>=95?'#10b981':parseFloat(accuracy)>=80?'#f59e0b':'#ef4444';
  const settleTime=ledgerSettlementSec||settlementTime;
  const tvl=poolBalance+escrowBalance;
  const totalBorrowed=loans.filter(l=>l.status==='Active'||l.status==='Partial').reduce((a,l)=>a+l.amount,0);
  const totalSupplied=deposits.reduce((a,d)=>a+d.amount,0);
  const totalFDLocked=fixedDeposits.filter(f=>f.status==='Active').reduce((a,f)=>a+f.amount,0);
  const escrowTxs=transactions.filter(t=>t.type==='Create Escrow');
  const activeEscrows=escrowTxs.filter(t=>t.status==='Funded'||t.status==='Delivered').length;

  const fmt=(n,d=2)=>n>=1_000_000?`${(n/1_000_000).toFixed(d)}M`:n>=1_000?`${(n/1_000).toFixed(d)}K`:parseFloat(n).toFixed(d);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'2rem' }}>
      <div>
        <div className="section-label" style={{ marginBottom: '0.75rem' }}>Network Health</div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '1.25rem', maxWidth: 640 }}>
          Live metrics pulled directly from Stellar Horizon. Settlement time is the average ledger close interval. Accuracy is the ratio of successful to total transactions recorded by Orchid.
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'1.25rem' }}>
          <StatCard label="Total Nodes" value={nodeCount||'—'} sub="Unique wallets connected" desc="Every wallet that has ever connected to Orchid counts as one node. No duplicates." color="#a855f7" icon={Users}/>
          <StatCard label="Network Accuracy" value={`${accuracy}%`} sub={networkStatus} desc="Percentage of transactions that confirmed successfully. Below 95% indicates network issues." color={accuracyColor} icon={Activity}/>
          <StatCard label="Settlement Time" value={settleTime?`${settleTime}s`:'—'} sub="Avg ledger close time" desc="How long it takes for a transaction to be permanently recorded on the Stellar blockchain." color={networkColor} icon={Globe}/>
        </div>
      </div>
      <div>
        <div className="section-label" style={{ marginBottom: '0.75rem' }}>Volume & TVL</div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '1.25rem', maxWidth: 640 }}>
          Total value locked across the lending pool and escrow contracts. Volume counts all confirmed transactions — payments, borrows, repayments, and escrow releases.
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'1.25rem' }}>
          <StatCard label="Total Volume" value={totalVolume>0?`${fmt(totalVolume)} XLM`:tvl>0?`${fmt(tvl)} XLM`:'—'} sub="All confirmed transactions" desc="Cumulative XLM moved through all Orchid services since launch." color="#38bdf8" icon={Coins}/>
          <StatCard label="Pool Liquidity" value={`${fmt(poolBalance)} XLM`} sub="Available to borrow" desc="XLM currently sitting in the lending pool, available for borrowers to draw against." color="#22c55e" icon={Landmark}/>
          <StatCard label="Escrow Locked" value={`${fmt(escrowBalance)} XLM`} sub="In active contracts" desc="XLM locked in escrow contracts awaiting delivery confirmation or expiry." color="#f59e0b" icon={Shield}/>
        </div>
      </div>
      <div>
        <div className="section-label" style={{ marginBottom: '0.75rem' }}>Protocol Activity</div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: '1.25rem', maxWidth: 640 }}>
          Breakdown of capital flows across the lending protocol — how much has been supplied, borrowed, locked in fixed deposits, and held in active escrow contracts.
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'1.25rem' }}>
          <StatCard label="Total Supplied" value={`${fmt(totalSupplied)} XLM`} sub="Liquidity contributions" desc="XLM supplied by all users to the lending pool, earning dynamic APY." color="#10b981" icon={TrendingUp}/>
          <StatCard label="Total Borrowed" value={`${fmt(totalBorrowed)} XLM`} sub="Active debt" desc="Outstanding loan principal across all active borrowers in the protocol." color="#ef4444" icon={TrendingDown}/>
          <StatCard label="FD Locked" value={`${fmt(totalFDLocked)} XLM`} sub="Fixed deposits" desc="XLM locked in fixed-term deposits earning guaranteed APY until maturity." color="#a855f7" icon={Landmark}/>
          <StatCard label="Active Escrows" value={activeEscrows||'0'} sub={`${escrowTxs.length} total contracts`} desc="Escrow contracts currently in Funded or Delivered state, awaiting resolution." color="#f59e0b" icon={Shield}/>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Overview() {
  const [tab, setTab] = useState('portfolio');

  return (
    <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}>
      <div className="view-header">
        <div>
          <div className="section-label">Your Position</div>
          <h2 className="view-title">Overview</h2>
          <p className="view-subtitle">
            A complete picture of your DeFi activity on Orchid — wallet balance, supplied liquidity, active loans, fixed deposits, collateral health, and live protocol metrics. Everything updates in real time from the Stellar blockchain.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', marginBottom: '2rem', border: '1px solid var(--border)', borderRadius: '0.75rem', overflow: 'hidden' }}>
        {[['portfolio','My Portfolio','Your supplied liquidity, active loans, FD positions, and net DeFi balance.'],['network','Network Stats','Live protocol metrics: volume, TVL, settlement time, and accuracy.']].map(([id,label,desc],i)=>(
          <button key={id} onClick={()=>setTab(id)} style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', padding:'1.25rem 1.5rem', border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.875rem', background:tab===id?'rgba(56,189,248,0.06)':'var(--bg-surface)', color:tab===id?'var(--text-main)':'var(--text-muted)', borderBottom:tab===id?'2px solid var(--accent)':'2px solid transparent', borderRight:i===0?'1px solid var(--border)':'none', transition:'all 0.2s', textAlign:'left' }}>
            <span style={{ fontWeight: 700, marginBottom: '0.2rem' }}>{label}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.5 }}>{desc}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{opacity:0,x:10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-10}} transition={{duration:0.15}}>
          {tab==='portfolio'?<MyPortfolio/>:<NetworkStatsTab/>}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
