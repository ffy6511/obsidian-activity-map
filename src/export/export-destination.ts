export interface ExportDestinationResult {
	outcome: 'downloaded' | 'unavailable';
	message: string;
}

/** Standard-Web-API download boundary, capability-gated per owner document. */
export class BrowserExportDestination {
	constructor(private readonly document: Document) {}

	download(contents: string, filename: string, mimeType: string): ExportDestinationResult {
		const win = this.document.defaultView;
		if (!win || typeof win.URL?.createObjectURL !== 'function' || typeof Blob === 'undefined') {
			return { outcome: 'unavailable', message: 'Local download is unavailable on this platform.' };
		}
		const url = win.URL.createObjectURL(new Blob([contents], { type: mimeType }));
		try {
			const anchor = this.document.body.createEl('a');
			anchor.href = url;
			anchor.download = filename;
			anchor.hidden = true;
			anchor.click();
			anchor.remove();
			return { outcome: 'downloaded', message: `Downloaded ${filename}` };
		} finally {
			win.URL.revokeObjectURL(url);
		}
	}
}
