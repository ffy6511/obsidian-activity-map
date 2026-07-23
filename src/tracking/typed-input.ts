/**
 * Trusted text-input classification.
 *
 * The browser exposes an IME composition through several intermediate input
 * events. We retain only a pending numeric commit until the current microtask:
 * a following final `insertText` replaces it, while composition engines that
 * emit no such event still produce one count. The committed string never
 * leaves this module.
 */

import type { TypedInputRecord } from '../domain/activity';

export interface TypedInputObservation {
	isTrusted?: boolean;
	kind: 'beforeinput' | 'compositionstart' | 'compositionend';
	isEditor: boolean;
	/** Ephemeral source identity used only to verify the currently active leaf. */
	leafId?: string;
	inputType?: string;
	data?: string | null;
	isComposing?: boolean;
}

export type TypedInputCount = Pick<TypedInputRecord, 'typedChars' | 'source'>;

/** Stateful classifier for a single owner window. */
export class TypedInputClassifier {
	private composing = false;
	private pendingComposition: TypedInputCount | null = null;

	observe(observation: TypedInputObservation): TypedInputCount | null {
		if (observation.isTrusted !== true || !observation.isEditor) return null;
		if (observation.kind === 'compositionstart') {
			this.composing = true;
			return null;
		}
		if (observation.kind === 'compositionend') {
			this.composing = false;
			const typedChars = countGraphemes(observation.data ?? '');
			this.pendingComposition = typedChars > 0 ? { typedChars, source: 'ime-commit' } : null;
			return null;
		}
		if (observation.inputType !== 'insertText' || observation.isComposing === true || this.composing) {
			return null;
		}
		const typedChars = countGraphemes(observation.data ?? '');
		if (this.pendingComposition) {
			// Final insertText wins because it is the browser's completed commit.
			// Clearing the pending value guarantees that one IME sequence emits once.
			this.pendingComposition = null;
			return typedChars > 0 ? { typedChars, source: 'ime-commit' } : null;
		}
		return typedChars > 0 ? { typedChars, source: 'insert-text' } : null;
	}

	/** Emits a composition commit only when no final insertText arrived this turn. */
	flushPendingComposition(): TypedInputCount | null {
		const pending = this.pendingComposition;
		this.pendingComposition = null;
		return pending;
	}
}

/** Count user-perceived Unicode characters without persisting their content. */
export function countGraphemes(value: string): number {
	type Segmenter = { segment(input: string): Iterable<unknown> };
	type SegmenterConstructor = new (
		locales?: string | readonly string[],
		options?: { granularity: 'grapheme' },
	) => Segmenter;
	const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
	const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;
	if (segmenter) return [...segmenter.segment(value)].length;
	// Array.from keeps surrogate pairs together; this conservative fallback is
	// only for hosts without Intl.Segmenter and never stores the source value.
	return Array.from(value.normalize('NFC')).length;
}
