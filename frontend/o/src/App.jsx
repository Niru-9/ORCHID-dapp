import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useWalletStore } from './store/wallet';

import Layout from './components/Layout';
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

export default function App() {
  const { address } = useWalletStore();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={address ? <Navigate to="/dashboard" replace /> : <div className="login-container"><Landing /></div>} />

        <Route element={<Layout />}>
          <Route path="/dashboard"   element={<Dashboard />} />
          <Route path="/overview"    element={<Overview />} />
          <Route path="/payment-hub" element={<PaymentHub />} />
          <Route path="/escrow"      element={<Escrow />} />
          <Route path="/arbitration" element={<Arbitration />} />
          <Route path="/lending"     element={<Lending />} />
          <Route path="/liquidation" element={<Liquidation />} />
          <Route path="/credit-score" element={<CreditScore />} />
          <Route path="/activity"    element={<Activity />} />
          <Route path="/monitor"     element={<Monitor />} />

          {/* Legacy redirects */}
          <Route path="/portfolio"            element={<Navigate to="/overview" replace />} />
          <Route path="/network-stats"        element={<Navigate to="/overview?tab=network" replace />} />
          <Route path="/network-transactions" element={<Navigate to="/activity?tab=network" replace />} />
          <Route path="/history"              element={<Navigate to="/activity" replace />} />
          <Route path="/merchant-payments"    element={<Navigate to="/payment-hub" replace />} />
          <Route path="/bulk-payouts"         element={<Navigate to="/payment-hub" replace />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
