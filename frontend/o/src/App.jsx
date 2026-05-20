/**
 * App.jsx — Root component. Sets up React Router with two branches:
 * public (Landing page) and authenticated (all app pages inside Layout shell).
 * Auth is determined by whether a wallet address exists in the Zustand store.
 * Legacy URL redirects are handled here so old links still work.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useWalletStore } from './store/wallet';

// Shared authenticated shell — wraps all logged-in pages (sidebar, globe, toasts)
import Layout from './components/Layout';

// Page views — each maps to a top-level route
import Landing from './views/Landing';
import Dashboard from './views/Dashboard';
import Escrow from './views/Escrow';
import Arbitration from './views/Arbitration';
import Lending from './views/Lending';
import PaymentHub from './views/PaymentHub';
import CreditScore from './views/CreditScore';
import Liquidation from './views/Liquidation';
import Activity from './views/Activity';
import Overview from './views/Overview';
import Monitor from './views/Monitor';

/**
 * App — the root component.
 * Sets up React Router with two top-level branches:
 *  1. Public: the landing/connect page (no wallet required)
 *  2. Authenticated: all app pages wrapped in the Layout shell
 *
 * Auth is determined by whether a wallet address is in the Zustand store.
 * If connected → redirect to dashboard. If not → show landing page.
 */
export default function App() {
  // Read the connected wallet address from global state
  const { address } = useWalletStore();

  return (
    <BrowserRouter>
      <Routes>
        {/* Root: redirect to dashboard if already connected, otherwise show landing */}
        <Route
          path="/"
          element={
            address
              ? <Navigate to="/dashboard" replace />
              : <div className="login-container"><Landing /></div>
          }
        />

        {/* All authenticated routes share the Layout shell (sidebar + globe background) */}
        <Route element={<Layout />}>
          <Route path="/dashboard"    element={<Dashboard />} />
          <Route path="/overview"     element={<Overview />} />
          <Route path="/payment-hub"  element={<PaymentHub />} />
          <Route path="/escrow"       element={<Escrow />} />
          <Route path="/arbitration"  element={<Arbitration />} />
          <Route path="/lending"      element={<Lending />} />
          <Route path="/liquidation"  element={<Liquidation />} />
          <Route path="/credit-score" element={<CreditScore />} />
          <Route path="/activity"     element={<Activity />} />
          <Route path="/monitor"      element={<Monitor />} />

          {/* Legacy redirects — old URLs still work, they forward to the new paths */}
          <Route path="/portfolio"             element={<Navigate to="/overview" replace />} />
          <Route path="/network-stats"         element={<Navigate to="/overview?tab=network" replace />} />
          <Route path="/network-transactions"  element={<Navigate to="/activity?tab=network" replace />} />
          <Route path="/history"               element={<Navigate to="/activity" replace />} />
          <Route path="/merchant-payments"     element={<Navigate to="/payment-hub" replace />} />
          <Route path="/bulk-payouts"          element={<Navigate to="/payment-hub" replace />} />
        </Route>

        {/* Catch-all: any unknown URL goes back to the root */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
