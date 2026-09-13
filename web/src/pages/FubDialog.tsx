import { useEffect, useRef, type ReactNode } from 'react';

// The native top layer escapes the record's horizontal scroller and the deck's
// transformed/overflow-hidden slides. Keep styles inside the dialog so they also
// apply when React renders it into a workshop shadow root.
export function FubDialog({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const scope = dialog.getRootNode() as Document | ShadowRoot;
    const previousFocus = scope.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} className="fub-dialog" aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={(event) => { if (!event.currentTarget.open) onClose(); }}>
      <style>{`
        dialog.fub-dialog {
          --k: 1;
          position: fixed; inset: 0; margin: auto; padding: 0;
          width: min(560px, calc(100% - 24px)); max-width: calc(100% - 24px);
          max-height: calc(100dvh - 24px); overflow: auto;
          border: 0; border-radius: 10px; background: #fff; color: #2f3d4a;
          font: 16px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
          box-shadow: 0 26px 60px rgba(19,41,63,.4);
        }
        dialog.fub-dialog::backdrop { background: rgba(19,41,63,.55); }
        dialog.fub-dialog .fub-modal { --k: 1; width: 100%; box-sizing: border-box; padding: 20px; box-shadow: none; }
        dialog.fub-dialog .fub-modalhead { gap: 12px; font-size: 20px; }
        dialog.fub-dialog :is(input, select, button) { min-height: 44px; font-size: 16px; }
        dialog.fub-dialog :is(input, select) { box-sizing: border-box; min-width: 0; }
        dialog.fub-dialog .fub-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        dialog.fub-dialog .fub-two label { min-width: 0; font-size: 14px; }
        dialog.fub-dialog .fub-modalhead button { min-width: 44px; color: #52616c; }
        dialog.fub-dialog .fub-modalfoot { flex-wrap: wrap; }
        dialog.fub-dialog .fub-blue { background: #176ba0; }
        dialog.fub-dialog .fub-blue:disabled { background: #d7e4ec; color: #52616c; }
        dialog.fub-dialog :is(input, select, button):focus-visible { outline: 3px solid #176ba0; outline-offset: 2px; }
        @media (max-width: 440px) {
          dialog.fub-dialog .fub-two { grid-template-columns: minmax(0, 1fr); }
          dialog.fub-dialog .fub-modal { padding: 16px; }
        }
      `}</style>
      {children}
    </dialog>
  );
}
