import { parseHTML } from 'linkedom';

interface ElementOptions {
	cls?: string;
	text?: string;
	value?: string;
	type?: string;
	attr?: Record<string, string>;
}

/** Installs a small standards-based DOM plus the Obsidian element helpers used by UI components. */
export function installDomEnvironment(): { document: Document; window: Window } {
	const parsed = parseHTML('<!doctype html><html><body></body></html>');
	const window = parsed.window;
	const document = parsed.document;
	Object.assign(globalThis, {
		window,
		document,
		Node: window.Node,
		HTMLElement: window.HTMLElement,
		HTMLButtonElement: window.HTMLButtonElement,
		Event: window.Event,
		KeyboardEvent: window.KeyboardEvent,
		MouseEvent: window.MouseEvent,
	});
	const html = window.HTMLElement.prototype as HTMLElement & Record<string, unknown>;
	const element = window.Element.prototype as Element & Record<string, unknown>;
	const svg = window.SVGElement.prototype as SVGElement & Record<string, unknown>;
	const selectValues = new WeakMap<object, string>();
	Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
		configurable: true,
		get(this: HTMLSelectElement) {
			return selectValues.get(this) ?? '';
		},
		set(this: HTMLSelectElement, value: string) {
			selectValues.set(this, value);
		},
	});
	const create = function (
		this: Element,
		tag: string,
		options: ElementOptions = {},
	): HTMLElement {
		const child = document.createElement(tag);
		applyOptions(child, options);
		this.appendChild(child);
		return child;
	};
	const createSvg = function (this: Element, tag: string): SVGElement {
		const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
		this.appendChild(child);
		return child;
	};
	Object.assign(html, {
		createEl: create,
		createDiv(this: Element, options?: ElementOptions) {
			return create.call(this, 'div', options);
		},
		createSpan(this: Element, options?: ElementOptions) {
			return create.call(this, 'span', options);
		},
		createSvg,
		empty(this: Element) {
			this.replaceChildren();
		},
		addClass(this: Element, cls: string) {
			this.classList.add(cls);
		},
		removeClass(this: Element, cls: string) {
			this.classList.remove(cls);
		},
		toggleClass(this: Element, cls: string, value: boolean) {
			this.classList.toggle(cls, value);
		},
		setAttr(this: Element, name: string, value: string) {
			this.setAttribute(name, value);
		},
	});
	Object.assign(element, {
		createSvg,
		empty(this: Element) {
			this.replaceChildren();
		},
	});
	Object.assign(svg, { createSvg });
	return { document, window };
}

function applyOptions(element: HTMLElement, options: ElementOptions): void {
	if (options.cls) element.className = options.cls;
	if (options.text !== undefined) element.textContent = options.text;
	if (options.value !== undefined && 'value' in element)
		(element as HTMLInputElement).value = options.value;
	if (options.type !== undefined && 'type' in element)
		(element as HTMLInputElement).type = options.type;
	for (const [name, value] of Object.entries(options.attr ?? {}))
		element.setAttribute(name, value);
}
