import { motion, AnimatePresence } from 'framer-motion';

/**
 * ConfirmModal — replaces window.confirm() with a styled in-app modal.
 *
 * Usage:
 *   const [modal, setModal] = useState(null);
 *   setModal({ title, message, onConfirm: () => doSomething() });
 *   <ConfirmModal modal={modal} onClose={() => setModal(null)} />
 */
export default function ConfirmModal({ modal, onClose }) {
  if (!modal) return null;

  const { title, message, confirmLabel = 'Confirm', danger = false, onConfirm } = modal;

  const handleConfirm = () => {
    onClose();
    onConfirm();
  };

  return (
    <AnimatePresence>
      {modal && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 999,
              background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'fixed', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 1000, width: '100%', maxWidth: '420px',
              background: 'var(--card-bg, #18181b)',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
              borderRadius: '16px', padding: '1.75rem',
              boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
            }}
          >
            {/* Icon + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(201,168,87,0.12)',
                fontSize: '1rem',
              }}>
                {danger ? '⚠️' : '✅'}
              </div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-main, #fff)' }}>
                {title}
              </h3>
            </div>

            {/* Message */}
            <p style={{
              margin: '0 0 1.5rem 0', fontSize: '0.875rem',
              color: 'var(--text-muted, #a1a1aa)', lineHeight: 1.6,
              whiteSpace: 'pre-line',
            }}>
              {message}
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{
                  padding: '0.6rem 1.25rem', borderRadius: '8px', fontWeight: 500,
                  background: 'transparent', border: '1px solid var(--glass-border, rgba(255,255,255,0.1))',
                  color: 'var(--text-muted, #a1a1aa)', cursor: 'pointer', fontSize: '0.875rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  padding: '0.6rem 1.25rem', borderRadius: '8px', fontWeight: 600,
                  background: danger ? '#ef4444' : '#C9A857',
                  border: 'none', color: danger ? '#fff' : '#0E0E10',
                  cursor: 'pointer', fontSize: '0.875rem',
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
