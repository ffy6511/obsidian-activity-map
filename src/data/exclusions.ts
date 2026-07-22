/**
 * Path exclusion matching.
 *
 * User glob syntax: `*` within a segment, `**` across segments, `?` for one
 * character. Matching is case-sensitive for consistent cross-platform semantics.
 * Mandatory exclusions (config dir, plugin root, Activity Map data) always apply
 * and cannot be removed by user settings.
 */

import { mandatoryExcludedPrefixes, normalizeVaultPath, type PathAdapter } from './paths';

/** Compile a single glob into a RegExp anchored to the full vault-relative path. */
export function globToRegExp(glob: string): RegExp {
	// Escape regex specials except our glob metacharacters; translate *, **, ?.
	let pattern = '^';
	let i = 0;
	const g = normalizeVaultPath(glob);
	while (i < g.length) {
		const ch = g[i];
		if (ch === undefined) {
			break;
		}
		if (ch === '*') {
			const next = g[i + 1];
			if (next === '*') {
				// ** matches across segments (including slashes).
				pattern += '.*';
				i += 2;
				// Consume an optional trailing slash so "a/**" matches "a/" children.
				if (g[i] === '/') {
					i += 1;
				}
				continue;
			}
			// * matches within a segment (no slash).
			pattern += '[^/]*';
			i += 1;
			continue;
		}
		if (ch === '?') {
			pattern += '[^/]';
			i += 1;
			continue;
		}
		if (/[.+^${}()|[\]\\]/.test(ch)) {
			pattern += `\\${ch}`;
		} else {
			pattern += ch;
		}
		i += 1;
	}
	pattern += '$';
	return new RegExp(pattern);
}

/**
 * Exclusion matcher combining mandatory prefixes and user globs. Construct once
 * per settings change and call {@link isExcluded} for every resolved path.
 */
export class ExclusionMatcher {
	private readonly mandatory: string[];
	private readonly userRegexes: RegExp[];

	constructor(adapter: PathAdapter, userGlobs: readonly string[]) {
		this.mandatory = mandatoryExcludedPrefixes(adapter);
		this.userRegexes = userGlobs
			.map((g) => g.trim())
			.filter((g) => g.length > 0)
			.map((g) => globToRegExp(g));
	}

	/** True when the path must not be tracked. */
	isExcluded(path: string): boolean {
		const normalized = normalizeVaultPath(path);
		// Mandatory exclusions: prefix match against config/plugin/data roots.
		for (const prefix of this.mandatory) {
			if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
				return true;
			}
		}
		for (const re of this.userRegexes) {
			if (re.test(normalized)) {
				return true;
			}
		}
		return false;
	}

	/** The mandatory prefixes, for diagnostics/UI display. */
	mandatoryPrefixes(): readonly string[] {
		return this.mandatory;
	}
}
