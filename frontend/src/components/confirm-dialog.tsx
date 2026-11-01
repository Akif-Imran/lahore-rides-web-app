'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation built on the native <dialog>: the browser provides the focus trap, the
 * inert background and Escape handling, and returns focus to the trigger on close. Focus
 * starts on the safe choice.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Go back',
  confirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const safeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      safeButton.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Escape: close through React state so `open` stays the single source of truth.
        event.preventDefault();
        if (!confirming) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-5 shadow-xl backdrop:bg-slate-900/50"
    >
      <h2 id={titleId} className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      <div id={descriptionId} className="mt-2 text-sm text-slate-700">
        {description}
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button ref={safeButton} variant="secondary" onClick={onCancel} disabled={confirming}>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={confirming}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
