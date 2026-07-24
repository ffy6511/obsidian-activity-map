import { describe, expect, it } from '../helpers/test-harness';

import { renderPosterCaptionEditor } from '../../src/ui/poster-caption-editor';
import { installDomEnvironment } from '../helpers/dom-environment';

describe('poster caption editor', () => {
	it('uses one accessible system-serif multiline editor and publishes plain caption text', () => {
		const { document } = installDomEnvironment();
		const container = document.createElement('div');
		document.body.appendChild(container);
		const captions: string[] = [];
		const editor = renderPosterCaptionEditor({
			container,
			value: 'Initial caption',
			onCaption: (value) => captions.push(value),
		});
		const input = container.querySelector<HTMLTextAreaElement>(
			'textarea[data-activity-map-id="poster-caption"]',
		);
		if (!input) throw new Error('caption editor missing');
		const lineCount = container.querySelector<HTMLElement>(
			'.activity-map-poster-caption-line-count',
		);
		if (!lineCount) throw new Error('caption line count missing');
		expect(input.classList.contains('activity-map-poster-caption-editor')).toBeTrue();
		expect(input.getAttribute('aria-label')).toBe('Optional poster caption');
		expect(input.value).toBe('Initial caption');
		expect(input.getAttribute('rows')).toBe('1');
		expect(input.getAttribute('wrap')).toBe('soft');
		expect(input.hasAttribute('data-poster-caption-font')).toBeFalse();
		expect(input.style.getPropertyValue('--activity-map-poster-caption-font')).toBe('');
		expect(lineCount.hidden).toBeTrue();
		input.dispatchEvent(new Event('focus'));
		expect(lineCount.hidden).toBeFalse();
		expect(lineCount.textContent).toBe('(1/3)');
		input.value = '';
		input.dispatchEvent(new Event('input'));
		expect(lineCount.textContent).toBe('(0/3)');
		input.value = 'A handwritten\nnote';
		input.dispatchEvent(new Event('input'));
		expect(captions).toEqual(['', 'A handwritten\nnote']);
		expect(lineCount.textContent).toBe('(2/3)');
		input.value = 'one\ntwo\nthree\nfour';
		input.dispatchEvent(new Event('input'));
		expect(lineCount.textContent).toBe('(4/3)');
		expect(lineCount.classList.contains('is-overflow')).toBeTrue();
		input.dispatchEvent(new Event('blur'));
		expect(lineCount.hidden).toBeTrue();
		editor.destroy();
		editor.focus();
	});
});
