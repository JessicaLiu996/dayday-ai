'use client';
import {useEffect, useRef, useState} from 'react';
import type {NewsState} from '../lib/news-store';
import {emptyPublicState} from '../lib/public-state-view.mjs';

export type StateView = 'home' | 'topics' | 'daily' | 'weekly' | 'about';
type Result = {view: StateView | null; data?: NewsState; error?: string; loading: boolean};
const empty: NewsState = emptyPublicState();

export function usePublicState(view: StateView | null) {
  const cache = useRef(new Map<StateView, NewsState>());
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Result>({view: null, loading: false});

  useEffect(() => {
    if (!view) return;
    const cached = cache.current.get(view);
    if (cached) {
      setResult({view, data: cached, loading: false});
      return;
    }
    const controller = new AbortController();
    let active = true, timedOut = false;
    const timeout = setTimeout(() => {timedOut = true; controller.abort();}, 20_000);
    setResult(previous => ({view, data: previous.view === view ? previous.data : undefined, loading: true}));
    async function load() {
      try {
        const response = await fetch(`/api/state?view=${view}`, {signal: controller.signal, cache: 'no-store'});
        if (!response.ok) throw new Error('内容暂时无法加载，请重试');
        const data: NewsState = await response.json();
        if (!data.databaseReady) throw new Error('内容暂时无法加载，请重试');
        if (!active) return;
        cache.current.set(view!, data);
        setResult({view, data, loading: false});
      } catch {
        if (!active) return;
        setResult(previous => ({view, data: previous.view === view ? previous.data : undefined,
          error: timedOut ? '加载超时，请重试' : '内容暂时无法加载，请重试', loading: false}));
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    // A response for a previous tab must not replace the current tab's data.
    return () => {active = false; clearTimeout(timeout); controller.abort();};
  }, [view, revision]);

  const current = result.view === view ? result : undefined;
  return {
    data: current?.data ?? empty,
    ready: view === null || !!current?.data,
    error: current?.error,
    refreshing: !!view && (current?.loading ?? true),
    refresh() {
      if (!view) return;
      cache.current.delete(view);
      setRevision(value => value + 1);
    },
  };
}
