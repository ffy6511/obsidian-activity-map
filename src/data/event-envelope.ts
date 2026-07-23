/**
 * Versioned event envelope construction.
 *
 * Closed domain records and recovery decisions are wrapped in a versioned,
 * discriminated envelope before persistence. The envelope carries the
 * schema/device/file/path/timestamp fields every metric-bearing record needs;
 * the payload is type-specific. This module is the single place that builds and
 * serializes envelopes so the NDJSON store only appends complete, validated
 * lines.
 */

import type { ClosedSessionSegment, RecoveryDecision, TypedInputRecord } from '../domain/activity';
import { validateEventEnvelope, type ValidatedEventEnvelope } from './schema';

/** Build a `session` envelope from one closed segment. */
export function buildSessionEnvelope(
	segment: ClosedSessionSegment,
	deviceId: string,
): ValidatedEventEnvelope {
	const envelope: ValidatedEventEnvelope = {
		schemaVersion: 1,
		// One session produces at most one segment per local date. Replaying a
		// close after append-before-checkpoint failure therefore reuses this key.
		recordId: `session:${segment.sessionId}:${segment.localDate}`,
		type: 'session',
		deviceId,
		fileId: segment.target.fileId,
		pathAtEvent: segment.target.path,
		// occurredAt uses the session end; the payload retains start/end.
		occurredAt: segment.endedAt,
		localDate: segment.localDate,
		payload: {
			kind: 'session',
			startedAt: segment.startedAt,
			endedAt: segment.endedAt,
			localDate: segment.localDate,
			activeMs: segment.activeMs,
			editingMs: segment.editingMs,
			openCount: segment.openCount,
			closureReason: segment.closureReason,
		},
	};
	// Validate before returning so the boundary never emits an invalid envelope.
	return validateEventEnvelope(envelope);
}

/** Build an `adjustment` envelope from a recovery decision. */
export function buildAdjustmentEnvelope(
	decision: RecoveryDecision,
	deviceId: string,
	fileId: string,
	pathAtEvent: string,
	localDate: string,
): ValidatedEventEnvelope {
	const envelope: ValidatedEventEnvelope = {
		schemaVersion: 1,
		// Candidate + decision class is the durable idempotency key. If the
		// adjustment append succeeds but its clearing checkpoint does not, the
		// startup retry resolves to this same record instead of double-counting.
		recordId: `adjustment:${decision.candidateId}:${decision.automatic ? 'automatic' : 'user'}`,
		type: 'adjustment',
		deviceId,
		fileId,
		pathAtEvent,
		occurredAt: decision.decidedAt,
		localDate,
		payload: {
			kind: 'adjustment',
			candidateId: decision.candidateId,
			deltaMs: decision.deltaMs,
			reason: decision.reason,
			automatic: decision.automatic,
		},
	};
	return validateEventEnvelope(envelope);
}

/** Build a content-free `typed-input` envelope from one committed input count. */
export function buildTypedInputEnvelope(
	record: TypedInputRecord,
	deviceId: string,
): ValidatedEventEnvelope {
	return validateEventEnvelope({
		schemaVersion: 1,
		recordId: `typed-input:${record.recordId}`,
		type: 'typed-input',
		deviceId,
		fileId: record.fileId,
		pathAtEvent: record.pathAtEvent,
		occurredAt: record.occurredAt,
		localDate: record.localDate,
		payload: {
			kind: 'typed-input',
			typedChars: record.typedChars,
			source: record.source,
		},
	});
}

/** Serialize a validated envelope as one complete NDJSON line (with newline). */
export function serializeEnvelopeLine(envelope: ValidatedEventEnvelope): string {
	return `${JSON.stringify(envelope)}\n`;
}
