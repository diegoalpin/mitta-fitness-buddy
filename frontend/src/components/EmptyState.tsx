import styles from './EmptyState.module.css';

interface Props {
  /** Fills the composer rather than sending, so the question can be edited. */
  onPick: (prompt: string) => void;
}

const EXAMPLES = [
  "How's my form this week?",
  'What did I do last week?',
  'Compare my last two long rides',
  "What's my CTL trend over the last month?",
];

/** The cheapest possible onboarding for a tool whose UI is an empty text box. */
export function EmptyState({ onPick }: Props) {
  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Ask about your training</h1>
        <p className={styles.subtitle}>
          Connected to your Intervals.icu data. Read-only — nothing here can
          change your account.
        </p>

        <ul className={styles.examples}>
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                className={styles.example}
                onClick={() => onPick(example)}
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
