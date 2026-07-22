import { describe, expect, it } from '../helpers/test-harness';

import { ActivityMapController, isDeletionPlanFresh, type TrackingControl } from '../../src/ui/activity-map-controller';
import type { DataOperationPort } from '../../src/ui/data-controls';
import type { DistributionQuery, DistributionResult } from '../../src/query/distribution-query';
import { normalizeSettings } from '../../src/domain/settings';
import type { DeletionPlan } from '../../src/data/deletion-service';

function distribution(query: DistributionQuery): DistributionResult {
	return { query, maxChartItems: 8, scopeTotal: 10, vaultTotal: 10, percentOfVault: 1, denominatorDays: null, coverage: null,
		chartItems: [{ id: 'file:a', kind: 'file', label: 'a.md', path: 'a.md', value: 10, percentOfScope: 1, memberIds: ['file-a'] }],
		detailItems: [{ id: 'file:a', kind: 'file', label: 'a.md', path: 'a.md', value: 10, percentOfScope: 1, memberIds: ['file-a'] }], warnings: [] };
}

function tracking(): TrackingControl {
	return { pause: () => {}, resume: () => {}, updateSettings: () => {}, resolveRecovery: async () => null, undoAutomaticExclusion: () => true };
}

function plan(): DeletionPlan {
	return {
		planId: 'plan-fixed',
		scope: { kind: 'date', localDate: '2026-07-21' },
		affectedPaths: ['data/a'],
		affectedShards: [{ deviceId: 'dev1', localDate: '2026-07-21', sessionPath: 'data/a', summaryPath: 'data/b' }],
		affectedRecordCount: 3,
		affectedSummaryCount: 1,
		createdAt: new Date().toISOString(),
		sourceFingerprint: 'fixed',
		pathFingerprints: { 'data/a': 'fixed' },
	};
}

function operations(overrides: Partial<DataOperationPort> = {}): DataOperationPort {
	return {
		exportSvg: async () => ({ outcome: 'downloaded', message: 'Downloaded chart.svg' }),
		exportRaw: async () => ({ destination: { outcome: 'downloaded', message: 'Downloaded raw.json' }, warnings: 0, records: 2 }),
		rebuild: async () => ({ outcomes: [] }),
		planDeletion: async () => plan(),
		executeDeletion: async (selected) => ({ planId: selected.planId, outcome: 'completed', removedPaths: [], remainingRecordCount: 0, errors: [] }),
		...overrides,
	};
}

function controller(dataOperations: DataOperationPort, runtime: TrackingControl = tracking()): ActivityMapController {
	const settings = normalizeSettings({ deviceId: 'd1' });
	return new ActivityMapController(settings, { run: async (query) => distribution(query) }, { update: async () => settings }, runtime, '2026-07-21', dataOperations);
}

describe('data operation controller', () => {
	it('expires deletion previews after the bounded confirmation window', () => {
		expect(isDeletionPlanFresh({ createdAt: '2026-07-21T00:00:00.000Z' }, Date.parse('2026-07-21T00:04:59.000Z'))).toBeTrue();
		expect(isDeletionPlanFresh({ createdAt: '2026-07-21T00:00:00.000Z' }, Date.parse('2026-07-21T00:05:01.000Z'))).toBeFalse();
	});

	it('settles the in-flight session before planning and resumes after cancellation', async () => {
		const events: string[] = [];
		const runtime: TrackingControl = {
			pause: () => { events.push('pause'); },
			resume: () => { events.push('resume'); },
			settle: async () => { events.push('settle'); },
			updateSettings: () => {}, resolveRecovery: async () => null, undoAutomaticExclusion: () => true,
		};
		const subject = controller(operations({ planDeletion: async () => { events.push('plan'); return plan(); } }), runtime);
		await subject.dispatch({ kind: 'plan-deletion', scope: { kind: 'all' } });
		await subject.dispatch({ kind: 'dismiss-operation' });
		expect(events).toEqual(['pause', 'settle', 'plan', 'resume']);
	});
	it('executes the exact previewed deletion plan and reports partial failure as error', async () => {
		const executed: { value: DeletionPlan | null } = { value: null };
		const selected = plan();
		const subject = controller(operations({
			planDeletion: async () => selected,
			executeDeletion: async (candidate) => {
				executed.value = candidate;
				return { planId: candidate.planId, outcome: 'partial-failure', removedPaths: ['data/a'], remainingRecordCount: 2, errors: [{ path: 'data/b', message: 'locked' }] };
			},
		}));
		await subject.dispatch({ kind: 'plan-deletion', scope: selected.scope });
		await subject.dispatch({ kind: 'execute-deletion', planId: selected.planId });
		expect(executed.value).toBe(selected);
		const operation = subject.getViewModel().operation;
		expect(operation.kind).toBe('error');
		expect(operation.kind === 'error' && operation.message.includes('partially failed')).toBeTrue();
	});

	it('rejects a stale confirmation before calling the deletion service', async () => {
		let calls = 0;
		const subject = controller(operations({ executeDeletion: async (candidate) => { calls += 1; return { planId: candidate.planId, outcome: 'completed', removedPaths: [], remainingRecordCount: 0, errors: [] }; } }));
		await subject.dispatch({ kind: 'plan-deletion', scope: { kind: 'all' } });
		await subject.dispatch({ kind: 'execute-deletion', planId: 'wrong-plan' });
		expect(calls).toBe(0);
		expect(subject.getViewModel().operation.kind).toBe('error');
	});

	it('does not start a second operation while one is running', async () => {
		const pending: { resolve: (() => void) | null } = { resolve: null };
		let rebuildCalls = 0;
		const subject = controller(operations({
			exportRaw: () => new Promise((resolve) => { pending.resolve = () => resolve({ destination: { outcome: 'downloaded', message: 'done' }, warnings: 0, records: 0 }); }),
			rebuild: async () => { rebuildCalls += 1; return { outcomes: [] }; },
		}));
		const exporting = subject.dispatch({ kind: 'export-raw', scope: { kind: 'all' } });
		await subject.dispatch({ kind: 'rebuild-summaries' });
		expect(rebuildCalls).toBe(0);
		pending.resolve?.();
		await exporting;
	});

	it('reports unavailable download capability as an error state', async () => {
		const subject = controller(operations({ exportSvg: async () => ({ outcome: 'unavailable', message: 'Local download is unavailable.' }) }));
		await subject.dispatch({ kind: 'refresh' });
		await subject.dispatch({ kind: 'export-svg', mode: 'chart-only' });
		expect(subject.getViewModel().operation.kind).toBe('error');
	});
});
