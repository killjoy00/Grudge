import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { historyImportPruneStatements } from '../lib/history-import.ts';

test('history refresh replaces manager-season attribution without deleting durable manager identities', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table managers (
        manager_key text primary key,
        display_name text not null
      );
      create table manager_espn_members (
        manager_key text not null references managers(manager_key),
        swid text not null,
        start_season int not null,
        primary key(manager_key, swid, start_season)
      );
      create table manager_franchise_seasons (
        season int not null,
        manager_key text not null references managers(manager_key),
        franchise_key text not null,
        is_primary boolean not null default true,
        primary key(season, manager_key, franchise_key)
      );
      insert into managers(manager_key, display_name) values ('ryan-mindell', 'Ryan Mindell');
      insert into manager_espn_members(manager_key, swid, start_season)
        values ('ryan-mindell', 'provider-member', 2026);
      insert into manager_franchise_seasons(season, manager_key, franchise_key, is_primary)
        values (2025, 'ryan-mindell', 'bubbs', true);
    `);

    for (const statement of historyImportPruneStatements(true, true)) {
      await db.query(statement.text, statement.params);
    }

    assert.equal((await db.query('select * from manager_franchise_seasons')).rows.length, 0);
    assert.equal((await db.query('select * from managers')).rows.length, 1);
    assert.equal((await db.query('select * from manager_espn_members')).rows.length, 1);
  } finally {
    await db.close();
  }
});
