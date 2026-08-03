import { useState } from 'react';
import { useChat } from '../hooks/useChat';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import styles from './ChatView.module.css';

/**
 * The only component that touches useChat. Everything below it takes props,
 * which is what makes the rest of the tree easy to reason about and test.
 */
export function ChatView() {
  const { messages, draft, activity, phase, error, send, stop, retry } = useChat();

  // The composer's text lives here rather than inside Composer so the empty
  // state's example prompts can prefill it.
  const [input, setInput] = useState('');

  function handleSubmit() {
    send(input);
    setInput('');
  }

  const isEmpty = messages.length === 0 && phase === 'idle' && !error;

  return (
    <div className={styles.view}>
      {isEmpty ? (
        <EmptyState onPick={setInput} />
      ) : (
        <MessageList
          messages={messages}
          draft={draft}
          activity={activity}
          phase={phase}
          error={error}
          onRetry={retry}
        />
      )}

      <div className={styles.composerBar}>
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onStop={stop}
          phase={phase}
        />
      </div>
    </div>
  );
}
