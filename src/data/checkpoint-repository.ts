/**
 * Checkpoint repository.
 *
 * The in-flight runtime checkpoint uses {@link SafeJsonStore} so an interrupted
 * write leaves a recoverable primary/backup. On startup the repository loads
 * the checkpoint (or null for a clean shutdown) and hands it to the tracking
 * reconciler. A structurally invalid checkpoint is quarantined rather than
 * replayed, so the runtime enters a visible degraded state instead of guessing
 * elapsed time.
 */

import type { RuntimeCheckpoint } from '../domain/activity';
import type { TrackingCheckpointPort } from '../tracking/ports';
import type { SafeJsonStore } from './safe-json-store';

/** Load result distinguishing a clean absence from a quarantined invalid file. */
export interface CheckpointLoadResult {
	checkpoint: RuntimeCheckpoint | null;
	/** True when the file existed but could not be validated. */
	quarantined: boolean;
	reason?: string;
}

/** Durable checkpoint store implementing the Spec 01 checkpoint port. */
export class CheckpointRepository implements TrackingCheckpointPort {
	constructor(private readonly store: SafeJsonStore) {}

	/** Load and validate the checkpoint; quarantines invalid files. */
	async load(): Promise<CheckpointLoadResult> {
		const result = await this.store.load<RuntimeCheckpoint>((raw) => validateCheckpoint(raw));
		if (!result.value) {
			const exists = await this.store.primaryExists();
			return {
				checkpoint: null,
				quarantined: exists,
				reason: exists ? 'checkpoint-invalid-or-unsupported' : undefined,
			};
		}
		return { checkpoint: result.value, quarantined: false };
	}

	async write(snapshot: RuntimeCheckpoint): Promise<void> {
		await this.store.save(snapshot, (v) => JSON.stringify(v));
	}

	async clear(): Promise<void> {
		await this.store.removeAll();
	}
}

/** Structural validation of a checkpoint. Throws to trigger quarantine. */
function validateCheckpoint(raw: unknown): RuntimeCheckpoint {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('checkpoint-not-object');
	}
	const obj = raw as Record<string, unknown>;
	if (obj.schemaVersion !== 1) {
		throw new Error(`checkpoint-unsupported-schema-${String(obj.schemaVersion)}`);
	}
	// Trust the runtime-defined shape after boundary validation; deeper checks
	// belong to the reconciler which applies the same rules as live tracking.
	return raw as RuntimeCheckpoint;
}
