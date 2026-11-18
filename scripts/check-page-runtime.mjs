// Exercise the production Worker without opening ports or making network calls.
// An optional private backup supplies only its already-public news snapshot.
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {emptyPublicState} from '../lib/public-state-view.mjs';

const [snapshotPath, buildPath = 'dist/server', mode = 'fixed', scaleText = '1'] = process.argv.slice(2);
const scale = Number(scaleText);
if (!Number.isInteger(scale) || scale < 1 || scale > 8) throw Error('Fixture scale must be 1–8');
let snapshot = JSON.stringify(emptyPublicState());
if (snapshotPath) {
  const db = new DatabaseSync(snapshotPath, {readOnly: true});
  try {snapshot = db.prepare("SELECT value FROM settings WHERE key='news_publication_v3'").get().value;}
  finally {db.close();}
}
if (scale > 1) {
  const data = JSON.parse(snapshot);
  data.stories = Array.from({length: scale}, () => data.stories).flat();
  snapshot = JSON.stringify(data);
}
const runtimeRoot = path.resolve('.sites-runtime');
await mkdir(runtimeRoot, {recursive: true});
const temporary = await mkdtemp(path.join(runtimeRoot, 'page-runtime-'));
const quote = JSON.stringify;
const relative = file => path.relative(temporary, file).split(path.sep).join('/');
const start = performance.now();
try {
  const root = path.resolve(buildPath);
  const files = (await readdir(root, {recursive: true})).filter(file => /\.m?js$/.test(file));
  await writeFile(path.join(temporary, 'snapshot.json'), snapshot, {mode: 0o600});
  await writeFile(path.join(temporary, 'test.mjs'), `
    import app from './app/index.js';
    import {withEnv} from 'cloudflare:workers';
    import raw from './snapshot.json';
    const assert = (ok, message) => {if (!ok) throw Error(message);};
    export default {async test(ctrl, env, ctx) {
      let reads = 0, writes = 0;
      const DB = {prepare(sql) {
        assert(sql === 'SELECT value FROM settings WHERE key=?', 'Unexpected database query: ' + sql);
        return {bind(key) {assert(key === 'news_publication_v3', 'Unexpected setting'); return {
          async first() {reads++; return {value: raw};},
          async run() {writes++; throw Error('Writes are forbidden');},
        };}};
      }};
      const request = async (url, db = DB) => withEnv({DB: db}, async () => {
        const response = await app.fetch(new Request('https://isolated.example' + url), {DB: db}, ctx);
        return {status: response.status, text: await response.text()};
      });
      const home = await request('/');
      assert(home.status === 200, 'Homepage failed');
      assert(home.text.includes('DayDay AI'), 'Brand missing');
      const homeReads = reads;
      if (${quote(mode)} === 'fixed') {
        assert(homeReads === 0, 'Homepage must not read or serialize the publication');
        assert(home.text.includes('正在加载内容'), 'Loading state missing');
        assert(home.text.length < 100000, 'Homepage contains excessive data');
        const offline = await request('/', {prepare() {throw Error('Database unavailable');}});
        assert(offline.status === 200, 'Database outage broke page shell');
        const expected = JSON.parse(raw);
        for (const view of ['home', 'daily', 'weekly', 'topics', 'about']) {
          const result = await request('/api/state?view=' + view);
          assert(result.status === 200, 'Scoped API failed: ' + view);
          const data = JSON.parse(result.text), key = view === 'home' ? 'hot' : view === 'topics' ? 'stories' : view;
          if (view !== 'about') assert(JSON.stringify(data[key]) === JSON.stringify(expected[key]), 'Published content changed: ' + view);
          if (view === 'home') assert(data.stories.length === 0 && data.daily.length === 0 && data.weekly.length === 0, 'Home includes archives');
          console.log(JSON.stringify({path: '/api/state?view=' + view, status: result.status, bytes: new TextEncoder().encode(result.text).length}));
        }
        const unavailable = await request('/api/state?view=home', {prepare() {throw Error('Database unavailable');}});
        assert(unavailable.status === 503, 'Database failures must be retryable');
      }
      const full = await request('/api/state');
      assert(full.status === 200 && JSON.stringify(JSON.parse(full.text)) === JSON.stringify(JSON.parse(raw)), 'Full API compatibility failed');
      assert(writes === 0, 'Unexpected write');
      console.log(JSON.stringify({mode: ${quote(mode)}, homeStatus: home.status, homeBytes: new TextEncoder().encode(home.text).length, homeDatabaseReads: homeReads, snapshotBytes: new TextEncoder().encode(raw).length, databaseWrites: writes}));
    }};
  `);
  const modules = [
    '(name = "test.mjs", esModule = embed "test.mjs")',
    '(name = "snapshot.json", text = embed "snapshot.json")',
    ...files.map(file => `(name = ${quote('app/' + file.split(path.sep).join('/'))}, esModule = embed ${quote(relative(path.join(root, file)))})`),
  ];
  const config = `using Workerd = import ${quote(relative(path.resolve('node_modules/workerd/workerd.capnp')))};
    const config :Workerd.Config = (services = [
      (name = "page-test", worker = (compatibilityDate = "2026-05-15", compatibilityFlags = ["nodejs_compat"], globalOutbound = "blocked", modules = [${modules.join(',')}])) ,
      (name = "blocked", worker = (compatibilityDate = "2026-05-15", modules = [(name = "deny.mjs", esModule = "export default {fetch() {throw Error('External requests are forbidden');}};")]))
    ]);`;
  await writeFile(path.join(temporary, 'config.capnp'), config);
  const output = execFileSync(path.resolve('node_modules/.bin/workerd'), ['test', path.join(temporary, 'config.capnp'), 'page-test'], {encoding: 'utf8', timeout: 45_000, maxBuffer: 2_000_000});
  process.stdout.write(output);
  console.log(JSON.stringify({runtime: 'workerd', fixture: scale > 1 ? 'scaled-backup' : snapshotPath ? 'historical-backup' : 'empty', scale, elapsedMs: Math.round(performance.now() - start), sockets: 0, externalRequests: 0}));
} finally {
  await rm(temporary, {recursive: true, force: true});
}
