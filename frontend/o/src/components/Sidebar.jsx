/**
 * Sidebar.jsx — Main navigation panel.
 * Always visible on desktop, slides in as a drawer on mobile.
 * Shows: wallet balance, copyable address, primary nav links, analytics links, disconnect button.
 */
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import {
  Home, Send, Lock, TrendingUp,
  Hexagon, X, LogOut, Copy, Check,
  BarChart2, MonitorDot, Activity, Scale,
} from 'lucide-react';

/**
 * Sidebar — the main navigation panel.
 * Always visible on desktop. On mobile it's a drawer that slides in from the left.
 *
 * Contains:
 *  - App logo + name
 *  - Wallet balance pill with copyable address
 *  - Primary nav (core user actions)
 *  - Secondary nav (analytics + system tools)
 *  - Disconnect button
 *
 * @param {function} onClose - called when a nav link is tapped on mobile (closes the drawer)
 */
export default function Sidebar({ onClose }) {
  const { address, balance, disconnect } = useWalletStore();

  // Tracks whether the address was just copied — shows a checkmark for 1.5s
  const [copied, setCopied] = useState(false);

  // Primary nav — the core actions users come here to do
  const primaryNav = [
    { path: '/dashboard',    label: 'Home',         icon: Home },
    { path: '/payment-hub',  label: 'Send Money',   icon: Send },
    { path: '/escrow',       label: 'Lock Funds',   icon: Lock },
    { path: '/arbitration',  label: 'Arbitration',  icon: Scale },
    { path: '/lending',      label: 'Earn Yield',   icon: TrendingUp },
  ];

  // Secondary nav — analytics and system monitoring tools
  const secondaryNav = [
    { path: '/overview',     label: 'Analytics',      icon: BarChart2 },
    { path: '/activity',     label: 'Transactions',   icon: Activity },
    { path: '/monitor',      label: 'System Status',  icon: MonitorDot },
  ];

  // Shorten the wallet address for display: "GABCD...1234"
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  // Copy the full wallet address to clipboard and briefly show a checkmark
  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /**
   * NavItem — a single navigation link.
   * Uses React Router's NavLink so the active route is automatically highlighted.
   * Calls onClose when tapped on mobile to close the sidebar drawer.
   */
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
      {/* Logo + app name + close button (close button only visible on mobile) */}
      <div className="sidebar-header">
        <div className="sidebar-logo"><Hexagon size={16} /></div>
        <h1 className="sidebar-title">ORCHID</h1>
        <button onClick={onClose} className="sidebar-close-btn" aria-label="Close menu">
          <X size={20} />
        </button>
      </div>

      {/* Balance pill — shows XLM balance and a copyable shortened address */}
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
          {/* Balance with 2 decimal places — shows 0.00 while loading */}
          <div style={{ fontSize: '1.4rem', fontWeight: 600, color: '#F5F5F5', lineHeight: 1 }}>
            {balance ? `${parseFloat(balance).toFixed(2)}` : '0.00'}
            <span style={{ fontSize: '0.82rem', color: '#71717A', marginLeft: '0.35rem', fontWeight: 400 }}>XLM</span>
          </div>
          {/* Tap to copy the full wallet address to clipboard */}
          <button
            onClick={copyAddress}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '0.5rem' }}
            title="Copy wallet address"
          >
            <span style={{ fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace', color: '#71717A' }}>
              {shortAddress}
            </span>
            {/* Icon flips to a checkmark for 1.5s after copying */}
            {copied ? <Check size={11} color="#22C55E" /> : <Copy size={11} color="#71717A" />}
          </button>
        </div>
      )}

      {/* Navigation links */}
      <nav className="nav-menu">
        {/* Primary actions — the main things users do in the app */}
        {primaryNav.map(item => <NavItem key={item.path} item={item} />)}

        {/* Visual divider between primary and analytics sections */}
        <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '0.75rem 0' }} />
        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 1rem', marginBottom: '0.25rem', fontWeight: 700 }}>
          Analytics
        </div>

        {/* Secondary analytics and monitoring links */}
        {secondaryNav.map(item => <NavItem key={item.path} item={item} />)}
      </nav>

      {/* Disconnect button — always at the bottom of the sidebar */}
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
