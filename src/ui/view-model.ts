import type { ActivityMapSettings, HeaderPopoverRange } from '../domain/settings';
import type { TrackingSnapshot } from '../domain/activity';
import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import type { RangeMode } from '../query/date-range';

export type ViewLoadState = 'loading' | 'ready' | 'empty' | 'error';

/** Immutable state consumed by every Activity Map presentation surface. */
export interface ActivityMapViewModel {
	loadState: ViewLoadState;
	query: DistributionQuery;
	distribution: DistributionResult | null;
	tracking: TrackingSnapshot | null;
	settings: ActivityMapSettings;
	warnings: string[];
	error: string | null;
	queryGeneration: number;
}

export function initialViewModel(
	settings: ActivityMapSettings,
	today: string,
): ActivityMapViewModel {
	return {
		loadState: 'loading',
		query: headerPopoverDefaultQuery(settings, today),
		distribution: null,
		tracking: null,
		settings,
		warnings: [],
		error: null,
		queryGeneration: 0,
	};
}

/** Create the fresh root query used whenever a Header Popover opens. */
export function headerPopoverDefaultQuery(
	settings: ActivityMapSettings,
	today: string,
): DistributionQuery {
	return {
		metric: settings.headerPopoverMetric,
		range: headerPopoverRange(settings.headerPopoverRange, today),
		path: '',
		view: 'children',
		groupBy: settings.headerPopoverGrouping,
	};
}

function headerPopoverRange(preference: HeaderPopoverRange, today: string): RangeMode {
	if (preference === 'day') return { mode: 'day', localDate: today };
	if (preference === 'all') return { mode: 'all' };
	if (preference === 'average-7') return { mode: 'average', days: 7, today };
	if (preference === 'average-30') return { mode: 'average', days: 30, today };
	if (preference === 'average-90') return { mode: 'average', days: 90, today };
	return { mode: 'average', days: 'all', today };
}
