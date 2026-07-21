/**
 * Runtime validators for every persisted structure.
 *
 * Persisted or external data is validated at the boundary before it is converted
 * to trusted domain types. Each validator either returns the normalized value or
 * throws a {@link SchemaError} describing the failure, so corrupt data cannot
 * silently flow into the runtime. Callers isolate failures per record/shard so
 * one bad line cannot block unrelated data.
 */

/** Structured validation failure carrying a stable code for diagnostics. */
export class SchemaError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'SchemaError';
		this.code = code;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Validate a non-empty ISO-8601 timestamp string (loose shape check). */
export function validateIsoTimestamp(value: unknown): string {
	if (!isString(value)) {
		throw new SchemaError('invalid-timestamp', 'expected a non-empty ISO timestamp string');
	}
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
		throw new SchemaError('invalid-timestamp', `not an ISO timestamp: ${value}`);
	}
	return value;
}

/** Validate a YYYY-MM-DD local date string. */
export function validateLocalDate(value: unknown): string {
	if (!isString(value)) {
		throw new SchemaError('invalid-local-date', 'expected a YYYY-MM-DD string');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new SchemaError('invalid-local-date', `not a YYYY-MM-DD date: ${value}`);
	}
	return value;
}

/** Validate a non-empty identifier string (recordId, deviceId, fileId). */
export function validateId(value: unknown, field: string): string {
	if (!isString(value)) {
		throw new SchemaError('invalid-id', `expected a non-empty ${field}`);
	}
	return value;
}

/** Validate a metrics bag: non-negative finite activeMs/editingMs and openCount. */
export function validateMetrics(value: unknown): {
	activeMs: number;
	editingMs: number;
	openCount: number;
} {
	if (!isObject(value)) {
		throw new SchemaError('invalid-metrics', 'expected a metrics object');
	}
	const { activeMs, editingMs, openCount } = value;
	if (!isFiniteNonNegative(activeMs)) {
		throw new SchemaError('invalid-metrics', 'activeMs must be a non-negative finite number');
	}
	if (!isFiniteNonNegative(editingMs)) {
		throw new SchemaError('invalid-metrics', 'editingMs must be a non-negative finite number');
	}
	if (editingMs > activeMs) {
		throw new SchemaError('invalid-metrics', 'editingMs must not exceed activeMs');
	}
	if (typeof openCount !== 'number' || !Number.isInteger(openCount) || openCount < 0) {
		throw new SchemaError('invalid-metrics', 'openCount must be a non-negative integer');
	}
	return {
		activeMs: Math.round(activeMs),
		editingMs: Math.round(editingMs),
		openCount,
	};
}

/** Allowed event payload discriminators for schema version 1. */
export type EventPayloadKind = 'session' | 'adjustment';

/** A validated session payload record. */
export interface ValidatedSessionPayload {
	kind: 'session';
	startedAt: string;
	endedAt: string;
	localDate: string;
	activeMs: number;
	editingMs: number;
	openCount: number;
	closureReason: string;
}

/** A validated adjustment payload record. */
export interface ValidatedAdjustmentPayload {
	kind: 'adjustment';
	candidateId: string;
	deltaMs: number;
	reason: string;
	automatic: boolean;
}

export type ValidatedPayload = ValidatedSessionPayload | ValidatedAdjustmentPayload;

/** A validated event envelope (schema version 1). */
export interface ValidatedEventEnvelope {
	schemaVersion: 1;
	recordId: string;
	type: EventPayloadKind;
	deviceId: string;
	fileId: string;
	pathAtEvent: string;
	occurredAt: string;
	localDate: string;
	payload: ValidatedPayload;
}

/** Validate an event envelope record read from a shard or constructed for append. */
export function validateEventEnvelope(value: unknown): ValidatedEventEnvelope {
	if (!isObject(value)) {
		throw new SchemaError('invalid-envelope', 'expected an envelope object');
	}
	if (value.schemaVersion !== 1) {
		throw new SchemaError(
			'invalid-envelope',
			`unsupported schemaVersion ${String(value.schemaVersion)}`,
		);
	}
	const type = value.type as EventPayloadKind;
	if (type !== 'session' && type !== 'adjustment') {
		throw new SchemaError('invalid-envelope', `unknown event type ${String(value.type)}`);
	}
	const payload = validatePayload(value.payload, type);
	return {
		schemaVersion: 1,
		recordId: validateId(value.recordId, 'recordId'),
		type,
		deviceId: validateId(value.deviceId, 'deviceId'),
		fileId: validateId(value.fileId, 'fileId'),
		pathAtEvent: isString(value.pathAtEvent) ? value.pathAtEvent : '',
		occurredAt: validateIsoTimestamp(value.occurredAt),
		localDate: validateLocalDate(value.localDate),
		payload,
	};
}

function validatePayload(value: unknown, type: EventPayloadKind): ValidatedPayload {
	if (!isObject(value)) {
		throw new SchemaError('invalid-payload', 'expected a payload object');
	}
	if (type === 'session') {
		const metrics = validateMetrics({
			activeMs: value.activeMs,
			editingMs: value.editingMs,
			openCount: value.openCount,
		});
		return {
			kind: 'session',
			startedAt: validateIsoTimestamp(value.startedAt),
			endedAt: validateIsoTimestamp(value.endedAt),
			localDate: validateLocalDate(value.localDate),
			activeMs: metrics.activeMs,
			editingMs: metrics.editingMs,
			openCount: metrics.openCount,
			closureReason: isString(value.closureReason) ? value.closureReason : 'unknown',
		};
	}
	// adjustment
	if (
		typeof value.deltaMs !== 'number' ||
		!Number.isFinite(value.deltaMs)
	) {
		throw new SchemaError('invalid-payload', 'adjustment deltaMs must be a finite number');
	}
	const deltaMs: number = value.deltaMs;
	return {
		kind: 'adjustment',
		candidateId: validateId(value.candidateId, 'candidateId'),
		deltaMs,
		reason: isString(value.reason) ? value.reason : '',
		automatic: value.automatic === true,
	};
}

/** Validate a daily summary metrics-by-file map value. */
export function validateDailyFileMetrics(value: unknown): {
	activeMs: number;
	editingMs: number;
	openCount: number;
} {
	return validateMetrics(value);
}
