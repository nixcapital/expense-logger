// Test helpers: node:sqlite as a Cloudflare D1 stand-in. Fake data only.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

var here = path.dirname(fileURLToPath(import.meta.url));

export function makeDb() {
  var db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8'));
  return {
    raw: db,
    batch: async function (stmts) {
      db.exec('BEGIN');
      try {
        for (var i = 0; i < stmts.length; i++) stmts[i]._exec();
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
    prepare: function (sql) {
      function bound(args) {
        var st = db.prepare(sql);
        return {
          _exec: function () { return st.run.apply(st, args); },
          first: async function () { var r = st.get.apply(st, args); return r === undefined ? null : r; },
          run: async function () { st.run.apply(st, args); return {}; },
          all: async function () { return { results: st.all.apply(st, args) }; }
        };
      }
      var s0 = bound([]);
      s0.bind = function () { return bound(Array.prototype.slice.call(arguments)); };
      return s0;
    }
  };
}
