import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '../helpers/test-harness';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('activity map entrypoint surface', () => {
	it('uses file-header actions as the only Activity Map entry', async () => {
		const main = await readFile(path.join(ROOT, 'src/main.ts'), 'utf8');
		expect(main.includes('this.addRibbonIcon(')).toBeFalse();
		expect(main.includes('registerActivityMapCommands')).toBeFalse();
		expect(main.includes('this.addCommand(')).toBeFalse();
		expect(main.includes('this.registerView(')).toBeFalse();
		expect(main.includes('new HeaderActionManager(')).toBeTrue();
		expect(main.includes('ACTIVITY_MAP_VIEW_TYPE')).toBeFalse();
		expect(main.includes('getLeavesOfType(')).toBeFalse();
	});
});
