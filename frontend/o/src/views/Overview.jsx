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

function StatCard({ label, value, sub, color, icon: Icon, onClick }) {
  return (
    <motion.div className="card" style={{ cursor:onClick?'pointer':'default', border:`1px solid ${color}22`, background:`linear-gradient(135deg,var(--bg-surface) 0%,${color}08 100%)` }} whileHover={onClick?{scale:1.02}:{}} onClick={onClick}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.75rem' }}>
        <div style={{ width:'36px', height:'36px', borderRadius:'8px', background:`${color}18`, border:`1px solid ${color}30`, display:'flex', alignItems:'center', justifyContent:'center' }}><Icon size={16} color={color}/></div>
        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600 }}>{label}</div>
      </div>
      <div style={{ fontSize:'1.75rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color, lineHeight:1 }}>{value}</div>
      {sub&&<div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.4rem' }}>{sub}</div>}
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

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'1rem', marginBottom:'2rem' }}>
        <StatCard label="Wallet Balance" value={`${parseFloat(balance||0).toFixed(2)} XLM`} sub="Available" color="#38bdf8" icon={Coins}/>
        <StatCard label="Total Supplied" value={`${totalSupplied.toFixed(2)} XLM`} sub={`${deposits.length} position${deposits.length!==1?'s':''}`} color="#10b981" icon={TrendingUp} onClick={()=>navigate('/lending')}/>
        <StatCard label="Total Borrowed" value={`${totalBorrowed.toFixed(2)} XLM`} sub={`${activeLoans.length} active loan${activeLoans.length!==1?'s':''}`} color={totalBorrowed>0?'#ef4444':'var(--text-muted)'} icon={TrendingDown} onClick={()=>navigate('/lending')}/>
        <StatCard label="FD Locked" value={`${totalFDLocked.toFixed(2)} XLM`} sub={`${activeFDs.length} deposit${activeFDs.length!==1?'s':''}`} color="#a855f7" icon={Landmark} onClick={()=>navigate('/lending')}/>
        <StatCard label="Collateral" value={loading?'...`':`${(onChainCollateral||0).toFixed(2)} XLM`} sub="In pool contract" color="#f59e0b" icon={Shield} onClick={()=>navigate('/lending')}/>
        <StatCard label="Health Factor" value={loading?'...':onChainHealth!==null?onChainHealth.toFixed(2):'—'} sub={onChainHealth===null?'No debt':onChainHealth>=1.5?'Safe':onChainHealth>=1.1?'Caution':'At Risk'} color={healthColor} icon={BarChart2}/>
      </div>

      <div className="card" style={{ marginBottom:'1.5rem', border:`1px solid ${netColor}22`, background:`linear-gradient(135deg,var(--bg-surface) 0%,${netColor}06 100%)` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600, marginBottom:'0.5rem' }}>Net DeFi Position</div>
            <div style={{ fontSize:'2.25rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color:netColor }}>{netPosition>=0?'+':''}{netPosition.toFixed(2)} XLM</div>
            <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:'0.35rem' }}>Supplied + FD − Outstanding Debt</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600, marginBottom:'0.5rem' }}>Credit Score</div>
            <div style={{ fontSize:'2rem', fontWeight:800, fontFamily:'Orbitron,sans-serif', color:scoreColor }}>{creditScore}</div>
            <div style={{ fontSize:'0.72rem', padding:'0.2rem 0.6rem', borderRadius:'999px', background:`${scoreColor}18`, color:scoreColor, fontWeight:700, display:'inline-block', marginTop:'0.35rem' }}>{creditScore>=720?'Excellent':creditScore>=640?'Good':creditScore>=540?'Fair':creditScore>=400?'Poor':'Very Poor'}</div>
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
  const { totalVolume, nodeCount, successCount, failCount, poolBalance, escrowBalance, ledgerSettlementSec, networkStatus, networkColor, fetchBalances, fetchSettlementTime, fetchBackendMetrics } = useAnalytics();
  const { settlementTime } = useNetworkStats();
  const { loans, deposits, fixedDeposits } = useLendingStore();
  const { transactions } = useWalletStore();

  useEffect(() => {
    fetchBalances(); fetchSettlementTime(); fetchBackendMetrics();
    const t1=setInterval(fetchBalances,30_000); const t2=setInterval(fetchBackendMetrics,15_000);
    return ()=>{clearInterval(t1);clearInterval(t2);};
  }, [fetchBalances, fetchSettlementTime, fetchBackendMetrics]);

  const totalAttempted=successCount+failCount;
  const accuracy=totalAttempted>0?((successCount/totalAttempted)*100).toFixed(1):'100.0';
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
    <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>
      <div>
        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:700, marginBottom:'0.75rem' }}>Network</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'1rem' }}>
          <StatCard label="Total Nodes" value={nodeCount||'—'} sub="Unique wallets" color="#a855f7" icon={Users}/>
          <StatCard label="Network Accuracy" value={`${accuracy}%`} sub={networkStatus} color={accuracyColor} icon={Activity}/>
          <StatCard label="Settlement Time" value={settleTime?`${settleTime}s`:'—'} sub={networkStatus} color={networkColor} icon={Globe}/>
        </div>
      </div>
      <div>
        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:700, marginBottom:'0.75rem' }}>Volume & TVL</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'1rem' }}>
          <StatCard label="Total Volume" value={totalVolume>0?`${fmt(totalVolume)} XLM`:tvl>0?`${fmt(tvl)} XLM`:'—'} sub="All confirmed txs" color="#38bdf8" icon={Coins}/>
          <StatCard label="Pool Liquidity" value={`${fmt(poolBalance)} XLM`} sub="Live pool balance" color="#22c55e" icon={Landmark}/>
          <StatCard label="Escrow Locked" value={`${fmt(escrowBalance)} XLM`} sub="Live escrow balance" color="#f59e0b" icon={Shield}/>
        </div>
      </div>
      <div>
        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:700, marginBottom:'0.75rem' }}>Protocol</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'1rem' }}>
          <StatCard label="Total Supplied" value={`${fmt(totalSupplied)} XLM`} sub="Liquidity contributions" color="#10b981" icon={TrendingUp}/>
          <StatCard label="Total Borrowed" value={`${fmt(totalBorrowed)} XLM`} sub="Active debt" color="#ef4444" icon={TrendingDown}/>
          <StatCard label="FD Locked" value={`${fmt(totalFDLocked)} XLM`} sub="Fixed deposits" color="#a855f7" icon={Landmark}/>
          <StatCard label="Active Escrows" value={activeEscrows||'0'} sub={`${escrowTxs.length} total contracts`} color="#f59e0b" icon={Shield}/>
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
          <h2 className="view-title">Overview</h2>
          <p className="view-subtitle">Your portfolio positions and live protocol metrics.</p>
        </div>
      </div>

      <div style={{ display:'flex', gap:'0.75rem', marginBottom:'2rem', background:'rgba(255,255,255,0.03)', border:'1px solid var(--glass-border)', borderRadius:'12px', padding:'0.4rem' }}>
        {[['portfolio','My Portfolio'],['network','Network Stats']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:'0.65rem 1rem', borderRadius:'8px', border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.875rem', background:tab===id?'rgba(56,189,248,0.1)':'transparent', color:tab===id?'var(--accent-glow)':'var(--text-muted)', borderBottom:tab===id?'2px solid var(--accent-glow)':'2px solid transparent', transition:'all 0.2s' }}>{label}</button>
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
