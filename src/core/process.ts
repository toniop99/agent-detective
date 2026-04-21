/**
 * Re-export process helpers from the shared package (single implementation).
 * @see @agent-detective/process-utils
 */
export {
  shellQuote,
  wrapCommandWithPty,
  terminateChildProcess,
  execLocal,
  execLocalStreaming,
} from '@agent-detective/process-utils';
