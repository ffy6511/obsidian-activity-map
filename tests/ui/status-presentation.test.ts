import { describe, expect, it } from '../helpers/test-harness';

import type { TrackingSnapshot } from '../../src/domain/activity';
import { statusPresentation } from '../../src/ui/status-presentation';

function snapshot(overrides: Partial<TrackingSnapshot>): TrackingSnapshot {
	return {
		state: 'untrackable',
		reason: 'untrackable',
		currentTarget: null,
		sessionStartedAt: null,
		lastTrustedActivityAt: null,
		pendingRecovery: [],
		recentDecisions: [],
		degradedReason: null,
		sampledAt: '2026-07-21T10:00:00.000Z',
		...overrides,
	};
}

describe('file-header status presentation', () => {
	it('distinguishes the tracked file from another open file', () => {
		const active = snapshot({
			state: 'active',
			reason: 'active',
			currentTarget: { fileId: 'a', path: 'notes/a.md', windowId: 'main', leafId: 'one' },
		});
		expect(statusPresentation(active, 'notes/a.md').className).toBe('is-active');
		expect(statusPresentation(active, 'notes/b.md').className).toBe('is-untrackable');
	});

	it('prioritizes degraded and pending states before ordinary lifecycle state', () => {
		expect(
			statusPresentation(
				snapshot({ state: 'degraded', degradedReason: 'write failed' }),
				'a.md',
			).className,
		).toBe('is-degraded');
		expect(
			statusPresentation(
				snapshot({
					pendingRecovery: [
						{
							candidateId: 'c1',
							fileId: 'a',
							pathAtEvent: 'a.md',
							startedAt: '2026-07-21T00:00:00Z',
							endedAt: '2026-07-21T00:01:00Z',
							gapMs: 60_000,
							defaultDecision: 'exclude',
						},
					],
				}),
				'a.md',
			).className,
		).toBe('is-pending');
	});

	it('maps starting, paused, and idle to named non-color states', () => {
		expect(statusPresentation(null, 'a.md').label).toBe('Activity Map: starting');
		expect(statusPresentation(snapshot({ state: 'paused' }), 'a.md').className).toBe(
			'is-paused',
		);
		expect(statusPresentation(snapshot({ state: 'idle' }), 'a.md').className).toBe('is-idle');
	});
});
