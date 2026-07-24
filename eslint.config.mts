import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'.lintstagedrc.mjs',
		'prettier.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// tests/ is a Node-only development harness, not plugin runtime code.
		// The obsidianmd rules guard the shipped bundle (no Node APIs, no
		// console) and the DOM-unsanitized-input rule; none apply to a test
		// runner that imports trusted local fixtures. Placed AFTER the
		// obsidianmd recommended config so these overrides take precedence.
		files: ['tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/rule-custom-message': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/prefer-create-el': 'off',
			'no-console': 'off',
			'no-unsanitized/method': 'off',
		},
	},
);
