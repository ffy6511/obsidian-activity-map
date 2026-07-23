import type { Extension, Transaction } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, type MarkdownFileInfo, type MarkdownView } from 'obsidian';

import {
	countGraphemes,
	ImeCommitTracker,
	isAppliedTypedInput,
	type TypedInputCount,
} from '../tracking/typed-input';

/** Stable editor provenance passed to tracking alongside a content-free count. */
export interface CodeMirrorTypedInputTarget {
	windowId: string;
	leafId: string;
}

export interface CodeMirrorTypedInputOptions {
	resolveTarget(info: MarkdownFileInfo): CodeMirrorTypedInputTarget | null;
	onTypedInput(input: CodeMirrorTypedInputTarget & TypedInputCount): void;
}

/**
 * `editorInfoField` can be the outer MarkdownView or its active editor mode.
 * Both identify the same foreground leaf; unrelated MarkdownFileInfo objects
 * must not inherit that leaf merely because they reference the same file.
 */
export function belongsToMarkdownEditor(info: MarkdownFileInfo, view: MarkdownView): boolean {
	return info.file?.path === view.file?.path && (info === view || info === (view.currentMode as unknown));
}

/**
 * Count committed CodeMirror text input without making DOM event timing the
 * authority. This extension is registered through Obsidian's public editor
 * extension API, so every callback belongs to the exact EditorView that
 * applied the transaction.
 */
export function createCodeMirrorTypedInputExtension(options: CodeMirrorTypedInputOptions): Extension {
	class TypedInputViewPlugin {
		private readonly ime = new ImeCommitTracker();
		private readonly ownerWindow: Window | null;
		private firstFrame: number | null = null;
		private secondFrame: number | null = null;
		private destroyed = false;

		constructor(private readonly view: EditorView) {
			this.ownerWindow = view.dom.ownerDocument.defaultView;
		}

		update(update: ViewUpdate): void {
			for (const transaction of update.transactions) {
				const isCompose = transaction.isUserEvent('input.type.compose');
				const insertedGraphemes = transaction.docChanged ? insertedGraphemeCount(transaction) : 0;
				if (!isAppliedTypedInput(transaction)) continue;
				const counted = this.ime.observeTransaction({
					typedChars: insertedGraphemes,
					isComposition: isCompose,
				});
				if (counted) this.emit(counted);
			}
		}

		onCompositionStart(event: Event): void {
			if (!event.isTrusted) return;
				this.cancelFrames();
				const settled = this.ime.beginComposition();
				if (settled) this.emit(settled);
			}

		onCompositionEnd(event: Event): void {
			const data = (event as CompositionEvent).data;
			const finalGraphemes = typeof data === 'string' ? countGraphemes(data) : 0;
			this.cancelFrames();
			const generation = this.ime.endComposition({ fallbackChars: finalGraphemes, isTrusted: event.isTrusted });
			if (generation === null) return;
			const ownerWindow = this.ownerWindow;
			if (!ownerWindow) return;
			// CM6 may schedule its own mutation flush after this observer. The end
			// can be reported untrusted even after a trusted start; it only settles
			// already-numeric transaction evidence, never its own composition datum.
		// Two frames place finalization after both the normal microtask path and
		// Android's requestAnimationFrame-based flush without private CM internals.
			this.firstFrame = ownerWindow.requestAnimationFrame(() => {
				this.firstFrame = null;
				this.secondFrame = ownerWindow.requestAnimationFrame(() => {
					this.secondFrame = null;
					if (this.destroyed) return;
					const counted = this.ime.finalize(generation);
					if (counted) this.emit(counted);
				});
			});
		}

		destroy(): void {
			this.destroyed = true;
			this.cancelFrames();
			this.ime.cancel();
		}

		private emit(counted: TypedInputCount): void {
			const info = this.view.state.field(editorInfoField, false);
			if (!info) return;
			const target = options.resolveTarget(info);
			if (!target) return;
			options.onTypedInput({ ...target, ...counted });
		}

		private cancelFrames(): void {
			if (this.firstFrame !== null) this.ownerWindow?.cancelAnimationFrame(this.firstFrame);
			if (this.secondFrame !== null) this.ownerWindow?.cancelAnimationFrame(this.secondFrame);
			this.firstFrame = null;
			this.secondFrame = null;
		}
	}

	return ViewPlugin.fromClass(TypedInputViewPlugin, {
		eventObservers: {
			compositionstart(event) {
				this.onCompositionStart(event);
			},
			compositionend(event) {
				this.onCompositionEnd(event);
			},
		},
	});
}

/** Convert transaction text to a count synchronously, then discard the text. */
export function insertedGraphemeCount(transaction: Pick<Transaction, 'changes'>): number {
	let count = 0;
	transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
		count += countGraphemes(inserted.toString());
	});
	return count;
}
