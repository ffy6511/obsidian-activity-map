import type { ActivityMapSettings } from '../domain/settings';
import type { TrackingSnapshot } from '../domain/activity';
import type { DistributionQuery, DistributionResult } from '../query/distribution-query';

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

export function initialViewModel(settings: ActivityMapSettings, today: string): ActivityMapViewModel {
	return {
		loadState: 'loading',
		query: {
			metric: 'activeMs',
			range: { mode: 'day', localDate: today },
			path: '',
			view: 'children',
			groupBy: 'path',
		},
		distribution: null,
		tracking: null,
		settings,
		warnings: [],
		error: null,
		queryGeneration: 0,
	};
}
