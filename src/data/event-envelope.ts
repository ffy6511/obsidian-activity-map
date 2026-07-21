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

import type { ClosedSessionSegment, RecoveryDecision } from '../domain/activity';
import { validateEventEnvelope, type ValidatedEventEnvelope } from './schema';

/** Generate a record id using the standard crypto UUID API. */
function newRecordId(): string {
	const win = typeof window !== 'undefined' ? (window as { crypto?: { randomUUID?: () => string } }) : undefined;
	if (win?.crypto && typeof win.crypto.randomUUID === 'function') {
		return win.crypto.randomUUID();
	}
	return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a `session` envelope from one closed segment. */
export function buildSessionEnvelope(
	segment: ClosedSessionSegment,
	deviceId: string,
): ValidatedEventEnvelope {
	const envelope: ValidatedEventEnvelope = {
		schemaVersion: 1,
		recordId: newRecordId(),
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
		recordId: newRecordId(),
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

/** Serialize a validated envelope as one complete NDJSON line (with newline). */
export function serializeEnvelopeLine(envelope: ValidatedEventEnvelope): string {
	return `${JSON.stringify(envelope)}\n`;
}
