import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Phase } from '../hooks/useChat';
import styles from './Composer.module.css';

interface Props {
  /** Controlled value. ChatView owns it so example prompts can prefill it. */
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  phase: Phase;
}

/** Roughly eight rows before it starts scrolling internally. */
const MAX_HEIGHT_PX = 200;

export function Composer({ value, onChange, onSubmit, onStop, phase }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const busy = phase !== 'idle';

  // A CONTROLLED component: `value` comes from state and every keystroke goes
  // back up through onChange. React owns the text, the DOM node just displays
  // it. This is the single most important pattern in the app.

  // Auto-grow. Reset to 'auto' first or scrollHeight can only ever grow,
  // never shrink back down when text is deleted.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const needed = el.scrollHeight;
    el.style.height = `${Math.min(needed, MAX_HEIGHT_PX)}px`;
    // Only allow scrolling once the box is actually capped. Left on `auto`,
    // the browser reserves a ~15px scrollbar gutter at every size, which
    // shows up as a stray bar next to the Send button.
    el.style.overflowY = needed > MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, []);

  // useLayoutEffect, not useEffect: this runs before the browser paints, so
  // the box is never visibly the wrong size for a frame.
  useLayoutEffect(resize, [value, resize]);

  // A measurement taken before the webfont loads is wrong, and because the
  // effect above only depends on `value` it would never re-run to correct
  // itself — the box would stay the wrong height until the first keystroke.
  // Anyone visiting with a cold font cache hits this, so re-measure once the
  // fonts have settled.
  useLayoutEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) resize();
    });
    return () => {
      cancelled = true;
    };
  }, [resize]);

  // The textarea is disabled while a turn runs, and disabling a focused element
  // blurs it — the browser does not hand focus back when it re-enables. (Sending
  // by click loses it the same way: the Send button is unmounted and replaced by
  // Stop.) So once the answer lands, put the cursor back where the next question
  // goes. Runs on mount too, which doubles as autofocus on load.
  //
  // Not on touch, where .focus() also throws up the on-screen keyboard over the
  // answer the user is trying to read — the same reason Enter does not send there.
  useEffect(() => {
    if (phase === 'idle' && navigator.maxTouchPoints === 0) {
      textareaRef.current?.focus();
    }
  }, [phase]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // On touch devices Enter inserts a newline instead of sending — there is
    // no comfortable Shift+Enter on a phone keyboard.
    const isTouch = navigator.maxTouchPoints > 0;
    if (event.key === 'Enter' && !event.shiftKey && !isTouch) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={textareaRef}
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your training…"
        aria-label="Ask about your training"
        rows={1}
        disabled={busy}
      />

      {busy ? (
        <button type="button" className={styles.stop} onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" className={styles.send} disabled={!value.trim()}>
          Send
        </button>
      )}
    </form>
  );
}
