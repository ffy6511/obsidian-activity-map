export interface PosterCaptionEditorHandle {
	/** Restores keyboard focus to the inline editor when the modal opens. */
	focus(): void;
	/** Releases layout observation before the Modal removes its preview DOM. */
	destroy(): void;
}

/**
 * Renders the single visible caption layer in the preview. The SVG preview
 * intentionally omits its caption while this editor is present; otherwise the
 * same text would be painted once by the input and once by the SVG beneath it.
 */
export function renderPosterCaptionEditor(args: {
	container: HTMLElement;
	value: string;
	onCaption(value: string): void;
}): PosterCaptionEditorHandle {
	const input = args.container.createEl('textarea', {
		cls: 'activity-map-poster-caption-editor',
		attr: {
			rows: '1',
			wrap: 'soft',
			maxlength: '280',
			placeholder: 'Share your focus experience',
			spellcheck: 'false',
			autocomplete: 'off',
			'aria-label': 'Optional poster caption',
			'data-activity-map-id': 'poster-caption',
		},
	});
	const lineCount = args.container.createSpan({
		cls: 'activity-map-poster-caption-line-count',
		text: '(1/3)',
		attr: { 'aria-hidden': 'true' },
	});
	lineCount.hidden = true;
	input.value = args.value;
	resizeCaptionEditor(input);
	updateLineCount(input, lineCount);
	input.addEventListener('input', () => {
		resizeCaptionEditor(input);
		updateLineCount(input, lineCount);
		positionLineCount(input, lineCount);
		args.onCaption(input.value);
	});
	input.addEventListener('focus', () => {
		updateLineCount(input, lineCount);
		lineCount.hidden = false;
		positionLineCount(input, lineCount);
	});
	input.addEventListener('blur', () => {
		lineCount.hidden = true;
	});
	const window = input.ownerDocument.defaultView;
	const resizeObserver =
		window && typeof window.ResizeObserver === 'function'
			? new window.ResizeObserver(() =>
					positionLineCount(input, lineCount),
				)
			: null;
	resizeObserver?.observe(input);
	return {
		focus: () => input.focus(),
		destroy: () => resizeObserver?.disconnect(),
	};
}

function resizeCaptionEditor(input: HTMLTextAreaElement): void {
	const window = input.ownerDocument.defaultView;
	if (!window || typeof window.getComputedStyle !== 'function') return;
	const styles = window.getComputedStyle(input);
	if (!styles) return;
	const lineHeight = Number.parseFloat(styles.lineHeight);
	if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
	input.setCssProps({ '--activity-map-poster-caption-height': 'auto' });
	const maximumHeight =
		lineHeight * 3 +
		Number.parseFloat(styles.paddingTop) +
		Number.parseFloat(styles.paddingBottom);
	const naturalHeight = input.scrollHeight;
	if (naturalHeight <= 0) return;
	input.setCssProps({
		'--activity-map-poster-caption-height': `${Math.min(naturalHeight, maximumHeight)}px`,
		'--activity-map-poster-caption-overflow':
			naturalHeight > maximumHeight ? 'auto' : 'hidden',
	});
}

function updateLineCount(
	input: HTMLTextAreaElement,
	lineCount: HTMLElement,
): void {
	const lines = renderedLineCount(input);
	lineCount.textContent = `(${String(lines)}/3)`;
	lineCount.toggleClass('is-overflow', lines > 3);
}

function renderedLineCount(input: HTMLTextAreaElement): number {
	if (input.value.trim().length === 0) return 0;
	const window = input.ownerDocument.defaultView;
	const styles =
		window && typeof window.getComputedStyle === 'function'
			? window.getComputedStyle(input)
			: null;
	const lineHeight = Number.parseFloat(styles?.lineHeight ?? '');
	const padding =
		Number.parseFloat(styles?.paddingTop ?? '') +
		Number.parseFloat(styles?.paddingBottom ?? '');
	if (
		Number.isFinite(lineHeight) &&
		lineHeight > 0 &&
		input.scrollHeight > 0
	) {
		return Math.max(
			1,
			Math.ceil(
				(input.scrollHeight -
					(Number.isFinite(padding) ? padding : 0)) /
					lineHeight,
			),
		);
	}
	// Test DOMs and hidden elements have no layout metrics. Explicit newlines are
	// still a correct lower bound until Chromium can report wrapped line boxes.
	return Math.max(1, input.value.split('\n').length);
}

function positionLineCount(
	input: HTMLTextAreaElement,
	lineCount: HTMLElement,
): void {
	const frame = input.parentElement;
	if (!frame) return;
	const inputRect = input.getBoundingClientRect();
	const frameRect = frame.getBoundingClientRect();
	lineCount.style.setProperty(
		'--activity-map-poster-caption-line-count-left',
		`${String(inputRect.right - frameRect.left + 8)}px`,
	);
	lineCount.style.setProperty(
		'--activity-map-poster-caption-line-count-top',
		`${String(inputRect.bottom - frameRect.top)}px`,
	);
}
