import type { ChatMessage } from '../types/wire';
import { Markdown } from './Markdown';
import styles from './MessageBubble.module.css';

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={isUser ? styles.userRow : styles.assistantRow}>
      {isUser ? (
        // User text is rendered as plain text, never as markdown — what they
        // typed is what they should see.
        <div className={styles.userBubble}>{message.content}</div>
      ) : (
        <div className={styles.assistantBody}>
          <Markdown>{message.content}</Markdown>
        </div>
      )}
    </div>
  );
}
