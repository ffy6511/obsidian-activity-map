import { describe, expect, it } from '../helpers/test-harness';

import { TypedInputClassifier, countGraphemes } from '../../src/tracking/typed-input';

describe('trusted typed-input classifier', () => {
	it('counts grapheme clusters rather than UTF-16 units', () => {
		expect(countGraphemes('A你e\u0301👩‍💻')).toBe(4);
	});

	it('accepts trusted insertText only from an editor surface', () => {
		const classifier = new TypedInputClassifier();
		expect(classifier.observe({
			kind: 'beforeinput', isTrusted: true, isEditor: true, inputType: 'insertText', data: '你好', isComposing: false,
		})).toEqual({ typedChars: 2, source: 'insert-text' });
		expect(classifier.observe({
			kind: 'beforeinput', isTrusted: false, isEditor: true, inputType: 'insertText', data: 'ignored', isComposing: false,
		})).toBeNull();
		expect(classifier.observe({
			kind: 'beforeinput', isTrusted: true, isEditor: false, inputType: 'insertText', data: 'ignored', isComposing: false,
		})).toBeNull();
	});

	it('counts an IME final commit once when insertText follows compositionend', () => {
		const classifier = new TypedInputClassifier();
		classifier.observe({ kind: 'compositionstart', isTrusted: true, isEditor: true });
		expect(classifier.observe({
			kind: 'beforeinput', isTrusted: true, isEditor: true, inputType: 'insertCompositionText', data: 'ni', isComposing: true,
		})).toBeNull();
		classifier.observe({ kind: 'compositionend', isTrusted: true, isEditor: true, data: '你' });
		expect(classifier.observe({
			kind: 'beforeinput', isTrusted: true, isEditor: true, inputType: 'insertText', data: '你', isComposing: false,
		})).toEqual({ typedChars: 1, source: 'ime-commit' });
		expect(classifier.flushPendingComposition()).toBeNull();
	});

	it('flushes an IME final commit when the browser emits no final insertText', () => {
		const classifier = new TypedInputClassifier();
		classifier.observe({ kind: 'compositionstart', isTrusted: true, isEditor: true });
		classifier.observe({ kind: 'compositionend', isTrusted: true, isEditor: true, data: '中文' });
		expect(classifier.flushPendingComposition()).toEqual({ typedChars: 2, source: 'ime-commit' });
	});

	it('excludes paste, drop, history, and composition updates', () => {
		const classifier = new TypedInputClassifier();
		for (const inputType of ['insertFromPaste', 'insertFromDrop', 'historyUndo', 'historyRedo', 'insertCompositionText']) {
			expect(classifier.observe({
				kind: 'beforeinput', isTrusted: true, isEditor: true, inputType, data: 'ignored', isComposing: inputType === 'insertCompositionText',
			})).toBeNull();
		}
	});
});
