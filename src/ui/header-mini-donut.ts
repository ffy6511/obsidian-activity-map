/** Minimal surface used by the header manager and deterministic tests. */
export interface HeaderMiniDonutPort {
	update(ratio: number): void;
}

/**
 * A permanently mounted header donut. Runtime status never replaces these
 * nodes; only a changed, bounded data ratio updates the foreground arc.
 */
export class HeaderMiniDonut implements HeaderMiniDonutPort {
	private readonly value: SVGCircleElement;
	private ratio = Number.NaN;

	constructor(host: HTMLElement) {
		host.empty();
		const svg = host.createSvg('svg');
		svg.setAttribute('class', 'activity-map-header-donut');
		svg.setAttribute('viewBox', '0 0 20 20');
		svg.setAttribute('aria-hidden', 'true');
		const track = svg.createSvg('circle');
		track.setAttribute('class', 'activity-map-header-donut-track');
		track.setAttribute('cx', '10');
		track.setAttribute('cy', '10');
		track.setAttribute('r', '7');
		this.value = svg.createSvg('circle');
		this.value.setAttribute('class', 'activity-map-header-donut-value');
		this.value.setAttribute('cx', '10');
		this.value.setAttribute('cy', '10');
		this.value.setAttribute('r', '7');
		this.value.setAttribute('pathLength', '1');
		this.update(0);
	}

	update(ratio: number): void {
		const bounded = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
		const rounded = Math.round(bounded * 10_000) / 10_000;
		if (rounded === this.ratio) return;
		this.ratio = rounded;
		this.value.style.strokeDasharray = `${String(rounded)} 1`;
		this.value.setAttribute('data-activity-map-ratio', String(rounded));
	}
}
