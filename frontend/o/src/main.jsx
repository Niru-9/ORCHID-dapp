/**
 * main.jsx — Entry point. Mounts the React app into #root in index.html.
 * StrictMode adds extra dev-time warnings (no effect in production).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './main.css';

/**
 * Entry point — mounts the React app into the #root div in index.html.
 *
 * StrictMode enables extra runtime warnings during development:
 *  - Detects components with side effects in render
 *  - Warns about deprecated lifecycle methods
 *  - Double-invokes certain functions to surface bugs early
 * Has no effect in production builds.
 */
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
