import { useEffect, useRef } from 'react';
import bannerUrl from '../assets/5-mitta-lifestyle-banner.png';
import styles from './AboutDialog.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * A native <dialog> driven with showModal(), which supplies the focus trap,
 * Esc-to-close, background inertness and a ::backdrop for free. Hand-rolling
 * any of that would be strictly worse.
 */
export function AboutDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  // `open` is React state but a <dialog> is opened by method call, so the two
  // have to be synced by hand. The el.open checks matter: calling showModal()
  // on an already-open dialog throws InvalidStateError.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="about-title"
      // Esc fires `close` natively. Without this the React flag would stay true
      // and the About button would be dead until something else toggled it.
      onClose={onClose}
      // A click on the backdrop targets the dialog element itself.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {/* Decorative: the prose below already says everything the photo does. */}
      <img className={styles.banner} src={bannerUrl} alt="" />

      <h2 id="about-title" className={styles.title}>
        About Mitta
      </h2>

      <div className={styles.body}>
        <p>
          Mitta is a chat app for understanding where your fitness actually
          stands, and how to build on it. Ask about your recent training, how
          your form and fitness are trending, or how a specific session went,
          and get answers grounded in your own Intervals.icu data.
        </p>
        <p>Read-only — nothing here can change your Intervals.icu account.</p>
      </div>

      <button type="button" className={styles.close} onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
