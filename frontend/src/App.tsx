import { ChatView } from './components/ChatView';
import styles from './App.module.css';

/**
 * There is deliberately no settings panel. The MVP supplies no credentials
 * from the browser — every secret lives on the server — so there is nothing
 * for a user to configure (handoff §5). Do not add one.
 */
export default function App() {
  return (
    <>
      <header className={styles.header}>
        <span className={styles.mark} aria-hidden="true" />
        <span className={styles.name}>Smart Coach Buddy</span>
      </header>
      <ChatView />
    </>
  );
}
