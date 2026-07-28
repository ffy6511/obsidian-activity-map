/**
 * Header Popover action-layout preference.
 *
 * Persisted layout data may decide whether a built-in action is visible and
 * where it appears among siblings. The registry deliberately owns everything
 * that can alter behavior—action identity, handler, and side of the fixed
 * date-navigation boundary—so malformed JSON cannot turn presentation data
 * into a new control or move one through the center navigation.
 */

export type HeaderPopoverActionSide = 'left' | 'right';

export type HeaderPopoverActionId =
	| 'tracking-toggle'
	| 'distribution-grouping-toggle'
	| 'poster-export'
	| 'locate-current-file'
	| 'metric'
	| 'date-range';

export interface HeaderPopoverActionDefinition {
	readonly id: HeaderPopoverActionId;
	readonly side: HeaderPopoverActionSide;
	readonly defaultOrder: number;
}

/** A user-owned visibility and side-local order; the registry owns the side. */
export interface HeaderPopoverActionLayoutItem {
	readonly id: HeaderPopoverActionId;
	readonly order: number;
	readonly enabled: boolean;
}

export interface HeaderPopoverActionLayoutProjection {
	readonly left: readonly HeaderPopoverActionLayoutItem[];
	readonly right: readonly HeaderPopoverActionLayoutItem[];
	readonly disabled: readonly HeaderPopoverActionLayoutItem[];
}

export type HeaderPopoverLayoutDestination =
	| { readonly kind: 'side'; readonly side: HeaderPopoverActionSide; readonly index: number }
	| { readonly kind: 'disabled' };

export type HeaderPopoverActionMoveResult =
	| { readonly kind: 'moved'; readonly layout: HeaderPopoverActionLayoutItem[] }
	| {
			readonly kind: 'rejected';
			readonly reason: 'wrong-side' | 'invalid-index' | 'already-disabled';
			readonly layout: HeaderPopoverActionLayoutItem[];
	  };

/**
 * This order is the pre-layout Popover order. New actions must be added here
 * with a fixed side before they can become configurable.
 */
export const HEADER_POPOVER_ACTION_REGISTRY: readonly HeaderPopoverActionDefinition[] = [
	{ id: 'tracking-toggle', side: 'left', defaultOrder: 0 },
	{ id: 'distribution-grouping-toggle', side: 'left', defaultOrder: 1 },
	{ id: 'poster-export', side: 'left', defaultOrder: 2 },
	{ id: 'locate-current-file', side: 'right', defaultOrder: 0 },
	{ id: 'metric', side: 'right', defaultOrder: 1 },
	{ id: 'date-range', side: 'right', defaultOrder: 2 },
];

interface LayoutCandidate {
	readonly item: HeaderPopoverActionLayoutItem;
	readonly sourceIndex: number;
	readonly definition: HeaderPopoverActionDefinition;
}

/** Return a fresh first-run layout so callers can safely treat it as mutable data. */
export function defaultHeaderPopoverActionLayout(): HeaderPopoverActionLayoutItem[] {
	return HEADER_POPOVER_ACTION_REGISTRY.map((definition) => ({
		id: definition.id,
		order: definition.defaultOrder,
		enabled: true,
	}));
}

/** Immutable registry lookup for renderers and side-constrained move targets. */
export function headerPopoverActionDefinition(
	id: HeaderPopoverActionId,
): HeaderPopoverActionDefinition {
	const definition = HEADER_POPOVER_ACTION_REGISTRY.find((entry) => entry.id === id);
	if (!definition) throw new Error(`Unknown Header Popover action: ${id}`);
	return definition;
}

/**
 * Normalize untrusted persisted data into one canonical item for each known
 * action. Enabled actions are ordered before disabled ones within a side so a
 * disabled item cannot invisibly change the order of visible controls.
 */
export function normalizeHeaderPopoverActionLayout(
	input: unknown,
): HeaderPopoverActionLayoutItem[] {
	const candidates = new Map<HeaderPopoverActionId, LayoutCandidate>();
	const source = Array.isArray(input) ? input : [];

	for (const [sourceIndex, candidate] of source.entries()) {
		if (!isRecord(candidate) || typeof candidate.id !== 'string') continue;
		const definition = definitionFor(candidate.id);
		if (!definition || candidates.has(definition.id)) continue;
		candidates.set(definition.id, {
			definition,
			sourceIndex,
			item: {
				id: definition.id,
				order: validOrder(candidate.order, definition.defaultOrder),
				enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
			},
		});
	}

	return (['left', 'right'] as const).flatMap((side) => {
		const knownSide = HEADER_POPOVER_ACTION_REGISTRY.filter(
			(definition) => definition.side === side,
		);
		const sideCandidates = knownSide.map((definition) => {
			const existing = candidates.get(definition.id);
			return (
				existing ?? {
					definition,
					sourceIndex: source.length + definition.defaultOrder,
					item: {
						id: definition.id,
						order: definition.defaultOrder,
						enabled: true,
					},
				}
			);
		});
		return canonicalizeSide(sideCandidates);
	});
}

/** Split a normalized layout into the two fixed visible regions and recovery area. */
export function projectHeaderPopoverActionLayout(
	layout: readonly HeaderPopoverActionLayoutItem[],
): HeaderPopoverActionLayoutProjection {
	const normalized = normalizeHeaderPopoverActionLayout(layout);
	return {
		left: normalized.filter(
			(item) => item.enabled && headerPopoverActionDefinition(item.id).side === 'left',
		),
		right: normalized.filter(
			(item) => item.enabled && headerPopoverActionDefinition(item.id).side === 'right',
		),
		disabled: normalized.filter((item) => !item.enabled),
	};
}

/**
 * Move one action in a local draft. A rejected result deliberately retains a
 * canonical copy of the existing layout so each UI can announce the rejected
 * target without inventing separate recovery behavior.
 */
export function moveHeaderPopoverAction(
	layout: readonly HeaderPopoverActionLayoutItem[],
	id: HeaderPopoverActionId,
	destination: HeaderPopoverLayoutDestination,
): HeaderPopoverActionMoveResult {
	const normalized = normalizeHeaderPopoverActionLayout(layout);
	const definition = headerPopoverActionDefinition(id);
	const sideItems = normalized.filter(
		(item) => headerPopoverActionDefinition(item.id).side === definition.side,
	);
	const action = sideItems.find((item) => item.id === id);
	if (!action) throw new Error(`Missing Header Popover action: ${id}`);

	if (destination.kind === 'disabled') {
		if (!action.enabled) {
			return { kind: 'rejected', reason: 'already-disabled', layout: normalized };
		}
		const enabled = sideItems.filter((item) => item.enabled && item.id !== id);
		const disabled = sideItems.filter((item) => !item.enabled);
		return {
			kind: 'moved',
			layout: replaceSide(
				normalized,
				definition.side,
				withSideOrders(enabled, [...disabled, { ...action, enabled: false }]),
			),
		};
	}

	if (destination.side !== definition.side) {
		return { kind: 'rejected', reason: 'wrong-side', layout: normalized };
	}
	if (!Number.isSafeInteger(destination.index) || destination.index < 0) {
		return { kind: 'rejected', reason: 'invalid-index', layout: normalized };
	}

	const enabled = sideItems.filter((item) => item.enabled && item.id !== id);
	const index = Math.min(destination.index, enabled.length);
	enabled.splice(index, 0, { ...action, enabled: true });
	const disabled = sideItems.filter((item) => !item.enabled && item.id !== id);
	return {
		kind: 'moved',
		layout: replaceSide(normalized, definition.side, withSideOrders(enabled, disabled)),
	};
}

function definitionFor(id: string): HeaderPopoverActionDefinition | null {
	return HEADER_POPOVER_ACTION_REGISTRY.find((entry) => entry.id === id) ?? null;
}

function validOrder(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
		? value
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalizeSide(candidates: readonly LayoutCandidate[]): HeaderPopoverActionLayoutItem[] {
	const byOrder = [...candidates].sort((left, right) => {
		if (left.item.order !== right.item.order) return left.item.order - right.item.order;
		if (left.sourceIndex !== right.sourceIndex) return left.sourceIndex - right.sourceIndex;
		return left.definition.defaultOrder - right.definition.defaultOrder;
	});
	return withSideOrders(
		byOrder.filter((candidate) => candidate.item.enabled).map((candidate) => candidate.item),
		byOrder.filter((candidate) => !candidate.item.enabled).map((candidate) => candidate.item),
	);
}

function withSideOrders(
	enabled: readonly HeaderPopoverActionLayoutItem[],
	disabled: readonly HeaderPopoverActionLayoutItem[],
): HeaderPopoverActionLayoutItem[] {
	return [...enabled, ...disabled].map((item, order) => ({ ...item, order }));
}

function replaceSide(
	layout: readonly HeaderPopoverActionLayoutItem[],
	side: HeaderPopoverActionSide,
	replacement: readonly HeaderPopoverActionLayoutItem[],
): HeaderPopoverActionLayoutItem[] {
	return normalizeHeaderPopoverActionLayout([
		...layout.filter((item) => headerPopoverActionDefinition(item.id).side !== side),
		...replacement,
	]);
}
