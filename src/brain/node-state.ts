/**
 * Node + run status values.
 *
 * A plan node moves through this tiny state machine while the engine works:
 *   pending → running → completed   (or → failed)
 *
 * The overall run has the same-shaped status. These are runtime values (they
 * change as execution proceeds); the plan itself (nodes/edges) stays immutable.
 */

/** The state of a single plan node. */
export type NodeState = "pending" | "running" | "completed" | "failed" | "skipped";

/** The state of the whole execution. */
export type ExecutionStatus = "pending" | "running" | "completed" | "failed";
