import type { TrackingSnapshot } from '../domain/activity';
import type { DistributionResult } from '../query/distribution-query';
import { buildChartModel } from './components/donut-chart';
import { withLiveActivity, type LiveDistributionOptions } from './live-distribution';

export interface HeaderDonutSlice {
	id: string;
	ratio: number;
	color: string;
}

/** Minimal surface used by the header manager and deterministic tests. */
export interface HeaderMiniDonutPort {
	update(slices: readonly HeaderDonutSlice[]): void;
}

/**
 * A permanently mounted miniature of today's vault-root distribution. Slice
 * circles are reconciled by stable item ID, so status snapshots never replace
 * the SVG and unchanged items retain their DOM identity.
 */
export class HeaderMiniDonut implements HeaderMiniDonutPort {
	private readonly svg: SVGSVGElement;
	private readonly nodes = new Map<string, SVGCircleElement>();
	private signature = '';

	constructor(host: HTMLElement) {
		host.empty();
		this.svg = host.createSvg('svg');
		this.svg.setAttribute('class', 'activity-map-header-donut');
		this.svg.setAttribute('viewBox', '0 0 20 20');
		this.svg.setAttribute('aria-hidden', 'true');
		const track = this.svg.createSvg('circle');
		track.setAttribute('class', 'activity-map-header-donut-track');
		track.setAttribute('cx', '10');
		track.setAttribute('cy', '10');
		track.setAttribute('r', '7');
		track.setAttribute('pathLength', '1');
	}

	update(slices: readonly HeaderDonutSlice[]): void {
		const normalized = normalizeSlices(slices);
		const signature = normalized.map((slice) => `${slice.id}:${slice.ratio}:${slice.color}`).join('|');
		if (signature === this.signature) return;
		this.signature = signature;

		const liveIds = new Set(normalized.map((slice) => slice.id));
		for (const [id, node] of this.nodes) {
			if (liveIds.has(id)) continue;
			node.remove();
			this.nodes.delete(id);
		}

		let cursor = 0;
		for (const slice of normalized) {
			let node = this.nodes.get(slice.id);
			if (!node) {
				node = this.svg.createSvg('circle');
				node.setAttribute('class', 'activity-map-header-donut-slice');
				node.setAttribute('cx', '10');
				node.setAttribute('cy', '10');
				node.setAttribute('r', '7');
				node.setAttribute('pathLength', '1');
				node.setAttribute('data-activity-map-slice', slice.id);
				this.nodes.set(slice.id, node);
			}
			node.setAttribute('stroke', slice.color);
			node.setAttribute('stroke-dasharray', `${String(slice.ratio)} ${String(1 - slice.ratio)}`);
			node.setAttribute('stroke-dashoffset', String(-cursor));
			cursor += slice.ratio;
			this.svg.appendChild(node);
		}
	}
}

/** Builds the same stable-color distribution used by the full donut. */
export function headerDonutSlices(
	distribution: DistributionResult | null,
	snapshot: TrackingSnapshot | null,
	options: LiveDistributionOptions = {},
): HeaderDonutSlice[] {
	if (!distribution) return [];
	const withLive = withLiveActivity(distribution, snapshot, options);
	const model = buildChartModel(withLive);
	if (model.total <= 0) return [];
	return model.items.map((item) => ({
		id: item.id,
		ratio: item.value / model.total,
		color: item.color,
	}));
}

function normalizeSlices(slices: readonly HeaderDonutSlice[]): HeaderDonutSlice[] {
	const valid = slices.filter((slice) => Number.isFinite(slice.ratio) && slice.ratio > 0);
	const total = valid.reduce((sum, slice) => sum + slice.ratio, 0);
	if (total <= 0) return [];
	return valid.map((slice) => ({
		...slice,
		ratio: Math.round((slice.ratio / total) * 10_000) / 10_000,
	}));
}
