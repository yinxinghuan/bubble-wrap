import { useCallback, useEffect, useRef, useState } from 'react';

const GAMES_API = 'https://games-api.xinghuan-yin.workers.dev';

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}
function fromBase64(str: string): string {
  return decodeURIComponent(escape(atob(str)));
}

export interface LeaderboardEntry {
  telegram_id: string;
  name: string;
  avatar_url: string;
  score: number;
  isMe?: boolean;
}

interface AigramUser {
  telegram_id: string;
  name: string;
  head_url: string;
}

interface AigramResponse<T> {
  retcode: number;
  msg: string;
  data: T;
}

function getAigramContext() {
  const params = new URLSearchParams(window.location.search);
  const telegramId = params.get('telegram_id') ?? null;
  const rawOrigin = params.get('api_origin');
  const apiOrigin = rawOrigin ? decodeURIComponent(rawOrigin) : null;
  return { telegramId, apiOrigin };
}

function callAigramAPI<T>(
  apiOrigin: string,
  url: string,
  method: 'GET' | 'POST' = 'GET',
  data: unknown = null,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout>;
    const targetOrigin = new URL(apiOrigin).origin;

    const handler = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      const msg = typeof event.data === 'string' ? event.data : '';
      if (!msg.startsWith('callAPIResult-')) return;
      try {
        const result = JSON.parse(fromBase64(msg.slice('callAPIResult-'.length)));
        if (result.request_id !== requestId) return;
        window.removeEventListener('message', handler);
        clearTimeout(timer);
        if (result.success) resolve(result.data as T);
        else reject(new Error(result.error ?? 'API error'));
      } catch { /* ignore */ }
    };

    window.addEventListener('message', handler);
    window.parent.postMessage(
      `callAPI-${toBase64(JSON.stringify({
        url,
        method,
        data,
        request_id: requestId,
        emitter: window.location.origin,
      }))}`,
      targetOrigin
    );
    timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('timeout'));
    }, 15_000);
  });
}

export function useGameScore(gameId: string) {
  const { telegramId, apiOrigin } = getAigramContext();
  const isInAigram = !!telegramId && !!apiOrigin;

  const [currentUser, setCurrentUser] = useState<AigramUser | null>(null);
  const currentUserRef = useRef<AigramUser | null>(null);

  useEffect(() => {
    if (!isInAigram || !telegramId || !apiOrigin) return;
    callAigramAPI<AigramResponse<AigramUser>>(
      apiOrigin,
      `/note/telegram/user/get/info/by/telegram_id?telegram_id=${telegramId}`
    )
      .then(res => {
        setCurrentUser(res.data);
        currentUserRef.current = res.data;
      })
      .catch(() => { /* silent */ });
  }, []);

  const submitScore = useCallback(async (score: number) => {
    if (!telegramId || score <= 0) return;
    const user = currentUserRef.current;
    try {
      await fetch(`${GAMES_API}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id: gameId,
          telegram_id: telegramId,
          name: user?.name ?? telegramId,
          avatar_url: user?.head_url ?? '',
          score,
        }),
      });
    } catch { /* silent */ }
  }, [gameId, telegramId]);

  const fetchGlobalLeaderboard = useCallback(async (): Promise<LeaderboardEntry[]> => {
    const res = await fetch(`${GAMES_API}/leaderboard?game_id=${gameId}&limit=50`);
    const json = await res.json() as { leaderboard: LeaderboardEntry[] };
    return json.leaderboard.map(e => ({ ...e, isMe: e.telegram_id === telegramId }));
  }, [gameId, telegramId]);

  const fetchFriendsLeaderboard = useCallback(async (): Promise<LeaderboardEntry[]> => {
    if (!isInAigram || !telegramId || !apiOrigin) return [];

    // Start with current user, add contacts if fetch succeeds
    const friendIds = new Set<string>([telegramId]);
    try {
      const contacts = await callAigramAPI<AigramResponse<AigramUser[]>>(
        apiOrigin,
        `/note/telegram/user/contact/list?telegram_id=${telegramId}`
      );
      // Aigram may return { data: [...] } or a direct array — handle both
      const list: AigramUser[] = Array.isArray(contacts) ? contacts : (contacts?.data ?? []);
      list.forEach(f => { if (f.telegram_id) friendIds.add(String(f.telegram_id)); });
    } catch { /* contacts fetch failed — still query with current user only */ }

    try {
      const ids = [...friendIds].join(',');
      const res = await fetch(
        `${GAMES_API}/leaderboard?game_id=${gameId}&telegram_ids=${encodeURIComponent(ids)}`
      );
      const json = await res.json() as { leaderboard: LeaderboardEntry[] };
      return json.leaderboard.map(e => ({ ...e, isMe: e.telegram_id === telegramId }));
    } catch {
      return [];
    }
  }, [gameId, telegramId, apiOrigin, isInAigram]);

  const postToAigram = useCallback(async (photoUrl: string): Promise<string | null> => {
    if (!isInAigram || !apiOrigin) throw new Error('not in aigram');
    const res = await callAigramAPI<{ data: string }>(
      apiOrigin,
      '/note/telegram/post/app/send/have/users',
      'POST',
      { photo_url: photoUrl, type: 7, telegram_id_list: telegramId ? [telegramId] : [], style: 'No Style' },
    );
    const postId = typeof res === 'string' ? res : (res as { data: string })?.data ?? null;
    if (postId) {
      try {
        window.parent.postMessage(
          `AW.POST.OPEN-${toBase64(JSON.stringify({ post_id: postId }))}`,
          new URL(apiOrigin).origin
        );
      } catch { /* ignore */ }
    }
    return postId;
  }, [isInAigram, apiOrigin]);

  return {
    isInAigram,
    telegramId,
    currentUser,
    submitScore,
    fetchGlobalLeaderboard,
    fetchFriendsLeaderboard,
    postToAigram,
  };
}
