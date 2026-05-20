/**
 * Layout.jsx — Authenticated app shell. Wraps every page after wallet connection.
 * Renders: 3D globe background, sidebar nav, mobile top bar, toast container.
 * Runs background polling: balance every 30s, settlement time every 60s.
 * Redirects to landing page if no wallet is connected.
 */
import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useWalletStore } from '../store/wallet';
import { useNetworkStats } from '../store/networkStats';
import { Canvas } from '@react-three/fiber';
import { Globe } from '../components/Globe';
import Sidebar from '../components/Sidebar';
import ToastContainer from '../components/Toast';
import { Menu, X } from 'lucide-react';

/**
 * Layout — the authenticated app shell.
 * Every page inside the app renders through this component.
 * It owns:
 *  - The 3D globe background (Three.js via @react-three/fiber)
 *  - The sidebar navigation
 *  - The mobile top bar (hamburger menu)
 *  - The global toast notification container
 *  - Background polling intervals (balance, settlement time)
 *
 * If no wallet is connected, it redirects to the landing page.
 */
export default function Layout() {
  const { address, fetchBalance } = useWalletStore();
  const { registerNode, seedLiquidityFromChain, fetchSettlementTime } = useNetworkStats();

  // Controls whether the sidebar drawer is open on mobile
  // (On desktop the sidebar is always visible via CSS)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Once a wallet is connected, kick off background data fetching
  useEffect(() => {
    if (!address) return;

    // Register this wallet as an active node in the network stats
    registerNode(address);

    // Pull initial on-chain liquidity and settlement time
    seedLiquidityFromChain();
    fetchBalance();
    fetchSettlementTime();

    // Keep the balance fresh every 30 seconds
    const balanceInterval = setInterval(fetchBalance, 30000);

    // Refresh settlement time every 60 seconds
    // (was 10s — caused Horizon rate limits)
    const settlementInterval = setInterval(fetchSettlementTime, 60000);

    // Clean up intervals when the component unmounts or the wallet changes
    return () => {
      clearInterval(balanceInterval);
      clearInterval(settlementInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Auth guard — if no wallet is connected, redirect to the landing page
  if (!address) return <Navigate to="/" replace />;

  return (
    <div className="app-layout">
      {/* 3D Background — the animated globe rendered with Three.js */}
      <div className="bg-canvas">
        <Canvas camera={{ position: [0, 0, 8], fov: 45 }}>
          <Globe />
        </Canvas>
      </div>

      {/* Mobile overlay backdrop — tapping it closes the sidebar drawer */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 999, backdropFilter: 'blur(2px)',
          }}
        />
      )}

      {/* Sidebar — always visible on desktop, slides in from the left on mobile */}
      <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content area — the active route's page renders here via <Outlet /> */}
      <div className="main-view">
        {/* Mobile top bar — shows the hamburger menu button and app name */}
        <div className="mobile-topbar">
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.1em' }}>
            ORCHID
          </span>
          {/* Spacer keeps the title visually centered */}
          <div style={{ width: 38 }} />
        </div>

        {/* React Router renders the matched child route here */}
        <Outlet />
      </div>

      {/* Global toast notification container — floats over all content */}
      <ToastContainer />
    </div>
  );
}
