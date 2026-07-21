import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '../helpers/test-harness';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function markdownFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') continue;
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...await markdownFiles(target));
		else if (entry.name.endsWith('.md')) out.push(target);
	}
	return out;
}

function headingSlugs(markdown: string): Set<string> {
	const counts = new Map<string, number>();
	const slugs = new Set<string>();
	for (const line of markdown.split('\n')) {
		const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
		if (!match?.[2]) continue;
		const base = match[2].trim().toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
		const count = counts.get(base) ?? 0;
		counts.set(base, count + 1);
		slugs.add(count === 0 ? base : `${base}-${count}`);
	}
	return slugs;
}

describe('repository Markdown links', () => {
	it('resolves every repository-relative target and heading fragment', async () => {
		const failures: string[] = [];
		for (const file of await markdownFiles(ROOT)) {
			const markdown = await readFile(file, 'utf8');
			for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
				const raw = match[1]?.trim().replace(/^<|>$/g, '').split(/\s+['"]/)[0];
				if (!raw || /^(?:https?:|mailto:|data:)/.test(raw)) continue;
				const [relative, fragment] = raw.split('#', 2);
				const target = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file;
				if (!existsSync(target)) {
					failures.push(`${path.relative(ROOT, file)} -> missing ${raw}`);
					continue;
				}
				if (fragment && target.endsWith('.md')) {
					const slugs = headingSlugs(await readFile(target, 'utf8'));
					if (!slugs.has(decodeURIComponent(fragment).toLowerCase())) failures.push(`${path.relative(ROOT, file)} -> missing fragment ${raw}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
