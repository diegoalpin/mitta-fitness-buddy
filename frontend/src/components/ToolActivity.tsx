import type { ToolActivity as Activity } from '../hooks/useChat';
import styles from './ToolActivity.module.css';

interface Props {
  activity: Activity[];
}

/**
 * Shows the training-data lookups happening behind the answer.
 *
 * This exists because users tolerate a slow answer far better when they can
 * see it working (handoff §5) — and with a cold MCP server the first answer
 * can be a minute away. A failed badge carries the tool's own error text,
 * which on an Intervals.icu 429 includes the rate-limit remaining/limit.
 */
export function ToolActivity({ activity }: Props) {
  if (activity.length === 0) return null;

  return (
    <ul className={styles.list}>
      {activity.map((item) => (
        <li
          key={item.id}
          className={`${styles.item} ${styles[item.state]}`}
        >
          <span className={styles.marker} aria-hidden="true" />
          <span className={styles.name}>{describe(item.name, item.state)}</span>
          {item.detail && <span className={styles.detail}>{item.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Turns a raw MCP tool name into something readable. */
function describe(name: string, state: Activity['state']): string {
  const readable = name.replace(/_/g, ' ');
  if (state === 'running') return `Looking up ${readable}…`;
  if (state === 'failed') return `Could not read ${readable}`;
  return `Read ${readable}`;
}
