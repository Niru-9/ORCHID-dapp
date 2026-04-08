/**
 * Orchid Toast Notification System
 * Replaces all alert() calls with proper non-blocking toasts.
 */
import { create } from 'zustand';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, ExternalLink } from 'lucide-react';

// ── Toast Store ───────────────────────────────────────────────────────────────
export const useToast = create((set, get) => ({
  toasts: [],

  toast: (message, type = 'info', options = {}) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const toast = { id, message, type, hash: options.hash, duration: options.duration ?? 5000 };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (toast.duration > 0) {
      setTimeout(() => get().dismiss(id), toast.duration);
    }
    return id;
  },

  success: (msg, opts) => get().toast(msg, 'success', opts),
  error:   (msg, opts) => get().toast(msg, 'error',   { duration: 8000, ...opts }),
  warning: (msg, opts) => get().toast(msg, 'warning', opts),
  info:    (msg, opts) => get().toast(msg, 'info',    opts),

  txSuccess: (msg, hash) => get().toast(msg, 'success', { hash, duration: 8000 }),
  txError:   (msg)       => get().toast(msg, 'error',   { duration: 10000 }),

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  clear:   ()   => set({ toasts: [] }),
}));

// ── Toast UI Component ────────────────────────────────────────────────────────
const ICONS = {
  success: <CheckCircle2 size={18} color="#10b981" />,
  error:   <XCircle     size={18} color="#ef4444" />,
  warning: <AlertTriangle size={18} color="#f59e0b" />,
  info:    <Info        size={18} color="#38bdf8" />,
};

const COLORS = {
  success: { bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.25)', text: '#10b981' },
  error:   { bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.25)',  text: '#ef4444' },
  warning: { bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.25)', text: '#f59e0b' },
  info:    { bg: 'rgba(56,189,248,0.1)',  border: 'rgba(56,189,248,0.25)', text: '#38bdf8' },
};

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
        pointerEvents: 'all',
      }}
    >
      <div style={{ flexShrink: 0, marginTop: '1px' }}>{ICONS[toast.type]}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5, wordBreak: 'break-word' }}>
          {toast.message}
        </div>
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
      <button
        onClick={() => dismiss(toast.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

export default function ToastContainer() {
  const { toasts } = useToast();

  return (
    <div style={{
      position: 'fixed', bottom: '1.5rem', right: '1.5rem',
      display: 'flex', flexDirection: 'column', gap: '0.75rem',
      zIndex: 9999, pointerEvents: 'none',
    }}>
      <AnimatePresence mode="sync">
        {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
      </AnimatePresence>
    </div>
  );
}
