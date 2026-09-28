import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project } from '../shared/types.js';

/** One process/replica owns the SQLite database and its Railway volume. */
export class Registry {
  private db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, error TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id));
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_operation ON operations(project_id) WHERE status='running';
      CREATE TABLE IF NOT EXISTS revisions(project_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL,
        PRIMARY KEY(project_id,revision), FOREIGN KEY(project_id) REFERENCES projects(id));`);
  }
  list(ownerSubject?: string): Project[] {
    const rows = ownerSubject === undefined
      ? this.db.prepare('SELECT document FROM projects ORDER BY updated_at DESC LIMIT 100').all()
      : this.db.prepare("SELECT document FROM projects WHERE json_extract(document,'$.ownerSubject')=? ORDER BY updated_at DESC LIMIT 100").all(ownerSubject);
    return rows.map(row => JSON.parse(String(row.document)));
  }
  get(id: string): Project | undefined {
    const row = this.db.prepare('SELECT document FROM projects WHERE id=?').get(id);
    return row ? JSON.parse(String(row.document)) : undefined;
  }
  save(project: Project): Project {
    project.updatedAt = new Date().toISOString();
    this.db.prepare('INSERT INTO projects VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, document=excluded.document')
      .run(project.id, project.updatedAt, JSON.stringify(project));
    return project;
  }
  snapshot(project: Project) {
    this.db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?)').run(project.id, project.revision, JSON.stringify(project));
  }
  revision(id: string, revision: number): Project | undefined {
    const row = this.db.prepare('SELECT document FROM revisions WHERE project_id=? AND revision=?').get(id, revision);
    return row ? JSON.parse(String(row.document)) : undefined;
  }
  begin(id: string, kind: string): string {
    const operationId = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (Number(this.db.prepare("SELECT count(*) AS n FROM operations WHERE status='running'").get()?.n) >= 2) throw Object.assign(new Error('Two builds are already running. Please try again shortly.'), { status: 429 });
      if (kind === 'generate') {
        const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
        const total = Number(this.db.prepare("SELECT count(*) AS n FROM operations WHERE kind='generate' AND created_at>?").get(cutoff)?.n);
        const owner = this.get(id)?.ownerSubject;
        const owned = owner ? Number(this.db.prepare("SELECT count(*) AS n FROM operations o JOIN projects p ON o.project_id=p.id WHERE o.kind='generate' AND o.created_at>? AND json_extract(p.document,'$.ownerSubject')=?").get(cutoff, owner)?.n) : 0;
        const userLimit = boundedLimit(process.env.BUILDER_USER_BUILDS_PER_DAY, 20);
        const globalLimit = boundedLimit(process.env.BUILDER_TOTAL_BUILDS_PER_DAY, 200);
        if (total >= globalLimit || owned >= userLimit) throw Object.assign(new Error('The daily build allowance has been reached. Existing apps and transactions remain available; try building again later.'), { status: 429 });
      }
      this.db.prepare('INSERT INTO operations(id,project_id,kind,status,created_at) VALUES(?,?,?,\'running\',?)').run(operationId, id, kind, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (cause) { this.db.exec('ROLLBACK'); throw cause; }
    return operationId;
  }
  finish(id: string, error?: string) {
    this.db.prepare('UPDATE operations SET status=?, finished_at=?, error=? WHERE id=?').run(error ? 'failed' : 'complete', new Date().toISOString(), error || null, id);
  }
  recover() {
    for (const row of this.db.prepare('SELECT project_id,kind FROM operations WHERE status=\'running\'').all()) {
      const project = this.get(String(row.project_id));
      if (!project) continue;
      const pending = project.deployments.filter(d => ['deploying', 'submitted', 'unknown'].includes(d.status));
      const checkingReadiness = ['deploying', 'submitted', 'deployed'].includes(project.status)
        && project.build?.revision === project.revision
        && project.deployments.some(d => d.buildId === project.build!.id && d.status === 'deployed');
      // Generation and compilation can include publishing. The persisted phase
      // and deployment record, rather than the operation's initial kind, decide
      // whether a transaction must be reconciled after a restart.
      const chainOperation = pending.length > 0 || checkingReadiness;
      project.status = chainOperation ? 'submitted' : 'failed';
      project.error = checkingReadiness && !pending.length
        ? 'Service restarted while checking the confirmed contract ledger. Reconcile to check readiness without deploying again.'
        : chainOperation
        ? 'Service restarted during deployment. Reconcile its saved transaction before trying again.'
        : 'Service restarted during this operation. Retry generation or compilation.';
      if (project.generation?.status === 'streaming') {
        project.generation = { ...project.generation, status: 'failed', sequence: project.generation.sequence + 1, updatedAt: new Date().toISOString(), error: project.error };
      }
      for (const deployment of pending) if (deployment.status === 'deploying') deployment.status = 'unknown';
      this.save(project);
    }
    this.db.prepare('UPDATE operations SET status=\'interrupted\', finished_at=? WHERE status=\'running\'').run(new Date().toISOString());
  }
  close() { this.db.close(); }
}

function boundedLimit(value: string | undefined, fallback: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error('Build allowances must be integers between 1 and 10000.');
  return n;
}
