import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import type { LeaderboardEntry } from './useGameScore';
import './Leaderboard.less';

// ─── Built-in i18n (no dependency on game's i18n) ────────────────────────

const STRINGS = {
  zh: {
    title: '排行榜',
    global: '🌍 全局榜',
    friends: '👥 好友榜',
    me: '我',
    empty: '暂无记录，快来第一个上榜！',
    emptyFriends: '好友还未上榜，快来邀请他们！',
  },
  en: {
    title: 'Leaderboard',
    global: '🌍 Global',
    friends: '👥 Friends',
    me: 'me',
    empty: 'No records yet. Be the first!',
    emptyFriends: 'No friends on the board yet.',
  },
} as const;

function detectLang(): 'zh' | 'en' {
  try {
    const override = localStorage.getItem('game_locale');
    if (override === 'zh' || override === 'en') return override;
  } catch { /* ignore */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

const s = STRINGS[detectLang()];

// ─── Sub-components ───────────────────────────────────────────────────────

function Avatar({ url, name, size = 40 }: { url: string; name: string; size?: number }) {
  return (
    <div className="lb-avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {url
        ? <img src={url} alt={name} draggable={false} />
        : <span>{name.charAt(0).toUpperCase()}</span>
      }
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────

interface Props {
  gameName: string;
  isInAigram: boolean;
  onClose: () => void;
  fetchGlobal: () => Promise<LeaderboardEntry[]>;
  fetchFriends: () => Promise<LeaderboardEntry[]>;
}

type Tab = 'global' | 'friends';

const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

// ─── Component ────────────────────────────────────────────────────────────

function openProfile(telegramId: string) {
  const apiOrigin = new URLSearchParams(window.location.search).get('api_origin');
  if (!apiOrigin) return;
  try {
    const encoded = btoa(JSON.stringify({ id: telegramId }));
    window.parent.postMessage(`AW.PROFILE.OPEN-${encoded}`, apiOrigin);
  } catch { /* ignore */ }
}

export default function Leaderboard({ gameName, isInAigram, onClose, fetchGlobal, fetchFriends }: Props) {
  const [tab, setTab] = useState<Tab>('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (type: Tab) => {
    setLoading(true);
    try {
      const data = type === 'global' ? await fetchGlobal() : await fetchFriends();
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, [fetchGlobal, fetchFriends]);

  useEffect(() => { load(tab); }, [tab]);

  return (
    <div className="lb-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lb-panel">

        {/* Header */}
        <div className="lb-header">
          <div className="lb-header__left">
            <span className="lb-header__icon">🏆</span>
            <div>
              <div className="lb-header__title">{s.title}</div>
              <div className="lb-header__game">{gameName}</div>
            </div>
          </div>
          <button className="lb-close" onPointerDown={onClose}>✕</button>
        </div>

        {/* Tabs */}
        {isInAigram && (
          <div className="lb-tabs">
            <button
              className={`lb-tab ${tab === 'global' ? 'lb-tab--active' : ''}`}
              onPointerDown={() => setTab('global')}
            >
              {s.global}
            </button>
            <button
              className={`lb-tab ${tab === 'friends' ? 'lb-tab--active' : ''}`}
              onPointerDown={() => setTab('friends')}
            >
              {s.friends}
            </button>
          </div>
        )}

        {/* List */}
        <div className="lb-body">
          {loading && (
            <div className="lb-state">
              <span className="lb-spinner" />
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="lb-state">
              <span className="lb-state__icon">🎮</span>
              <span className="lb-state__text">
                {tab === 'friends' ? s.emptyFriends : s.empty}
              </span>
            </div>
          )}

          {!loading && entries.map((entry, i) => (
            <div
              key={entry.telegram_id}
              className={`lb-row ${entry.isMe ? 'lb-row--me' : ''} ${i < 3 ? 'lb-row--top' : ''} ${isInAigram ? 'lb-row--clickable' : ''}`}
              style={i < 3 ? { '--medal-color': MEDAL_COLORS[i] } as CSSProperties : undefined}
              onClick={isInAigram ? () => openProfile(entry.telegram_id) : undefined}
            >
              <div className="lb-row__rank">
                {i < 3
                  ? <span className="lb-row__medal">{MEDALS[i]}</span>
                  : <span className="lb-row__num">{i + 1}</span>
                }
              </div>

              <Avatar url={entry.avatar_url} name={entry.name} size={i < 3 ? 44 : 38} />

              <div className="lb-row__info">
                <span className="lb-row__name">{entry.name}</span>
                {entry.isMe && <span className="lb-row__me">{s.me}</span>}
              </div>

              <span className="lb-row__score">{entry.score.toLocaleString()}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
