import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublicState, publicStateView} from '../lib/public-state-view.mjs';
import {publicStateResponse} from '../lib/public-state-http.mjs';

const story = {id: 'hot', title: '已发布热点', summary: '完整摘要', links: [{url: 'https://example.com/original'}], trend: [{at: '2026-11-18T12:00Z', heat: 2}]};
const state = {...emptyPublicState(),
  hot: [story], stories: [story, {...story, id: 'history', title: '历史事件'}],
  daily: [{date: '2026-11-17', articles: [story]}], weekly: [{date: '2026-11-09', articles: [story]}],
  sources: [{id: 'source'}], health: [{id: 'source', ok: true}],
  processedAt: '2026-11-18T12:00Z', collectedAt: '2026-11-18T11:00Z',
};

test('home keeps all hot details and ranking without embedding unrelated archives', () => {
  const before = JSON.stringify(state), home = publicStateView(state, 'home');
  assert.deepEqual(home.hot, state.hot);
  assert.deepEqual(home.ranking, state.ranking);
  for (const key of ['stories', 'daily', 'weekly', 'sources', 'health']) assert.deepEqual(home[key], []);
  const grown = {...state, stories: Array(1800).fill(story), daily: Array(90).fill(state.daily[0]), weekly: Array(52).fill(state.weekly[0])};
  assert.ok(JSON.stringify(publicStateView(grown, 'home')).length - JSON.stringify(home).length < 10);
  assert.equal(JSON.stringify(state), before);
});

test('each archive view preserves every item, link and stored order', () => {
  for (const view of ['daily', 'weekly']) {
    const selected = publicStateView(state, view);
    assert.deepEqual(selected[view], state[view]);
    assert.deepEqual(selected.stories, []);
    assert.deepEqual(selected.hot, []);
  }
  const topics = publicStateView(state, 'topics');
  assert.deepEqual(topics.stories, state.stories);
  assert.deepEqual(topics.sources, state.sources);
  assert.deepEqual(topics.health, state.health);
  assert.deepEqual(topics.daily, []);
  assert.equal(publicStateView(state, 'about').stats.dailyEditions, state.daily.length);
});

test('full API stays compatible; scoped reads only return the requested content', async () => {
  const full = await publicStateResponse(new Request('https://site/api/state'), async () => state);
  assert.equal(full.status, 200);
  assert.deepEqual(await full.json(), state);
  const home = await publicStateResponse(new Request('https://site/api/state?view=home'), async () => state);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('cache-control'), /max-age=60/);
  assert.deepEqual(await home.json(), publicStateView(state, 'home'));
});

test('invalid views do not read the database; failures are retryable and never cached', async () => {
  let reads = 0;
  const invalid = await publicStateResponse(new Request('https://site/api/state?view=invalid'), async () => {reads++; return state;});
  assert.equal(invalid.status, 400); assert.equal(reads, 0);
  for (const read of [async () => ({...state, databaseReady: false}), async () => {throw Error('private database details');}]) {
    const response = await publicStateResponse(new Request('https://site/api/state?view=home'), read);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await response.text(), /private database details/);
  }
});
