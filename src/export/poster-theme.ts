/** Fully resolved visual tokens embedded into one standalone poster export. */
export interface PosterTheme {
	background: string;
	border: string;
	text: string;
	muted: string;
	accent: string;
	fontFamily: string;
	chartColors: Readonly<Record<string, string>>;
}

const DEFAULT_CHART_COLORS: Readonly<Record<string, string>> = {
	'var(--color-base-50)': '#6b7280',
	'var(--color-blue)': '#3b82f6',
	'var(--color-purple)': '#8b5cf6',
	'var(--color-green)': '#22c55e',
	'var(--color-orange)': '#f97316',
	'var(--color-pink)': '#ec4899',
	'var(--color-yellow)': '#ca8a04',
	'var(--color-cyan)': '#0891b2',
	'var(--color-red)': '#dc2626',
};

/** Safe fallback for hosts that cannot expose their computed theme values. */
export const DEFAULT_POSTER_THEME: PosterTheme = {
	background: '#f8fafc',
	border: '#cbd5e1',
	text: '#111827',
	muted: '#64748b',
	accent: '#4568e8',
	fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
	chartColors: DEFAULT_CHART_COLORS,
};

/**
 * Resolve the active Obsidian theme once when the modal opens. The SVG is
 * downloaded outside the app's stylesheet, so leaving CSS variables in the
 * markup would silently revert to white/default colors in external viewers.
 */
export function posterThemeFromDocument(document: Document): PosterTheme {
	const view = document.defaultView;
	const body = document.body;
	if (!view || !body) return DEFAULT_POSTER_THEME;
	const styles = view.getComputedStyle(body);
	const color = (variable: string, fallback: string) =>
		resolveThemeColor(document, variable, fallback);
	return {
		background: color('--background-primary', DEFAULT_POSTER_THEME.background),
		border: color('--background-modifier-border', DEFAULT_POSTER_THEME.border),
		text: color('--text-normal', DEFAULT_POSTER_THEME.text),
		muted: color('--text-muted', DEFAULT_POSTER_THEME.muted),
		accent: color('--interactive-accent', DEFAULT_POSTER_THEME.accent),
		fontFamily: styles.fontFamily.trim() || DEFAULT_POSTER_THEME.fontFamily,
		chartColors: Object.fromEntries(
			Object.entries(DEFAULT_CHART_COLORS).map(([token, fallback]) => [
				token,
				color(token.slice(4, -1), fallback),
			]),
		),
	};
}

export function completePosterTheme(theme: PosterTheme | undefined): PosterTheme {
	if (!theme) return DEFAULT_POSTER_THEME;
	return {
		...DEFAULT_POSTER_THEME,
		...theme,
		chartColors: { ...DEFAULT_CHART_COLORS, ...theme.chartColors },
	};
}

function resolveThemeColor(document: Document, variable: string, fallback: string): string {
	const view = document.defaultView;
	const body = document.body;
	if (!view || !body || !view.getComputedStyle(body).getPropertyValue(variable).trim())
		return fallback;
	const probe = body.createSpan();
	probe.style.color = `var(${variable})`;
	probe.hidden = true;
	try {
		return view.getComputedStyle(probe).color || fallback;
	} finally {
		probe.remove();
	}
}
