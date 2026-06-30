/**
 * Metrics contracts.
 *
 * The typed shape of "how did this agent run?" numbers. Most fields are
 * PLACEHOLDERS — they exist so future measurement code has somewhere to put its
 * results, but nothing fills them in yet. No implementations here.
 */
export interface AgentMetrics {
  /** How long the agent took, in milliseconds. */
  readonly durationMs: number;
  /** How many times the agent was retried (0 if it succeeded first try). */
  readonly retryCount: number;
  /** Placeholder: peak memory used, in bytes. */
  readonly memoryBytes?: number;
  /** Placeholder: money spent on this agent, in US dollars. */
  readonly costUsd?: number;
  /** Placeholder: AI tokens consumed. */
  readonly tokens?: number;
  /** Placeholder: number of assets the agent produced. */
  readonly assetCount?: number;
}
