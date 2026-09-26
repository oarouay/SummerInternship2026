import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, AlertCircle, HelpCircle, Trash2, X, Check } from 'lucide-react';

const ConfirmContext = createContext(null);

/**
 * ConfirmModal: Standalone accessible, anti-slop confirmation dialog.
 * Conforms to WCAG 2.2 AA, role="alertdialog", focus management, keyboard escape, and Emil Kowalski motion.
 */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Please Confirm',
  description = 'Are you sure you want to proceed with this action?',
  confirmText,
  cancelText = 'Cancel',
  variant = 'danger', // 'danger' | 'warning' | 'info'
  details = null,
  isLoading = false
}) {
  const cancelBtnRef = useRef(null);
  const confirmBtnRef = useRef(null);
  const dialogRef = useRef(null);

  // Default confirm text based on variant
  const resolvedConfirmText = confirmText || (variant === 'danger' ? 'Delete' : 'Confirm');

  // Auto-focus the safest option (Cancel) by default when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Focus safe button (Cancel) after modal pop animation starts
      const timer = setTimeout(() => {
        if (variant === 'danger') {
          cancelBtnRef.current?.focus();
        } else {
          confirmBtnRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, variant]);

  // Handle keyboard interaction: Escape closes, Tab traps focus
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusableElements = dialogRef.current?.querySelectorAll(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Icon and tone styling based on variant
  const getVariantStyles = () => {
    switch (variant) {
      case 'warning':
        return {
          icon: <AlertCircle size={20} />,
          iconBg: 'var(--accent-amber-subtle)',
          iconBorder: 'var(--accent-amber-border)',
          iconColor: 'var(--accent-amber-text)',
          glow: 'rgba(245, 158, 11, 0.2)',
          confirmBtnBg: 'var(--accent-amber)',
          confirmBtnColor: '#000000',
          confirmBtnHover: '#D97706'
        };
      case 'info':
        return {
          icon: <HelpCircle size={20} />,
          iconBg: 'var(--accent-primary-subtle)',
          iconBorder: 'var(--accent-primary-border)',
          iconColor: 'var(--accent-primary)',
          glow: 'rgba(146, 156, 255, 0.2)',
          confirmBtnBg: 'var(--accent-primary)',
          confirmBtnColor: 'var(--accent-primary-contrast)',
          confirmBtnHover: 'var(--accent-primary-hover)'
        };
      case 'danger':
      default:
        return {
          icon: <Trash2 size={20} />,
          iconBg: 'var(--accent-rose-subtle)',
          iconBorder: 'var(--accent-rose-border)',
          iconColor: 'var(--accent-rose-text)',
          glow: 'rgba(239, 68, 68, 0.22)',
          confirmBtnBg: '#EF4444',
          confirmBtnColor: '#FFFFFF',
          confirmBtnHover: '#DC2626'
        };
    }
  };

  const style = getVariantStyles();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.68)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '16px',
        animation: 'confirmBackdropFade 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-desc"
        style={{
          width: '100%',
          maxWidth: '430px',
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 24px 60px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px var(--border-hairline)',
          animation: 'confirmModalPop 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
          position: 'relative'
        }}
      >
        {/* Top Header Row with Tone Badge and Close Button */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: style.iconBg,
              border: `1px solid ${style.iconBorder}`,
              color: style.iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: `0 4px 14px ${style.glow}`
            }}
          >
            {style.icon}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="btn-ghost"
            style={{
              padding: '6px',
              borderRadius: '8px',
              color: 'var(--text-muted)',
              cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
            aria-label="Close confirmation dialog"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content: Title & Clear Consequence Description */}
        <div style={{ marginTop: '16px' }}>
          <h2
            id="confirm-modal-title"
            style={{
              fontSize: '16px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.3,
              letterSpacing: '-0.01em',
              margin: 0
            }}
          >
            {title}
          </h2>

          <p
            id="confirm-modal-desc"
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              marginTop: '8px',
              marginBottom: 0
            }}
          >
            {description}
          </p>

          {/* Optional Details Callout */}
          {details && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-hairline)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                lineHeight: 1.5
              }}
            >
              {details}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div
          style={{
            marginTop: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px'
          }}
        >
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="btn btn-secondary"
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              borderRadius: '8px'
            }}
          >
            {cancelText}
          </button>

          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            style={{
              background: style.confirmBtnBg,
              color: style.confirmBtnColor,
              border: 'none',
              borderRadius: '8px',
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: `0 4px 12px ${style.glow}`,
              transition: 'transform var(--transition-fast), opacity var(--transition-fast)'
            }}
          >
            {isLoading ? (
              <span>Processing...</span>
            ) : (
              <>
                {variant === 'danger' && <Trash2 size={13} />}
                {variant === 'info' && <Check size={13} />}
                <span>{resolvedConfirmText}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ConfirmProvider: React Context Provider for application-wide useConfirm() hook.
 * Replaces window.confirm with an asynchronous, promise-based custom modal.
 */
export function ConfirmProvider({ children }) {
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: '',
    description: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'danger',
    details: null,
    resolve: null
  });

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      if (typeof options === 'string') {
        options = { description: options };
      }

      setDialogState({
        isOpen: true,
        title: options.title || (options.variant === 'danger' ? 'Confirm Deletion' : 'Please Confirm'),
        description: options.description || options.message || 'Are you sure you want to proceed?',
        confirmText: options.confirmText,
        cancelText: options.cancelText || 'Cancel',
        variant: options.variant || 'danger',
        details: options.details || null,
        resolve
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    if (dialogState.resolve) {
      dialogState.resolve(false);
    }
    setDialogState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, [dialogState]);

  const handleConfirm = useCallback(() => {
    if (dialogState.resolve) {
      dialogState.resolve(true);
    }
    setDialogState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, [dialogState]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmModal
        isOpen={dialogState.isOpen}
        title={dialogState.title}
        description={dialogState.description}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        variant={dialogState.variant}
        details={dialogState.details}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * useConfirm hook:
 * const confirm = useConfirm();
 * const ok = await confirm({
 *   title: 'Delete Conversation?',
 *   description: 'Permanently remove this session...',
 *   variant: 'danger'
 * });
 * if (!ok) return;
 */
export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}

export default ConfirmModal;
