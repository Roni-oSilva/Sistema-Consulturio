import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { STATUS_LABEL } from '../lib/format';
import { Icon } from './Icon';

export function Spinner({ label = 'Carregando' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Loading({ text = 'Carregando...' }: { text?: string }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

export function Alert({ kind = 'info', children, title }: { kind?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode; title?: string }) {
  const icon = kind === 'error' ? 'alert' : kind === 'success' ? 'checkCircle' : kind === 'warn' ? 'alert' : 'info';
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={20} />
      <div>
        {title && <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 12, padding: '24px 0' }}>
      <Alert kind="error">{error.message}</Alert>
      {onRetry && (
        <div>
          <button className="btn btn-outline" onClick={onRetry}>
            <Icon name="refresh" size={18} /> Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

type FieldProps = {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
};

/** Campo com label, dica e mensagem de erro ligados por aria. */
export function Field({ label, error, hint, optional, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={id}>
        {label} {optional && <span className="optional">(opcional)</span>}
      </label>
      {hint && (
        <span id={hintId} className="hint">
          {hint}
        </span>
      )}
      {children(id, describedBy)}
      {error && (
        <span id={errId} className="field-error">
          <Icon name="alert" size={16} /> {error}
        </span>
      )}
    </div>
  );
}

/** Diálogo modal acessível (foco preso, Esc fecha). */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, select, textarea, [tabindex]:not([tabindex="-1"])')];
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Fechar" data-close>
            <Icon name="x" />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div>{message}</div>
        {children}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}>
            <Icon name={t.kind === 'error' ? 'alert' : 'checkCircle'} size={18} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function EmptyState({ icon = 'calendar', title, children }: { icon?: Parameters<typeof Icon>[0]['name']; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} strokeWidth={1.6} />
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

/** Copia texto para a área de transferência com fallback. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
