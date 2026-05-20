/**
 * ConfirmModal.jsx — Replaces window.confirm() with a styled in-app modal.
 * Used for all irreversible actions: releasing escrow, raising disputes, refunds, etc.
 * Pass danger=true for red confirm button (destructive actions).
 * Clicking the backdrop cancels — same as the Cancel button.
 */
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ConfirmModal — replaces window.confirm() with a styled in-app modal.
 * Used for all irreversible actions: releasing escrow, raising disputes,
 * resolving disputes, refunds, etc.
 *
 * Usage:
 *   const [modal, setModal] = useState(null);
 *
 *   // Open the modal
 *   setModal({
 *     title: 'Release Funds',
 *     message: 'This will send funds to the seller. Irreversible.',
 *     confirmLabel: 'Release',
 *     danger: false,
 *     onConfirm: () => releaseEscrow(id),
 *   });
 *
 *   // In JSX
 *   <ConfirmModal modal={modal} onClose={() => setModal(null)} />
 *
 * @param {object}   modal          - modal config (null = hidden)
 * @param {string}   modal.title    - modal heading
 * @param {string}   modal.message  - body text (supports \n line breaks)
 * @param {string}   modal.confirmLabel - text for the confirm button (default: 'Confirm')
 * @param {boolean}  modal.danger   - true = red confirm button (destructive action)
 * @param {function} modal.onConfirm - called when the user clicks confirm
 * @param {function} onClose        - called when the user cancels or clicks the backdrop
 */
export default function ConfirmModal({ modal, onClose }) {
  // If no modal data is passed, render nothing
  if (!modal) return null;

  const { title, message, confirmLabel = 'Confirm', danger = false, onConfirm } = modal;

  // Close the modal first, then run the callback — prevents UI flicker
  const handleConfirm = () => {
    onClose();
    onConfirm();
  };

  return (
    <AnimatePresence>
      {modal && (
        <>
          {/* Backdrop — clicking it cancels the action (same as the Cancel button) */}
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

          {/* Modal card — slides up and scales in from center */}
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
            {/* Icon + Title — icon is red for destructive actions, gold for normal ones */}
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

            {/* Descriptive message — supports newlines via pre-line whitespace */}
            <p style={{
              margin: '0 0 1.5rem 0', fontSize: '0.875rem',
              color: 'var(--text-muted, #a1a1aa)', lineHeight: 1.6,
              whiteSpace: 'pre-line',
            }}>
              {message}
            </p>

            {/* Action buttons — Cancel always on the left, Confirm on the right */}
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
              {/* Confirm button is red for dangerous actions, gold for normal ones */}
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
