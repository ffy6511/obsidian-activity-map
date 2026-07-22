import { describe, expect, it } from '../helpers/test-harness';

import {
	dataRoot,
	checkpointPath,
	filesRegistryPath,
	sessionShardPath,
	dailySummaryPath,
	resolvePluginRoot,
	mandatoryExcludedPrefixes,
	normalizeVaultPath,
	type PathAdapter,
} from '../../src/data/paths';
import { ExclusionMatcher, globToRegExp } from '../../src/data/exclusions';

/** A configurable fake adapter honoring a custom config-directory name. */
function adapter(configDir: string, manifestPath?: string): PathAdapter {
	return {
		configDir,
		manifestPath,
		normalize: (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/'),
		join: (...segs) => segs.join('/').replace(/\/+/g, '/'),
	};
}

describe('plugin root and data paths', () => {
	it('resolves the plugin root from manifest.dir when available', () => {
		const a = adapter('/vault/.config', '/vault/.config/plugins/activity-map/manifest.json');
		expect(resolvePluginRoot(a)).toBe('/vault/.config/plugins/activity-map');
	});

	it('falls back to configDir/plugins/<id> when manifest.dir is absent', () => {
		const a = adapter('/vault/.config');
		expect(resolvePluginRoot(a)).toBe('/vault/.config/plugins/activity-map');
	});

	it('honors a custom config-directory name (the layout never assumes a default config dir)', () => {
		const a = adapter('/vault/.myvault', '/vault/.myvault/plugins/activity-map/manifest.json');
		expect(resolvePluginRoot(a)).toBe('/vault/.myvault/plugins/activity-map');
		expect(dataRoot(a)).toBe('/vault/.myvault/plugins/activity-map/data');
	});

	it('builds checkpoint, registry, shard, and summary paths under the data root', () => {
		// Fixture uses a non-default config name to prove the layout is not
		// hard-coded to any particular config-directory name.
		const a = adapter('/vault/.cfg');
		expect(checkpointPath(a)).toBe('/vault/.cfg/plugins/activity-map/data/checkpoint.json');
		expect(filesRegistryPath(a)).toBe('/vault/.cfg/plugins/activity-map/data/files.json');
		expect(sessionShardPath(a, 'dev1', '2026-07-21')).toBe(
			'/vault/.cfg/plugins/activity-map/data/sessions/dev1/2026-07-21.ndjson',
		);
		expect(dailySummaryPath(a, 'dev1', '2026-07-21')).toBe(
			'/vault/.cfg/plugins/activity-map/data/daily/dev1/2026-07-21.json',
		);
	});
});

describe('mandatory exclusions', () => {
	it('excludes the config dir and plugin root even with a custom config name', () => {
		const a = adapter('/vault/.myvault', '/vault/.myvault/plugins/activity-map/manifest.json');
		const prefixes = mandatoryExcludedPrefixes(a);
		expect(prefixes).toContain('vault/.myvault');
		expect(prefixes.some((p) => p.endsWith('plugins/activity-map'))).toBeTrue();
	});
});

describe('normalizeVaultPath', () => {
	it('canonicalizes separators and trims leading/trailing slashes', () => {
		expect(normalizeVaultPath('\\a\\b/c')).toBe('a/b/c');
		expect(normalizeVaultPath('//a/b//')).toBe('a/b');
		expect(normalizeVaultPath('a')).toBe('a');
	});
});

describe('glob to regexp', () => {
	it('matches within a segment with * and does not cross slashes', () => {
		const re = globToRegExp('notes/*.md');
		expect(re.test('notes/a.md')).toBeTrue();
		expect(re.test('notes/sub/a.md')).toBeFalse();
	});

	it('matches across segments with **', () => {
		const re = globToRegExp('archive/**');
		expect(re.test('archive/old/x.md')).toBeTrue();
		expect(re.test('archive/x.md')).toBeTrue();
		expect(re.test('notes/x.md')).toBeFalse();
	});

	it('matches a single character with ?', () => {
		const re = globToRegExp('a?c.md');
		expect(re.test('abc.md')).toBeTrue();
		expect(re.test('ac.md')).toBeFalse();
	});
});

describe('ExclusionMatcher', () => {
	it('mandatory prefixes cannot be removed by user settings', () => {
		const a = adapter('/vault/.cfg');
		// User tries to "un-exclude" by giving an empty list; mandatory still apply.
		const matcher = new ExclusionMatcher(a, []);
		expect(matcher.isExcluded('vault/.cfg/plugins/activity-map/data/x')).toBeTrue();
		expect(matcher.isExcluded('vault/.cfg/community-plugins.json')).toBeTrue();
	});

	it('applies user globs case-sensitively', () => {
		const a = adapter('/vault/.cfg');
		const matcher = new ExclusionMatcher(a, ['Drafts/**']);
		expect(matcher.isExcluded('Drafts/x.md')).toBeTrue();
		expect(matcher.isExcluded('drafts/x.md')).toBeFalse();
	});

	it('lets ordinary tracked files through', () => {
		const a = adapter('/vault/.cfg');
		const matcher = new ExclusionMatcher(a, ['Archive/**']);
		expect(matcher.isExcluded('notes/today.md')).toBeFalse();
	});
});
