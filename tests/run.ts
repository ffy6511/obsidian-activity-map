/**
 * Test runner entry point.
 *
 * Discovers every test file under tests/, imports it through jiti (which also
 * resolves the source imports), and executes the suites registered in
 * {@link ../helpers/test-harness.ts}. Exits non-zero on any failure.
 *
 * Invoked by `npm test` as:
 *   node --import jiti/register tests/run.ts
 *
 * This avoids `node --test`'s process-isolation model, which does not yet
 * cooperate with jiti's on-the-fly transpilation on the newest Node versions.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runRegisteredTests } from './helpers/test-harness';

const TESTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.');

async function discoverTestFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await discoverTestFiles(full)));
		} else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
			files.push(full);
		}
	}
	return files;
}

async function main(): Promise<void> {
	const start = Date.now();
	const files = (await discoverTestFiles(TESTS_ROOT)).sort();
	console.log(`Found ${files.length} test file(s)`);
	for (const file of files) {
		// Importing registers describe/it suites; we don't need the exports.
		await import(pathToFileURL(file).href);
		// Confirm the file is readable on disk (surfacing perms errors early).
		await stat(file);
	}
	console.log('Running tests:');
	const { passed, failed } = await runRegisteredTests();
	const ms = Date.now() - start;
	console.log('');
	console.log(`Tests: ${passed} passed, ${failed} failed (${ms}ms)`);
	if (failed > 0) {
		process.exitCode = 1;
	}
}

	await main();
// jiti's module-register hook keeps an open handle on Node 26 that prevents
// clean exit; exit explicitly with the code main() established.
process.exit(process.exitCode ?? 0);
