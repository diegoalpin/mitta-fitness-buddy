import { ChatView } from './components/ChatView';

/**
 * There is deliberately no settings panel. The MVP supplies no credentials
 * from the browser — every secret lives on the server — so there is nothing
 * for a user to configure (handoff §5). Do not add one.
 *
 * The header lives inside ChatView, not here: New Chat needs the hook's reset
 * and ChatView is the only component that touches useChat.
 */
export default function App() {
  return <ChatView />;
}
