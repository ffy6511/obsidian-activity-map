import { EditorState } from '@codemirror/state';

import { describe, expect, it } from '../helpers/test-harness';
import {
	belongsToMarkdownEditor,
	insertedGraphemeCount,
} from '../../src/platform/codemirror-typed-input';

describe('CodeMirror typed-input bridge', () => {
	it('counts only the inserted graphemes in an applied transaction', () => {
		const state = EditorState.create({ doc: 'before' });
		const transaction = state.update({ changes: { from: 0, to: 6, insert: '你e\u0301👩‍💻' } });
		expect(insertedGraphemeCount(transaction)).toBe(3);
	});

	it('returns zero for a deletion-only transaction', () => {
		const state = EditorState.create({ doc: '你' });
		const transaction = state.update({ changes: { from: 0, to: 1 } });
		expect(insertedGraphemeCount(transaction)).toBe(0);
	});

	it('accepts the active Markdown editor mode as editorInfoField provenance', () => {
		const mode = { file: { path: 'notes/a.md' } };
		const view = { file: { path: 'notes/a.md' }, currentMode: mode };
		expect(belongsToMarkdownEditor(mode as never, view as never)).toBe(true);
		expect(belongsToMarkdownEditor(view as never, view as never)).toBe(true);
		expect(belongsToMarkdownEditor({ file: { path: 'notes/a.md' } } as never, view as never)).toBe(false);
		expect(belongsToMarkdownEditor({ file: { path: 'notes/b.md' } } as never, view as never)).toBe(false);
	});
});
