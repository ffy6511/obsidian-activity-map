import type { TypedInputRecord } from '../domain/activity';

/** Numeric, content-free evidence emitted by the CodeMirror platform bridge. */
export type TypedInputCount = Pick<TypedInputRecord, 'typedChars' | 'source'>;

/**
 * A CodeMirror transaction has already applied its document change. Its text
 * has been reduced to this number at the platform boundary and cannot reach
 * the tracking or persistence layers.
 */
export interface AppliedTypedInput {
	typedChars: number;
	isComposition: boolean;
}

/** Narrow public surface needed to identify a CodeMirror typed transaction. */
export interface AppliedTransactionKind {
	docChanged: boolean;
	isUserEvent(event: string): boolean;
}

/** A typed transaction excludes paste, drop, completion, history, and non-input edits. */
export function isAppliedTypedInput(transaction: AppliedTransactionKind): boolean {
	return transaction.docChanged && transaction.isUserEvent('input.type');
}

interface PendingComposition {
	generation: number;
	fallback: TypedInputCount | null;
}

export interface CompositionEnd {
	fallbackChars: number;
	isTrusted: boolean;
}

/**
 * Resolves composition transactions without retaining their text or candidate
 * buffer. CodeMirror may apply the final IME change on either side of
 * `compositionend`, so the tracker retains only the latest numeric provisional
 * value until a trailing transaction or bounded finalization settles it.
 */
export class ImeCommitTracker {
	private generation = 0;
	private pending: PendingComposition | null = null;
	private composing = false;
	private provisional: TypedInputCount | null = null;

	/** Start a new composition and settle any prior completed fallback first. */
	beginComposition(): TypedInputCount | null {
		const settled = this.pending?.fallback ?? null;
		this.generation += 1;
		this.pending = null;
		this.composing = true;
		this.provisional = null;
		return settled;
	}

	/**
	 * Start a finalization window after a trusted composition start. An untrusted
	 * end notification is allowed to close that existing window because CM6 can
	 * surface it that way; its datum never becomes a count. It may settle only a
	 * prior numeric transaction that the bridge already observed.
	 */
	endComposition(end: CompositionEnd): number | null {
		if (!this.composing) return null;
		this.composing = false;
		const generation = ++this.generation;
		const eventFallback =
			validTypedChars(end.fallbackChars) && end.fallbackChars > 0
				? { typedChars: end.fallbackChars, source: 'ime-commit' as const }
				: null;
		this.pending = {
			generation,
			// A trusted empty end means cancellation. An untrusted end's datum cannot
			// be trusted, so use only the already-reduced CM transaction evidence.
			fallback: end.isTrusted ? eventFallback : this.provisional,
		};
		this.provisional = null;
		return generation;
	}

	/**
	 * Classify an already-applied CodeMirror input transaction. Composition
	 * updates remain provisional. The final composition mutation may precede the
	 * end observer, while the first trailing mutation after an end still wins.
	 */
	observeTransaction(input: AppliedTypedInput): TypedInputCount | null {
		if (!validTypedChars(input.typedChars)) return null;
		if (input.isComposition) {
			if (this.pending) {
				this.pending = null;
				return input.typedChars > 0
					? { typedChars: input.typedChars, source: 'ime-commit' }
					: null;
			}
			if (this.composing) {
				this.provisional =
					input.typedChars > 0
						? { typedChars: input.typedChars, source: 'ime-commit' }
						: null;
			}
			return null;
		}
		if (this.pending) {
			this.pending = null;
			return input.typedChars > 0
				? { typedChars: input.typedChars, source: 'ime-commit' }
				: null;
		}
		if (input.typedChars === 0) return null;
		return { typedChars: input.typedChars, source: 'insert-text' };
	}

	/** Emit the numeric fallback only if the scheduled generation is current. */
	finalize(generation: number): TypedInputCount | null {
		if (this.pending?.generation !== generation) return null;
		const pending = this.pending;
		this.pending = null;
		return pending.fallback;
	}

	/** Drop any unfinished composition during editor teardown. */
	cancel(): void {
		this.generation += 1;
		this.pending = null;
		this.composing = false;
		this.provisional = null;
	}
}

function validTypedChars(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

/** Count user-perceived Unicode characters without persisting their content. */
export function countGraphemes(value: string): number {
	type Segmenter = { segment(input: string): Iterable<unknown> };
	const SegmenterCtor = (
		Intl as typeof Intl & {
			Segmenter?: new (
				locales?: string | string[],
				options?: { granularity: 'grapheme' },
			) => Segmenter;
		}
	).Segmenter;
	if (SegmenterCtor)
		return [...new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(value)].length;
	// Fallback keeps combining marks with their base when Intl.Segmenter is absent.
	return [...value.normalize('NFC')].length;
}

/**
 * Count input-bearing graphemes while excluding standalone Unicode whitespace.
 * This reduction happens at the editor boundary, so whitespace text cannot
 * enter records and historical numeric evidence is never rewritten.
 */
export function countInputGraphemes(value: string): number {
	type Segment = { segment: string };
	type Segmenter = { segment(input: string): Iterable<Segment> };
	const SegmenterCtor = (
		Intl as typeof Intl & {
			Segmenter?: new (
				locales?: string | string[],
				options?: { granularity: 'grapheme' },
			) => Segmenter;
		}
	).Segmenter;
	if (SegmenterCtor) {
		let count = 0;
		for (const part of new SegmenterCtor(undefined, { granularity: 'grapheme' }).segment(
			value,
		)) {
			if (!isWhitespaceGrapheme(part.segment)) count += 1;
		}
		return count;
	}
	return [...value.normalize('NFC')].filter((character) => !isWhitespaceGrapheme(character))
		.length;
}

function isWhitespaceGrapheme(value: string): boolean {
	return /^\p{White_Space}+$/u.test(value);
}
