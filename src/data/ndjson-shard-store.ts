/**
 * NDJSON shard store.
 *
 * Completed events persist as per-device, per-local-date NDJSON shards. Appends
 * are serialized per normalized shard path so two writers cannot interleave a
 * line. Each line is validated and serialized before append; `recordId` is the
 * idempotency key (readers ignore duplicate IDs within a shard and emit a
 * diagnostic). Reads isolate malformed or schema-invalid lines and continue
 * with the valid records, surfacing the affected shard.
 *
 * Normal append never rewrites a raw shard: it validates the existing shard,
 * appends complete lines through the adapter's append primitive, then verifies
 * them by read-back. Scoped deletion is the only maintenance transaction that
 * rewrites a shard.
 */

import { SchemaError, validateEventEnvelope, type ValidatedEventEnvelope } from './schema';
import type { JsonFileAdapter } from './safe-json-store';
import { serializeEnvelopeLine } from './event-envelope';

/** A diagnostic emitted when a shard read encounters problems. */
export interface ShardReadDiagnostic {
	code: 'malformed-line' | 'duplicate-record' | 'invalid-envelope';
	lineNumber: number;
	message: string;
}

/** Result of reading a shard: valid records plus per-line diagnostics. */
export interface ShardReadResult {
	records: ValidatedEventEnvelope[];
	diagnostics: ShardReadDiagnostic[];
}

/** Idempotency-tracking append result. */
export interface AppendResult {
	appended: number;
	/** Diagnostics about duplicates skipped during this append (already-present recordIds). */
	duplicatesSkipped: number;
}

/**
 * Append-oriented, serialized NDJSON store for one shard path family. The store
 * holds no per-path queues itself; callers serialize by always going through
 * {@link append}, which is serialized internally per shard path.
 */
export class NdjsonShardStore {
	private readonly queues = new Map<string, Promise<unknown>>();

	constructor(private readonly adapter: JsonFileAdapter) {}

	/**
	 * Append records to a shard. An unreadable or corrupt existing shard aborts
	 * before mutation; recordId deduplication makes uncertain append retries safe.
	 */
	async append(path: string, records: readonly ValidatedEventEnvelope[]): Promise<AppendResult> {
		const queue = this.queues.get(path) ?? Promise.resolve();
		const run = queue.then(() => this.appendSerialized(path, records));
		this.queues.set(
			path,
			run.catch(() => undefined),
		);
		return run;
	}

	/** Read a shard, isolating malformed/duplicate/invalid lines. */
	async read(path: string): Promise<ShardReadResult> {
		const records: ValidatedEventEnvelope[] = [];
		const diagnostics: ShardReadDiagnostic[] = [];
		const seenIds = new Set<string>();
		let text: string;
		try {
			if (!(await this.adapter.exists(path))) {
				return { records, diagnostics };
			}
			text = await this.adapter.read(path);
		} catch {
			// An unreadable shard is reported as a single diagnostic and yields
			// no records, so unrelated shards still load.
			diagnostics.push({
				code: 'malformed-line',
				lineNumber: 0,
				message: 'shard-unreadable',
			});
			return { records, diagnostics };
		}
		const lines = text.split('\n');
		for (let i = 0; i < lines.length; i += 1) {
			const line = lines[i];
			const lineNumber = i + 1;
			if (line === undefined || line.length === 0) {
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				diagnostics.push({
					code: 'malformed-line',
					lineNumber,
					message: 'json-parse-failed',
				});
				continue;
			}
			let envelope: ValidatedEventEnvelope;
			try {
				envelope = validateEventEnvelope(parsed);
			} catch (error) {
				diagnostics.push({
					code: 'invalid-envelope',
					lineNumber,
					message: error instanceof SchemaError ? error.message : 'invalid-envelope',
				});
				continue;
			}
			if (seenIds.has(envelope.recordId)) {
				diagnostics.push({
					code: 'duplicate-record',
					lineNumber,
					message: `duplicate-recordId-${envelope.recordId}`,
				});
				continue;
			}
			seenIds.add(envelope.recordId);
			records.push(envelope);
		}
		return { records, diagnostics };
	}

	/** Rewrite a shard with a filtered record set (used by scoped deletion). */
	async rewrite(
		path: string,
		keepPredicate: (record: ValidatedEventEnvelope) => boolean,
	): Promise<{ before: number; after: number }> {
		const queue = this.queues.get(path) ?? Promise.resolve();
		const run = queue.then(async () => {
			const { records, diagnostics } = await this.read(path);
			// A scoped rewrite cannot prove whether an invalid line belongs to the
			// target file. Abort so maintenance never silently erases evidence.
			if (diagnostics.length > 0) {
				throw new Error('ndjson-rewrite-source-corrupt');
			}
			const kept = records.filter(keepPredicate);
			const contents = kept.map((r) => serializeEnvelopeLine(r).trimEnd()).join('\n');
			await this.adapter.write(path, contents.length > 0 ? `${contents}\n` : '');
			// Verify the rewrite by reading back.
			const verification = await this.read(path);
			if (
				verification.diagnostics.length > 0 ||
				verification.records.map((record) => record.recordId).join('|') !==
					kept.map((record) => record.recordId).join('|')
			) {
				throw new Error('ndjson-rewrite-verify-failed');
			}
			return { before: records.length, after: kept.length };
		});
		this.queues.set(
			path,
			run.catch(() => undefined),
		);
		return run;
	}

	/** Remove a shard file entirely (used by date/all deletion + retention). */
	async remove(path: string): Promise<void> {
		const queue = this.queues.get(path) ?? Promise.resolve();
		const run = queue.then(async () => {
			if (await this.adapter.exists(path)) {
				await this.adapter.remove(path);
			}
		});
		this.queues.set(
			path,
			run.catch(() => undefined),
		);
		return run;
	}

	private async appendSerialized(
		path: string,
		records: readonly ValidatedEventEnvelope[],
	): Promise<AppendResult> {
		// Read existing recordIds for idempotency.
		const existing = await this.read(path);
		if (existing.diagnostics.length > 0) {
			throw new Error('ndjson-append-source-unreadable-or-corrupt');
		}
		const presentIds = new Set(existing.records.map((r) => r.recordId));
		const toAppend = records.filter((r) => !presentIds.has(r.recordId));
		const duplicatesSkipped = records.length - toAppend.length;
		if (toAppend.length === 0) {
			return { appended: 0, duplicatesSkipped };
		}
		const newLines = toAppend.map((r) => serializeEnvelopeLine(r).trimEnd()).join('\n');
		// DataAdapter.append preserves authoritative bytes if the operation fails;
		// a retry re-reads recordIds before adding any uncertain record again.
		await this.adapter.append(path, `${newLines}\n`);
		// Verify: re-read and confirm all appended recordIds are present exactly once.
		const verify = await this.read(path);
		for (const r of toAppend) {
			const matches = verify.records.filter((x) => x.recordId === r.recordId);
			if (matches.length !== 1) {
				throw new Error(`ndjson-append-verify-failed-${r.recordId}`);
			}
		}
		return { appended: toAppend.length, duplicatesSkipped };
	}
}
