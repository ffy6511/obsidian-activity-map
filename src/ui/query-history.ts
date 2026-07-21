import type { DistributionQuery } from '../query/distribution-query';

/** Per-view browser-like query history; values are cloned at the boundary. */
export class QueryHistory {
	private readonly backStack: DistributionQuery[] = [];
	private readonly forwardStack: DistributionQuery[] = [];

	get canGoBack(): boolean { return this.backStack.length > 0; }
	get canGoForward(): boolean { return this.forwardStack.length > 0; }

	push(current: DistributionQuery): void {
		this.backStack.push(cloneQuery(current));
		this.forwardStack.length = 0;
	}

	back(current: DistributionQuery): DistributionQuery | null {
		return this.move(this.backStack, this.forwardStack, current);
	}

	forward(current: DistributionQuery): DistributionQuery | null {
		return this.move(this.forwardStack, this.backStack, current);
	}

	private move(source: DistributionQuery[], destination: DistributionQuery[], current: DistributionQuery): DistributionQuery | null {
		const target = source.pop();
		if (!target) return null;
		destination.push(cloneQuery(current));
		return cloneQuery(target);
	}
}

function cloneQuery(query: DistributionQuery): DistributionQuery {
	return { ...query, range: { ...query.range } };
}
