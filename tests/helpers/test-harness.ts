/**
 * Lightweight test harness with no external runner dependency.
 *
 * The repository targets Node 20.11+. To stay deterministic on every Node
 * version (including brand-new ones where third-party runners may not yet
 * support the test runner's process model), this harness keeps its own tiny
 * suite registry and is executed by `tests/run.ts` via jiti. It exposes a
 * Vitest-like surface (`describe`, `it`, `beforeEach`, `expect`) so test files
 * stay readable.
 *
 * Design:
 * - `describe`/`it` register into a module-level registry at import time.
 * - `tests/run.ts` imports every `*.test.ts` file (registering its tests),
 *   then calls {@link runRegisteredTests} to execute them in registration
 *   order and exits non-zero on any failure.
 * - No concurrency: tests share a process and run sequentially, which is what
 *   deterministic clock/adapter fakes require anyway.
 */

import assert from 'node:assert/strict';

type TestFn = () => void | Promise<void>;

interface TestCase {
	name: string;
	fn: TestFn;
}

interface Suite {
	name: string;
	tests: TestCase[];
	beforeEach?: () => void | Promise<void>;
}

const suites: Suite[] = [];
let currentSuite: Suite | null = null;

/** Registers a test group. Suites must be defined at import time. */
export function describe(name: string, fn: () => void): void {
	const suite: Suite = { name, tests: [] };
	const previous = currentSuite;
	currentSuite = suite;
	try {
		fn();
	} finally {
		currentSuite = previous;
	}
	suites.push(suite);
}

/** Registers a test case in the current suite. */
export function it(name: string, fn: TestFn): void {
	const target: Suite = currentSuite ?? { name: '(root)', tests: [] };
	target.tests.push({ name, fn });
	if (!currentSuite) {
		suites.push(target);
	}
}

/** Runs a setup hook before each test in the enclosing describe. */
export function beforeEach(fn: () => void | Promise<void>): void {
	if (!currentSuite) {
		throw new Error('beforeEach used outside describe');
	}
	currentSuite.beforeEach = fn;
}

/** Assertion helper. Small surface; add matchers only when a test needs one. */
export const expect = <T>(actual: T): Expectation<T> => new Expectation(actual);

/** Surface for asserting a promise rejects: `await expect(p).rejects.toBeTruthy()`. */
export interface RejectExpectation {
	toThrow(matcher?: RegExp | string): Promise<void>;
	toBeTruthy(): Promise<void>;
	toBeDefined(): Promise<void>;
}

/** Helper to assert a promise rejects. Always awaited so rejections are handled. */
export function expectReject(promise: Promise<unknown>): RejectExpectation {
	return {
		async toThrow(matcher?: RegExp | string) {
			let threw = false;
			let message = '';
			try {
				await promise;
			} catch (error) {
				threw = true;
				message = error instanceof Error ? error.message : String(error);
			}
			if (!threw) {
				assert.fail('expected promise to reject, but it resolved');
			}
			if (matcher) {
				const re = typeof matcher === 'string' ? new RegExp(matcher) : matcher;
				assert.ok(
					re.test(message),
					`expected rejection message to match ${matcher}, got: ${message}`,
				);
			}
		},
		async toBeTruthy() {
			try {
				await promise;
				assert.fail('expected promise to reject, but it resolved');
			} catch {
				// expected
			}
		},
		async toBeDefined() {
			try {
				await promise;
				assert.fail('expected promise to reject, but it resolved');
			} catch (error) {
				assert.ok(error !== undefined && error !== null);
			}
		},
	};
}

/** Negation helper: `expect(x).not.toBeNull()` asserts x is not null. */
export const expectNot = {
	toBeNull: (actual: unknown): void => {
		assert.notEqual(actual, null);
	},
	toBeUndefined: (actual: unknown): void => {
		assert.notEqual(actual, undefined);
	},
};

/** Negation surface returned by {@link Expectation.not}. */
export interface NotExpectation<T> {
	toBeNull(): void;
	toBeUndefined(): void;
	toBeDefined(): void;
	toBe(expected: T): void;
	toEqual(expected: unknown): void;
}

class Expectation<T> {
	constructor(private readonly actual: T) {}

	/** Negated assertions. */
	get not(): NotExpectation<T> {
		const actual = this.actual;
		return {
			toBeNull: () => assert.notEqual(actual, null),
			toBeUndefined: () => assert.notEqual(actual, undefined),
			toBeDefined: () => assert.equal(actual, undefined),
			toBe: (expected: T) => assert.notEqual(actual, expected),
			toEqual: (expected: unknown) => assert.notDeepEqual(actual, expected),
		};
	}

	toBe(expected: T): void {
		assert.equal(this.actual, expected);
	}

	toEqual(expected: unknown): void {
		assert.deepEqual(this.actual, expected as T);
	}

	toMatchObject(expected: unknown): void {
		assertMatchObject(this.actual, expected);
	}

	toBeNull(): void {
		assert.equal(this.actual, null);
	}

	toBeUndefined(): void {
		assert.equal(this.actual, undefined);
	}

	toBeDefined(): void {
		assert.notEqual(this.actual, undefined);
	}

	toBeTrue(): void {
		assert.equal(this.actual, true);
	}

	toBeFalse(): void {
		assert.equal(this.actual, false);
	}

	toHaveLength(length: number): void {
		assert.equal((this.actual as unknown as { length: number }).length, length);
	}

	toContain(item: unknown): void {
		assert.ok(
			Array.isArray(this.actual) || typeof this.actual === 'string',
			'toContain expects an array or string',
		);
		assert.ok(
			(this.actual as unknown as unknown[]).includes(item),
			`expected ${JSON.stringify(this.actual)} to contain ${JSON.stringify(item)}`,
		);
	}

	toBeGreaterThan(n: number): void {
		assert.ok(
			(this.actual as unknown as number) > n,
			`expected ${JSON.stringify(this.actual)} > ${n}`,
		);
	}

	toBeGreaterThanOrEqual(n: number): void {
		assert.ok(
			(this.actual as unknown as number) >= n,
			`expected ${JSON.stringify(this.actual)} >= ${n}`,
		);
	}

	toBeLessThan(n: number): void {
		assert.ok(
			(this.actual as unknown as number) < n,
			`expected ${JSON.stringify(this.actual)} < ${n}`,
		);
	}

	toBeLessThanOrEqual(n: number): void {
		assert.ok(
			(this.actual as unknown as number) <= n,
			`expected ${JSON.stringify(this.actual)} <= ${n}`,
		);
	}
}

function assertMatchObject(actual: unknown, expected: unknown): void {
	if (expected === null || typeof expected !== 'object') {
		assert.deepEqual(actual, expected);
		return;
	}
	const exp = expected as Record<string, unknown>;
	for (const key of Object.keys(exp)) {
		const a = (actual as Record<string, unknown> | null | undefined)?.[key];
		const e = exp[key];
		if (e !== null && typeof e === 'object' && !Array.isArray(e)) {
			assertMatchObject(a, e);
		} else {
			assert.deepEqual(a, e);
		}
	}
}

/** Test execution result for one suite. */
export interface TestResult {
	passed: number;
	failed: number;
}

/**
 * Execute every registered suite sequentially. Returns aggregate counts. On
 * failure, prints the failing assertion. The caller decides the exit code.
 */
export async function runRegisteredTests(): Promise<TestResult> {
	let passed = 0;
	let failed = 0;
	for (const suite of suites) {
		for (const test of suite.tests) {
			try {
				if (suite.beforeEach) {
					await suite.beforeEach();
				}
				await test.fn();
				passed += 1;
				console.log(`  \u2713 ${suite.name} > ${test.name}`);
			} catch (error) {
				failed += 1;
				const message = error instanceof Error ? error.message : String(error);
				const stack = error instanceof Error ? error.stack : undefined;
				console.log(`  \u2717 ${suite.name} > ${test.name}`);
				console.log(`      ${message}`);
				if (stack) {
					const firstLine = stack.split('\n').slice(1, 4).join('\n      ');
					console.log(`      ${firstLine}`);
				}
			}
		}
	}
	return { passed, failed };
}
