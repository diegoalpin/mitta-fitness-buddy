import type { ChatError } from '../hooks/useChat';
import styles from './ErrorNotice.module.css';

interface Props {
  error: ChatError;
  onRetry: () => void;
}

export function ErrorNotice({ error, onRetry }: Props) {
  // An auth failure is an operator problem — the server is misconfigured.
  // Telling the user to "try again" would just waste their time.
  const retryable = error.kind !== 'upstream_auth' && error.kind !== 'bad_request';

  return (
    <div className={styles.notice} role="alert">
      <p className={styles.message}>{error.message}</p>
      {retryable && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
