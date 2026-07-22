import type { ActivityMapSettings } from '../domain/settings';
import type { TrackingSnapshot } from '../domain/activity';
import type { DistributionQuery, DistributionResult } from '../query/distribution-query';
import type { DeletionPlan } from '../data/deletion-service';
import type { DataOperationProgress } from '../data/retention-service';

export type ViewLoadState = 'loading' | 'ready' | 'empty' | 'error';
export type DataOperationState =
	| { kind: 'idle' }
	| { kind: 'running'; operation: DataOperationProgress['operation'] | 'svg-export'; label: string; completed: number; total: number }
	| { kind: 'deletion-preview'; plan: DeletionPlan }
	| { kind: 'completed'; message: string }
	| { kind: 'error'; message: string };

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
	operation: DataOperationState;
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
		operation: { kind: 'idle' },
	};
}
