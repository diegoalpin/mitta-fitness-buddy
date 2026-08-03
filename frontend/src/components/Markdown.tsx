import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.css';

interface Props {
  children: string;
}

/**
 * Renders assistant prose. remark-gfm is what adds tables, which the training
 * data needs constantly.
 *
 * rehype-raw is deliberately NOT enabled. Rendering raw HTML out of model
 * output is an injection surface we have no reason to open.
 */
export function Markdown({ children }: Props) {
  return (
    <div className={styles.prose}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Training tables are wide and phones are narrow. Without its own
          // scroll container the whole page scrolls sideways.
          table: ({ node: _node, ...props }) => (
            <div className={styles.tableWrap}>
              <table {...props} />
            </div>
          ),
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
