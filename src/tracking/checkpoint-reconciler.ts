/**
 * Checkpoint reconciliation.
 *
 * On startup, before accepting new events, the runtime loads its in-flight
 * checkpoint. Reconciliation applies the same focus, idle, and maximum-gap
 * rules as live tracking. A valid checkpoint reopens the session; an invalid
 * or quarantined checkpoint enters a visible degraded state instead of
 * guessing elapsed time.
 *
 * Restoring the same checkpoint twice must not emit duplicate sessions or
 * decisions. The reconciler is a thin, deterministic wrapper around the engine
 * so this property is testable without persistence.
 */

import type { RuntimeCheckpoint } from '../domain/activity';
import type { Clock } from '../platform/clock';
import { ActivityEngine } from './activity-engine';

export interface ReconcileResult {
	/** 'restored' when the checkpoint reopened a session; 'quarantined' when invalid. */
	outcome: 'restored' | 'quarantined' | 'empty';
	reason?: string;
}

/**
 * Validate and replay a loaded checkpoint into the engine. Returns empty when
 * the checkpoint is null (clean shutdown), restored when a session reopened,
 * and quarantined when the checkpoint is structurally invalid.
 */
export function reconcileCheckpoint(args: {
	checkpoint: RuntimeCheckpoint | null;
	engine: ActivityEngine;
	clock: Clock;
	nowSample: ReturnType<Clock['now']>;
}): ReconcileResult {
	const { checkpoint, engine, nowSample } = args;
	if (!checkpoint) {
		return { outcome: 'empty' };
	}
	if (checkpoint.schemaVersion !== 1) {
		return {
			outcome: 'quarantined',
			reason: `unsupported-schema-version-${String(checkpoint.schemaVersion)}`,
		};
	}
	// Structural validity: an active checkpoint must name a target and start.
	if (
		checkpoint.state === 'active' &&
		(!checkpoint.currentTarget || !checkpoint.sessionStartedAt)
	) {
		return { outcome: 'quarantined', reason: 'active-checkpoint-missing-target' };
	}
	engine.restore(checkpoint, nowSample);
	return { outcome: 'restored' };
}
