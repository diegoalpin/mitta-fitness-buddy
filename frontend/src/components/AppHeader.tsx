import { useState } from 'react';
import { AboutDialog } from './AboutDialog';
import logoUrl from '../assets/1-mitta-primary-logo-lockup.png';
import styles from './AppHeader.module.css';

interface Props {
  onNewChat: () => void;
  /** False when there is nothing to discard — disables New Chat. */
  canReset: boolean;
}

export function AppHeader({ onNewChat, canReset }: Props) {
  // The About panel has nothing to do with conversation state, so it owns its
  // own open flag rather than being threaded down from ChatView.
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <header className={styles.header}>
      {/* No visible text carries the product name any more, so the alt does. */}
      <img className={styles.logo} src={logoUrl} alt="Mitta — your fitness partner" />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          onClick={onNewChat}
          disabled={!canReset}
        >
          New Chat
        </button>

        <button
          type="button"
          className={styles.action}
          onClick={() => setAboutOpen(true)}
        >
          About
        </button>
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </header>
  );
}
