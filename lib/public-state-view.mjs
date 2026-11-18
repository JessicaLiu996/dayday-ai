export const publicStateViews = ['home', 'topics', 'daily', 'weekly', 'about'];

/** A constant-sized page shell; published data is loaded after hydration. */
export function emptyPublicState() {
  return {
    stories: [], hot: [], daily: [], weekly: [], sources: [], health: [],
    collectedAt: '', databaseReady: true,
    topics: ['公司动态', '论文与研究', '媒体资讯', 'Newsletter', '开发者平台', '线上发布会', '线下活动', '黑客松', '投融资', '招聘', '政策监管'],
    ranking: {version: 3, windowHours: 24, asOf: ''},
    pipeline: {mode: '等待首批处理完成', processed: 0, lastSuccessAt: null},
    stats: {registered: 0, configured: 0, healthy: 0, healthyEndpoints: 0, articles: 0, stories: 0},
  };
}

/** Keep published order and content intact, sending only the requested section. */
export function publicStateView(state, view) {
  if (!publicStateViews.includes(view)) throw new Error('未知栏目');
  const result = {
    ...emptyPublicState(),
    collectedAt: state.collectedAt, processedAt: state.processedAt,
    databaseReady: state.databaseReady, topics: state.topics,
    ranking: state.ranking, pipeline: state.pipeline,
    stats: {...state.stats, dailyEditions: state.daily.length},
  };
  if (view === 'home') result.hot = state.hot;
  if (view === 'topics') {
    result.stories = state.stories;
    result.sources = state.sources;
    result.health = state.health;
  }
  if (view === 'daily') result.daily = state.daily;
  if (view === 'weekly') result.weekly = state.weekly;
  return result;
}
