/**
 * Validated runtime settings for the tracking runtime.
 *
 * Units are milliseconds internally so all time math shares one unit. The UI
 * formats to seconds for display. This module owns defaults, documented ranges,
 * and field-by-field normalization; Spec 02's settings repository owns
 * persistence and serialization.
 */

/** Rolling-average windows supported by the query engine. `all` performs no division for totals. */
export type AverageWindowDays = 7 | 30 | 90 | 'all';

/**
 * Runtime-validated settings. Persisted JSON is normalized through
 * {@link normalizeSettings} before this type is ever constructed.
 */
export interface ActivityMapSettings {
	schemaVersion: 1;
	deviceId: string;
	trackingEnabled: boolean;
	manuallyPaused: boolean;
	idleThresholdMs: number;
	recoveryLimitMs: number;
	editSilenceMs: number;
	averageWindowDays: AverageWindowDays;
	rawRetentionDays: number;
	maxChartItems: number;
	excludedPathGlobs: string[];
	/** Optional retention progress watermark owned by Spec 02. */
	retentionWatermark: string | null;
}

/** Default values, mirrored in docs/PRD.md and the settings tab. Keep in sync. */
export const DEFAULT_SETTINGS: ActivityMapSettings = {
	schemaVersion: 1,
	deviceId: '',
	trackingEnabled: true,
	manuallyPaused: false,
	// 180 s — PRD default idle threshold; adjustable 30–1800 s.
	idleThresholdMs: 180_000,
	// 30 min — gaps up to here surface a pending include/exclude decision.
	recoveryLimitMs: 1_800_000,
	// 15 s — edit burst closes after this much silence. PRD allows 5–120 s.
	editSilenceMs: 15_000,
	averageWindowDays: 30,
	rawRetentionDays: 90,
	maxChartItems: 8,
	excludedPathGlobs: [],
	retentionWatermark: null,
};

/** Documented numeric ranges; values outside are clamped, not rejected wholesale, for resilience. */
export const RANGES = {
	idleThresholdMs: { min: 30_000, max: 1_800_000 },
	editSilenceMs: { min: 5_000, max: 120_000 },
	rawRetentionDays: { min: 1, max: 3650 },
	maxChartItems: { min: 1, max: 32 },
	recoveryLimitMs: { min: 60_000, max: 86_400_000 },
} as const;

function clampNumber(
	value: unknown,
	range: { min: number; max: number },
	fallback: number,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(range.max, Math.max(range.min, Math.trunc(value)));
}

function isAverageWindow(value: unknown): value is AverageWindowDays {
	return value === 7 || value === 30 || value === 90 || value === 'all';
}

/**
 * Normalize unknown persisted JSON into trusted settings. Applies defaults
 * field by field so one corrupt field cannot reset the whole object, and clamps
 * numerics into their documented ranges. `deviceId` is left empty here; Spec 02
 * assigns and persists it once.
 */
export function normalizeSettings(input: unknown): ActivityMapSettings {
	const source = (input ?? {}) as Partial<ActivityMapSettings>;
	return {
		schemaVersion: 1,
		deviceId: typeof source.deviceId === 'string' ? source.deviceId : '',
		trackingEnabled:
			typeof source.trackingEnabled === 'boolean'
				? source.trackingEnabled
				: DEFAULT_SETTINGS.trackingEnabled,
		manuallyPaused:
			typeof source.manuallyPaused === 'boolean'
				? source.manuallyPaused
				: DEFAULT_SETTINGS.manuallyPaused,
		idleThresholdMs: clampNumber(
			source.idleThresholdMs,
			RANGES.idleThresholdMs,
			DEFAULT_SETTINGS.idleThresholdMs,
		),
		recoveryLimitMs: clampNumber(
			source.recoveryLimitMs,
			RANGES.recoveryLimitMs,
			DEFAULT_SETTINGS.recoveryLimitMs,
		),
		editSilenceMs: clampNumber(
			source.editSilenceMs,
			RANGES.editSilenceMs,
			DEFAULT_SETTINGS.editSilenceMs,
		),
		averageWindowDays: isAverageWindow(source.averageWindowDays)
			? source.averageWindowDays
			: DEFAULT_SETTINGS.averageWindowDays,
		rawRetentionDays: clampNumber(
			source.rawRetentionDays,
			RANGES.rawRetentionDays,
			DEFAULT_SETTINGS.rawRetentionDays,
		),
		maxChartItems: clampNumber(
			source.maxChartItems,
			RANGES.maxChartItems,
			DEFAULT_SETTINGS.maxChartItems,
		),
		excludedPathGlobs: Array.isArray(source.excludedPathGlobs)
			? source.excludedPathGlobs.filter((g): g is string => typeof g === 'string')
			: [],
		retentionWatermark:
			typeof source.retentionWatermark === 'string'
				? source.retentionWatermark
				: null,
	};
}
