/**
 * Orchid Toast Notification System
 * ──────────────────────────────────
 * Replaces all alert() / window.confirm() calls with proper non-blocking toasts.
 * Built on Zustand so any component can trigger a toast without prop drilling.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Payment sent!');
 *   toast.error('Transaction failed');
 *   toast.txSuccess('Escrow created', txHash); // includes explorer link
 */
import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, ExternalLink } from 'lucide-react';

// ── Toast Store ───────────────────────────────────────────────────────────────
// Global Zustand store — any component can call useToast() to show notifications
export const useToast = create((set, get) => ({
  toasts: [], // array of active toast objects

  /**
   * toast — core method: adds a toast to the queue and auto-dismisses it.
   * @param message  - text to display
   * @param type     - 'success' | 'error' | 'warning' | 'info'
   * @param options  - { hash?: string, duration?: number }
   *                   hash: Stellar tx hash — adds an explorer link
   *                   duration: ms before auto-dismiss (0 = stays until manually closed)
   */
  toast: (message, type = 'info', options = {}) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toast = { id, message, type, hash: options.hash, duration: options.duration ?? 5000 };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    // duration: 0 means the toast stays until the user manually dismisses it
    if (toast.duration > 0) {
      setTimeout(() => get().dismiss(id), toast.duration);
    }
    return id;
  },

  // Convenience wrappers — errors stay longer (8s) since they need more attention
  success: (msg, opts) => get().toast(msg, 'success', opts),
  error:   (msg, opts) => get().toast(msg, 'error',   { duration: 8000, ...opts }),
  warning: (msg, opts) => get().toast(msg, 'warning', opts),
  info:    (msg, opts) => get().toast(msg, 'info',    opts),

  /**
   * txSuccess — shows a success toast with a clickable Stellar explorer link.
   * Used after every confirmed on-chain transaction.
   * @param msg  - human-readable description (e.g. "Payment sent")
   * @param hash - Stellar transaction hash (64-char hex)
   */
  txSuccess: (msg, hash) => get().toast(msg, 'success', { hash, duration: 8000 }),

  /**
   * txError — shows an error toast that stays for 10 seconds.
   * Used when a transaction fails or is rejected.
   */
  txError: (msg) => get().toast(msg, 'error', { duration: 10000 }),

  /** Remove a single toast by its ID. */
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  /** Clear all active toasts at once. */
  clear: () => set({ toasts: [] }),
}));

// ── Toast UI ──────────────────────────────────────────────────────────────────

// Icon for each toast type
const ICONS = {
  success: <CheckCircle2 size={18} color="#10b981" />,
  error:   <XCircle      size={18} color="#ef4444" />,
  warning: <AlertTriangle size={18} color="#f59e0b" />,
  info:    <Info         size={18} color="#38bdf8" />,
};

// Background, border, and text color for each toast type
const COLORS = {
  success: { bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.25)', text: '#10b981' },
  error:   { bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)',  text: '#ef4444' },
  warning: { bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)', text: '#f59e0b' },
  info:    { bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.25)', text: '#38bdf8' },
};

/**
 * ToastItem — a single toast card.
 * Slides in from the right and fades out when dismissed.
 * If a tx hash is provided, shows a clickable link to the Stellar block explorer.
 */
function ToastItem({ toast }) {
  const { dismiss } = useToast();
  const c = COLORS[toast.type] || COLORS.info;

  return (
    <motion.div
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0,  scale: 1 }}
      exit={{    opacity: 0, x: 60, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
        padding: '0.875rem 1rem',
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: '10px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        maxWidth: '380px',
        width: '100%',
        pointerEvents: 'all', // individual toasts are clickable even though the container is not
      }}
    >
      {/* Type icon (success / error / warning / info) */}
      <div style={{ flexShrink: 0, marginTop: '1px' }}>{ICONS[toast.type]}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Toast message */}
        <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5, wordBreak: 'break-word' }}>
          {toast.message}
        </div>
        {/* If a Stellar tx hash was provided, show a clickable link to the block explorer */}
        {toast.hash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${toast.hash}`}
            target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: c.text, marginTop: '0.35rem', textDecoration: 'none' }}
          >
            {toast.hash.slice(0, 12)}... <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Manual dismiss button */}
      <button
        onClick={() => dismiss(toast.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

/**
 * ToastContainer — positions all active toasts in the bottom-right corner.
 * The container itself is pointer-events: none so it doesn't block clicks on the page.
 * Individual ToastItem components re-enable pointer events for their own area.
 */
export default function ToastContainer() {
  const { toasts } = useToast();

  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
      zIndex: 9999,
      pointerEvents: 'none', // click-through container — individual toasts handle their own clicks
    }}>
      {/* AnimatePresence handles enter/exit animations as toasts are added/removed */}
      <AnimatePresence mode="sync">
        {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
      </AnimatePresence>
    </div>
  );
}
