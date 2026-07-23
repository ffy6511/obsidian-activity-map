import { describe, expect, it } from '../helpers/test-harness';

import {
	countGraphemes,
	countInputGraphemes,
	ImeCommitTracker,
	isAppliedTypedInput,
} from '../../src/tracking/typed-input';

describe('CodeMirror typed-input finalizer', () => {
	it('counts grapheme clusters rather than UTF-16 units', () => {
		expect(countGraphemes('A你e\u0301👩‍💻')).toBe(4);
	});

	it('excludes standalone Unicode whitespace graphemes from typedChars', () => {
		expect(countInputGraphemes(' \t\r\n\u00a0')).toBe(0);
		expect(countInputGraphemes('A 你e\u0301👩‍💻')).toBe(4);
	});

	it('counts ordinary applied typed transactions immediately', () => {
		const tracker = new ImeCommitTracker();
		expect(tracker.observeTransaction({ typedChars: 2, isComposition: false }))
			.toEqual({ typedChars: 2, source: 'insert-text' });
	});

	it('accepts only document-changing input.type transactions', () => {
		expect(isAppliedTypedInput({ docChanged: true, isUserEvent: (event) => event === 'input.type' }))
			.toBeTrue();
		for (const kind of ['input.paste', 'input.drop', 'input.complete', 'history.undo', 'programmatic']) {
			expect(isAppliedTypedInput({ docChanged: true, isUserEvent: (event) => event === kind })).toBeFalse();
		}
		expect(isAppliedTypedInput({ docChanged: false, isUserEvent: () => true })).toBeFalse();
	});

	it('keeps Pinyin composition updates provisional and prefers a delayed final transaction', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		for (const chars of [5, 6, 8]) {
			expect(tracker.observeTransaction({ typedChars: chars, isComposition: true })).toBeNull();
		}
		const generation = tracker.endComposition({ fallbackChars: 2, isTrusted: true });
		expect(generation).not.toBeNull();
		expect(tracker.observeTransaction({ typedChars: 2, isComposition: true }))
			.toEqual({ typedChars: 2, source: 'ime-commit' });
		expect(tracker.finalize(generation ?? -1)).toBeNull();
	});

	it('uses composition-end data only after CodeMirror had no trailing commit', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		expect(tracker.observeTransaction({ typedChars: 8, isComposition: true })).toBeNull();
		const generation = tracker.endComposition({ fallbackChars: 3, isTrusted: true });
		expect(tracker.finalize(generation ?? -1)).toEqual({ typedChars: 3, source: 'ime-commit' });
	});

	it('counts a non-composition final transaction once after composition end', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		const generation = tracker.endComposition({ fallbackChars: 2, isTrusted: true });
		expect(tracker.observeTransaction({ typedChars: 2, isComposition: false }))
			.toEqual({ typedChars: 2, source: 'ime-commit' });
		expect(tracker.finalize(generation ?? -1)).toBeNull();
	});

	it('settles a pre-end CJK commit when CodeMirror reports an untrusted end', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		for (const chars of [1, 2, 2, 3]) {
			expect(tracker.observeTransaction({ typedChars: chars, isComposition: true })).toBeNull();
		}
		const generation = tracker.endComposition({ fallbackChars: 0, isTrusted: false });
		expect(tracker.finalize(generation ?? -1)).toEqual({ typedChars: 3, source: 'ime-commit' });
	});

	it('drops a cancelled untrusted-end composition and cannot block later English input', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		expect(tracker.observeTransaction({ typedChars: 5, isComposition: true })).toBeNull();
		expect(tracker.observeTransaction({ typedChars: 0, isComposition: true })).toBeNull();
		const generation = tracker.endComposition({ fallbackChars: 0, isTrusted: false });
		expect(tracker.finalize(generation ?? -1)).toBeNull();
		expect(tracker.observeTransaction({ typedChars: 1, isComposition: false }))
			.toEqual({ typedChars: 1, source: 'insert-text' });
	});

	it('treats a trusted empty end as cancellation even when it has a provisional update', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		expect(tracker.observeTransaction({ typedChars: 4, isComposition: true })).toBeNull();
		const generation = tracker.endComposition({ fallbackChars: 0, isTrusted: true });
		expect(tracker.finalize(generation ?? -1)).toBeNull();
	});

	it('settles a completed fallback when the next trusted composition starts first', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		expect(tracker.observeTransaction({ typedChars: 2, isComposition: true })).toBeNull();
		tracker.endComposition({ fallbackChars: 0, isTrusted: false });
		expect(tracker.beginComposition()).toEqual({ typedChars: 2, source: 'ime-commit' });
	});

	it('does not let an untrusted end datum overwrite prior CodeMirror evidence', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		expect(tracker.observeTransaction({ typedChars: 2, isComposition: true })).toBeNull();
		const generation = tracker.endComposition({ fallbackChars: 99, isTrusted: false });
		expect(tracker.finalize(generation ?? -1)).toEqual({ typedChars: 2, source: 'ime-commit' });
	});

	it('invalidates a stale finalization when another composition starts', () => {
		const tracker = new ImeCommitTracker();
		tracker.beginComposition();
		const firstGeneration = tracker.endComposition({ fallbackChars: 1, isTrusted: true });
		tracker.beginComposition();
		expect(tracker.finalize(firstGeneration ?? -1)).toBeNull();
	});

	it('rejects zero, negative, and fractional transaction counts', () => {
		const tracker = new ImeCommitTracker();
		for (const typedChars of [0, -1, 1.5]) {
			expect(tracker.observeTransaction({ typedChars, isComposition: false })).toBeNull();
		}
	});
});
