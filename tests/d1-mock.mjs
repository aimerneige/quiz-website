// 用 Node 内置 SQLite 模拟 Cloudflare D1 的常用接口，仅供测试。
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
  async all() {
    return {results: this.db.prepare(this.sql).all(...this.params)};
  }
  async run() {
    this.db.prepare(this.sql).run(...this.params);
    return {success: true};
  }
}

export function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare: sql => new Statement(db, sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(s => db.prepare(s.sql).run(...s.params));
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
