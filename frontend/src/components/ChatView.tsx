import { useState } from 'react';
import { useChat } from '../hooks/useChat';
import { AppHeader } from './AppHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import styles from './ChatView.module.css';

/**
 * The only component that touches useChat. Everything below it takes props,
 * which is what makes the rest of the tree easy to reason about and test.
 */
export function ChatView() {
  const { messages, draft, activity, phase, error, send, stop, retry, reset } = useChat();

  // The composer's text lives here rather than inside Composer so the empty
  // state's example prompts can prefill it.
  const [input, setInput] = useState('');

  function handleSubmit() {
    send(input);
    setInput('');
  }

  function handleNewChat() {
    // The composer's text lives here rather than in the hook, so reset() alone
    // would leave a typed-but-unsent question sitting in the box.
    reset();
    setInput('');
  }

  const isEmpty = messages.length === 0 && phase === 'idle' && !error;

  return (
    <div className={styles.view}>
      {/* isEmpty doubles as "there is nothing to discard". New Chat stays live
          mid-stream, where aborting the turn is a legitimate reset. */}
      <AppHeader onNewChat={handleNewChat} canReset={!isEmpty} />

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
