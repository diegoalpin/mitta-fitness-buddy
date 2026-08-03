import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types/wire';
import type { ChatError, Phase, ToolActivity as Activity } from '../hooks/useChat';
import { MessageBubble } from './MessageBubble';
import { ToolActivity } from './ToolActivity';
import { ErrorNotice } from './ErrorNotice';
import { Markdown } from './Markdown';
import styles from './MessageList.module.css';

interface Props {
  messages: ChatMessage[];
  draft: string;
  activity: Activity[];
  phase: Phase;
  error: ChatError | null;
  onRetry: () => void;
}

/** How close to the bottom counts as "following along", in pixels. */
const PIN_THRESHOLD_PX = 120;

export function MessageList({
  messages,
  draft,
  activity,
  phase,
  error,
  onRetry,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // A ref, not state: whether the user is pinned to the bottom changes on
  // every scroll event and must never trigger a re-render.
  const pinnedRef = useRef(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom < PIN_THRESHOLD_PX;
  }

  // Auto-scroll ONLY if the user was already near the bottom. Yanking someone
  // back down while they scroll up to reread an earlier answer is infuriating.
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, draft, activity]);

  return (
    <div className={styles.scroller} ref={containerRef} onScroll={handleScroll}>
      <div
        className={styles.column}
        aria-live="polite"
        // Read only what is new, rather than re-reading the whole conversation
        // on every streamed token.
        aria-atomic="false"
      >
        {messages.map((message, index) => (
          // Index as key is safe HERE and only here: this list is append-only,
          // never reordered and never filtered. Anywhere else, use a real id.
          <MessageBubble key={index} message={message} />
        ))}

        {(phase !== 'idle' || activity.length > 0) && (
          <div className={styles.pending}>
            <ToolActivity activity={activity} />

            {draft ? (
              <Markdown>{draft}</Markdown>
            ) : (
              phase !== 'idle' && <WorkingIndicator />
            )}
          </div>
        )}

        {error && <ErrorNotice error={error} onRetry={onRetry} />}
      </div>
    </div>
  );
}

/**
 * Shown from send until the first text or tool event. This is the state that
 * has to hold for 30–60s on a cold start without looking broken, so it says
 * so out loud rather than spinning silently.
 */
function WorkingIndicator() {
  return (
    <p className={styles.working}>
      <span className={styles.dot} aria-hidden="true" />
      Thinking… the first question after a quiet period can take up to a minute.
    </p>
  );
}
