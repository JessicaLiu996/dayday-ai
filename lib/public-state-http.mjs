import {publicStateView, publicStateViews} from './public-state-view.mjs';

export async function publicStateResponse(request, readState) {
  const view = new URL(request.url).searchParams.get('view');
  const unavailable = () => Response.json({error: '内容暂时无法加载，请稍后重试'}, {
    status: 503, headers: {'Cache-Control': 'no-store'},
  });
  if (view !== null && !publicStateViews.includes(view)) {
    return Response.json({error: '未知栏目'}, {status: 400, headers: {'Cache-Control': 'no-store'}});
  }
  try {
    const state = await readState();
    if (!state.databaseReady) return unavailable();
    // Preserve the existing full-state API for consumers that omit `view`.
    return Response.json(view === null ? state : publicStateView(state, view), {
      headers: {'Cache-Control': 'public, max-age=60, stale-while-revalidate=120'},
    });
  } catch {
    return unavailable();
  }
}
