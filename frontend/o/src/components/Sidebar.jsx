import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import {
  Home, Send, Lock, TrendingUp,
  Hexagon, X, LogOut, Copy, Check,
  BarChart2, MonitorDot, Activity,
} from 'lucide-react';

export default function Sidebar({ onClose }) {
  const { address, balance, disconnect } = useWalletStore();
  const [copied, setCopied] = useState(false);

  // Primary — what users actually do
  const primaryNav = [
    { path: '/dashboard',   label: 'Home',         icon: Home },
    { path: '/payment-hub', label: 'Send Money',   icon: Send },
    { path: '/escrow',      label: 'Lock Funds',   icon: Lock },
    { path: '/lending',     label: 'Earn Yield',   icon: TrendingUp },
  ];

  // Secondary — analytics & tools
  const secondaryNav = [
    { path: '/overview',     label: 'Analytics',      icon: BarChart2 },
    { path: '/activity',     label: 'Transactions',   icon: Activity },
    { path: '/monitor',      label: 'System Status',  icon: MonitorDot },
  ];

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const NavItem = ({ item }) => (
    <NavLink
      to={item.path}
      onClick={onClose}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
    >
      <item.icon size={17} />
      {item.label}
    </NavLink>
  );

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-header">
        <div className="sidebar-logo"><Hexagon size={16} /></div>
        <h1 className="sidebar-title">ORCHID</h1>
        <button onClick={onClose} className="sidebar-close-btn" aria-label="Close menu">
          <X size={20} />
        </button>
      </div>

      {/* Balance pill — most important thing */}
      {address && (
        <div style={{
          margin: '0 0 1.5rem 0',
          padding: '1rem 1.25rem',
          background: 'rgba(201,168,87,0.06)',
          borderRadius: '10px',
          border: '1px solid rgba(201,168,87,0.15)',
        }}>
          <div style={{ fontSize: '0.68rem', color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
            Your Balance
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 600, color: '#F5F5F5', lineHeight: 1 }}>
            {balance ? `${parseFloat(balance).toFixed(2)}` : '0.00'}
            <span style={{ fontSize: '0.82rem', color: '#71717A', marginLeft: '0.35rem', fontWeight: 400 }}>XLM</span>
          </div>
          <button
            onClick={copyAddress}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '0.5rem' }}
            title="Copy wallet address"
          >
            <span style={{ fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace', color: '#71717A' }}>
              {shortAddress}
            </span>
            {copied ? <Check size={11} color="#22C55E" /> : <Copy size={11} color="#71717A" />}
          </button>
        </div>
      )}

      {/* Primary nav */}
      <nav className="nav-menu">
        {primaryNav.map(item => <NavItem key={item.path} item={item} />)}

        {/* Divider */}
        <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '0.75rem 0' }} />
        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 1rem', marginBottom: '0.25rem', fontWeight: 700 }}>
          Analytics
        </div>

        {secondaryNav.map(item => <NavItem key={item.path} item={item} />)}
      </nav>

      {/* Disconnect */}
      <div className="sidebar-footer">
        <button
          className="nav-item"
          style={{ color: 'var(--error-text)' }}
          onClick={() => { disconnect(); onClose?.(); }}
        >
          <LogOut size={17} />
          Disconnect
        </button>
      </div>
    </aside>
  );
}
