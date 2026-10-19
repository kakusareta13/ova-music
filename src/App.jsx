import { useEffect, useRef, useState } from 'react';

function App() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('Jazz');
  const [currentTrack, setCurrentTrack] = useState(null);
  const [likedTracks, setLikedTracks] = useState([]);
  const [activeTab, setActiveTab] = useState('search');
  const [vibeQueue, setVibeQueue] = useState([]);
  const [vibeLoading, setVibeLoading] = useState(false);
  const [vibeSource, setVibeSource] = useState(null);
  const [isVibeMode, setIsVibeMode] = useState(false);

  const [playlists, setPlaylists] = useState([]);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const [playQueue, setPlayQueue] = useState([]);

  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  const [sortBy, setSortBy] = useState('default');

  const API_KEY = '0x3b96593a7f627422496a07a98beab653009ab680';
  const LASTFM_KEY = 'ec9730a0d69fad69cf0aad8a82ec1e22';

  useEffect(() => {
    const savedLikes = localStorage.getItem('ova_liked_tracks');
    if (savedLikes) setLikedTracks(JSON.parse(savedLikes));
    const savedPlaylists = localStorage.getItem('ova_playlists');
    if (savedPlaylists) setPlaylists(JSON.parse(savedPlaylists));
  }, []);

  useEffect(() => {
    localStorage.setItem('ova_liked_tracks', JSON.stringify(likedTracks));
  }, [likedTracks]);

  useEffect(() => {
    localStorage.setItem('ova_playlists', JSON.stringify(playlists));
  }, [playlists]);

  const searchTracks = async (searchQuery, sortMode = 'default') => {
    if (!window.audiusSdk) return;
    setLoading(true);
    const audiusSdk = window.audiusSdk({ apiKey: API_KEY });
    try {
      const response = await audiusSdk.tracks.searchTracks({ query: searchQuery, limit: 20 });
      let data = response.data || [];
      if (sortMode === 'popular') data = [...data].sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
      setTracks(data);
      return data;
    } catch (error) {
      console.error('Ошибка поиска:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => searchTracks('Jazz', sortBy), 1000);
    return () => clearTimeout(timer);
  }, [sortBy]);

  // === Воспроизведение ===
  const loadTrack = (track, queue = [], vibeMode = false, vibeQueueOverride = null) => {
    if (!track) return;
    const streamUrl = `https://api.audius.co/v1/tracks/${track.id}/stream?app_name=ova-music`;
    setCurrentTrack({ ...track, streamUrl });

    if (vibeMode) {
      // В режиме вайба очередь хранится отдельно
      setVibeQueue(vibeQueueOverride || []);
      setPlayQueue([]);
      setIsVibeMode(true);
    } else {
      setPlayQueue(queue);
      setVibeQueue([]);
      setIsVibeMode(false);
      setVibeSource(null);
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.user.name,
        album: 'ova music',
        artwork: [
          { src: track.artwork?.['150x150'] || 'https://via.placeholder.com/150', sizes: '150x150', type: 'image/jpeg' },
          { src: track.artwork?.['480x480'] || track.artwork?.['150x150'] || 'https://via.placeholder.com/480', sizes: '480x480', type: 'image/jpeg' },
        ],
      });
      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play());
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => handleTrackEnded());
    }

    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.src = streamUrl;
        audioRef.current.volume = volume;
        audioRef.current.play().catch((err) => console.error(err));
      }
    }, 100);
  };

  const playTrack = (track, list = null) => {
    const sourceList = list || tracks;
    const idx = sourceList.findIndex((t) => t.id === track.id);
    const queue = idx >= 0 ? sourceList.slice(idx + 1) : [];
    loadTrack(track, queue, false);
  };

  // === Автопереход с fallback ===
  const handleTrackEnded = () => {
    if (isVibeMode) {
      // Если есть очередь вайба — играем следующий
      if (vibeQueue.length > 0) {
        const next = vibeQueue[0];
        const remaining = vibeQueue.slice(1);
        loadTrack(next, [], true, remaining);
        return;
      }
      // Очередь пуста — строим новую волну от текущего трека
      startVibe(currentTrack);
      return;
    }

    // Обычная очередь
    if (playQueue.length > 0) {
      const next = playQueue[0];
      const remaining = playQueue.slice(1);
      loadTrack(next, remaining, false);
      return;
    }
    // Очередь пуста — ничего (пользователь слушал вручную)
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleSeek = (e) => {
    const time = Number(e.target.value);
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e) => {
    const vol = Number(e.target.value);
    setVolume(vol);
    if (audioRef.current) audioRef.current.volume = vol;
  };

  const formatTime = (sec) => {
    if (isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // === "Мой вайб" — исправленный ===
  const startVibe = async (seedOverride = null) => {
    if (!window.audiusSdk) return;
    setVibeLoading(true);
    setIsVibeMode(true);

    try {
      let seedTracks = [];
      if (seedOverride) {
        seedTracks = [seedOverride];
      } else if (likedTracks.length > 0) {
        const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
        seedTracks = shuffled.slice(0, Math.min(3, shuffled.length));
      } else {
        const pool = tracks.length > 0 ? tracks : await searchTracks('Jazz');
        if (pool.length === 0) { setVibeLoading(false); return; }
        seedTracks = [pool[Math.floor(Math.random() * pool.length)]];
      }

      const allSimilar = [];
      for (const seed of seedTracks) {
        const url = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(seed.user.name)}&track=${encodeURIComponent(seed.title)}&api_key=${LASTFM_KEY}&format=json&limit=15`;
        try {
          const res = await fetch(url);
          const data = await res.json();
          allSimilar.push(...(data?.similartracks?.track || []));
        } catch (e) {}
      }

      const unique = allSimilar.filter((item, idx, self) =>
        idx === self.findIndex(t => t.name === item.name && t.artist.name === item.artist.name)
      );

      const audiusSdk = window.audiusSdk({ apiKey: API_KEY });
      const found = [];
      for (const item of unique) {
        try {
          const searchRes = await audiusSdk.tracks.searchTracks({ query: `${item.name} ${item.artist.name}`, limit: 1 });
          if (searchRes.data?.[0]) found.push(searchRes.data[0]);
        } catch (e) {}
      }

      if (found.length > 0) {
        const shuffledFound = [...found].sort(() => Math.random() - 0.5);
        const firstTrack = shuffledFound[0];
        const restQueue = shuffledFound.slice(1);
        setVibeSource(seedTracks[0]);
        setVibeQueue(restQueue);
        loadTrack(firstTrack, [], true, restQueue);
      } else {
        // Fallback: если похожих не нашли — берём trending или случайный из поиска
        let fallbackTracks = tracks;
        if (fallbackTracks.length === 0) fallbackTracks = await searchTracks('Jazz');
        if (fallbackTracks.length > 0) {
          const randomFallback = fallbackTracks[Math.floor(Math.random() * fallbackTracks.length)];
          setVibeSource(seedTracks[0]);
          setVibeQueue([]);
          loadTrack(randomFallback, [], true, []);
        } else {
          // Совсем ничего — играем seed
          setVibeSource(seedTracks[0]);
          setVibeQueue([]);
          loadTrack(seedTracks[0], [], true, []);
        }
      }
    } catch (error) {
      console.error('Ошибка вайба:', error);
    } finally {
      setVibeLoading(false);
    }
  };

  // "Встряхнуть" — сброс и новая волна от другого seed
  const shakeVibe = () => {
    setVibeQueue([]);
    setVibeSource(null);
    startVibe();
  };

  // === Лайки / плейлисты ===
  const isLiked = (trackId) => likedTracks.some((t) => t.id === trackId);
  const toggleLike = (track, e) => {
    e.stopPropagation();
    if (isLiked(track.id)) setLikedTracks(likedTracks.filter((t) => t.id !== track.id));
    else setLikedTracks([...likedTracks, track]);
  };

  const createPlaylist = () => {
    if (!newPlaylistName.trim()) return;
    const newPl = { id: Date.now().toString(), name: newPlaylistName.trim(), tracks: [] };
    setPlaylists([...playlists, newPl]);
    setNewPlaylistName('');
  };

  const addToPlaylist = (playlistId, track, e) => {
    e.stopPropagation();
    setPlaylists(playlists.map(pl => {
      if (pl.id === playlistId && !pl.tracks.find(t => t.id === track.id)) return { ...pl, tracks: [...pl.tracks, track] };
      return pl;
    }));
  };

  const removeFromPlaylist = (playlistId, trackId, e) => {
    e.stopPropagation();
    setPlaylists(playlists.map(pl => pl.id === playlistId ? { ...pl, tracks: pl.tracks.filter(t => t.id !== trackId) } : pl));
  };

  // === Стили (glass) ===
  const glass = {
    background: 'rgba(31, 26, 46, 0.55)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(187, 134, 252, 0.15)',
  };

  const styles = {
    container: {
      backgroundColor: '#14101f', color: '#eae6f2', minHeight: '100vh',
      padding: '24px 20px 160px', fontFamily: 'system-ui, sans-serif',
      backgroundImage: 'radial-gradient(circle at 50% -20%, rgba(157, 78, 221, 0.45), transparent 60%)',
      backgroundAttachment: 'fixed',
    },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' },
    logo: { fontSize: '2rem', fontWeight: 800, letterSpacing: '-1px' },
    ova: { color: '#bb86fc' }, music: { color: '#eae6f2' },
    form: { ...glass, display: 'flex', gap: '8px', flex: '1 1 300px', maxWidth: '520px', flexWrap: 'wrap', padding: '6px', borderRadius: '999px' },
    input: { flex: 1, padding: '10px 18px', borderRadius: '999px', backgroundColor: 'transparent', border: 'none', color: '#eae6f2', outline: 'none', minWidth: '120px' },
    select: { ...glass, padding: '10px 14px', borderRadius: '999px', color: '#eae6f2', outline: 'none', cursor: 'pointer' },
    button: { padding: '10px 22px', borderRadius: '999px', backgroundColor: '#9d4edd', color: 'white', fontWeight: 600, border: 'none', cursor: 'pointer' },
    vibeButton: {
      ...glass, width: '100%', padding: '24px', borderRadius: '24px',
      color: 'white', fontWeight: 700, fontSize: '1.3rem', cursor: 'pointer', marginBottom: '16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
      transition: 'all 0.25s', position: 'relative', overflow: 'hidden',
    },
    vibeActive: {
      background: 'linear-gradient(135deg, rgba(157, 78, 221, 0.85), rgba(187, 134, 252, 0.7))',
      boxShadow: '0 8px 32px rgba(157, 78, 221, 0.5)',
    },
    shakeBtn: {
      ...glass, padding: '12px 24px', borderRadius: '999px', color: '#bb86fc',
      fontWeight: 600, cursor: 'pointer', marginBottom: '24px', fontSize: '0.9rem',
    },
    tabs: { display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' },
    tab: (active) => ({
      ...glass, padding: '10px 20px', borderRadius: '999px',
      backgroundColor: active ? 'rgba(157, 78, 221, 0.55)' : 'rgba(31, 26, 46, 0.55)',
      color: active ? 'white' : '#a89ec0', fontWeight: 600, fontSize: '0.9rem',
      cursor: 'pointer', transition: 'all 0.2s',
    }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' },
    card: { ...glass, borderRadius: '16px', padding: '12px', cursor: 'pointer', position: 'relative', transition: 'all 0.2s' },
    cover: { width: '100%', aspectRatio: '1/1', borderRadius: '12px', objectFit: 'cover', marginBottom: '8px', backgroundColor: '#2a233d', display: 'block' },
    title: { fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    artist: { color: '#a89ec0', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' },
    muted: { color: '#a89ec0' },
    heartBtn: { position: 'absolute', top: '12px', right: '12px', background: 'rgba(20,16,31,0.7)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    playlistAddBtn: { position: 'absolute', top: '12px', left: '12px', background: 'rgba(20,16,31,0.8)', color: 'white', border: '1px solid rgba(187,134,252,0.4)', borderRadius: '16px', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer' },
    playerBar: {
      ...glass, position: 'fixed', bottom: 0, left: 0, right: 0,
      borderTop: '1px solid rgba(187, 134, 252, 0.2)', padding: '12px 20px',
      zIndex: 100, display: 'flex', flexDirection: 'column', gap: '8px',
    },
    playerRow: { display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' },
    playerInfo: { display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 200px', minWidth: 0 },
    playerControls: { display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 300px', justifyContent: 'flex-end', flexWrap: 'wrap' },
    seekBar: { width: '100%', accentColor: '#bb86fc' },
    volumeBar: { width: '80px', accentColor: '#bb86fc' },
    playBtn: { background: '#9d4edd', border: 'none', borderRadius: '50%', width: '40px', height: '40px', cursor: 'pointer', color: 'white', fontSize: '1.2rem' },
    playlistPanel: { ...glass, borderRadius: '16px', padding: '16px', marginBottom: '12px' },
    vibeBadge: {
      ...glass, display: 'inline-flex', alignItems: 'center', gap: '8px',
      padding: '8px 16px', borderRadius: '999px',
      backgroundColor: 'rgba(157, 78, 221, 0.35)',
      border: '1px solid rgba(187, 134, 252, 0.5)',
      color: '#eae6f2', fontSize: '0.85rem', fontWeight: 600,
      marginBottom: '16px',
    },
  };

  const renderTrackGrid = (list, showLike = true, showPlaylistAdd = false, currentPlId = null) => (
    <div style={styles.grid}>
      {list.map((track) => (
        <div key={track.id} style={styles.card} onClick={() => playTrack(track, list)}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}>
          <img src={track.artwork?.['150x150'] || 'https://via.placeholder.com/150/1f1a2e/bb86fc?text=ova'} alt="" style={styles.cover} />
          {showLike && (
            <button style={styles.heartBtn} onClick={(e) => toggleLike(track, e)}>
              {isLiked(track.id) ? '💜' : '🤍'}
            </button>
          )}
          {showPlaylistAdd && playlists.length > 0 && (
            <select style={styles.playlistAddBtn} onChange={(e) => { if (e.target.value) addToPlaylist(e.target.value, track, e); }} onClick={(e) => e.stopPropagation()} defaultValue="">
              <option value="" disabled>+</option>
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          )}
          <div style={styles.title}>{track.title}</div>
          <div style={styles.artist}>{track.user.name}</div>
          {currentPlId && (
            <button onClick={(e) => removeFromPlaylist(currentPlId, track.id, e)}
              style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'transparent', border: 'none', color: '#a89ec0', cursor: 'pointer', fontSize: '1rem' }}>×</button>
          )}
        </div>
      ))}
    </div>
  );

  const activePlaylist = playlists.find(p => p.id === activePlaylistId);

  return (
    <div style={styles.container}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1);} 50% { opacity: 0.5; transform: scale(1.3);} }`}</style>

      <header style={styles.header}>
        <h1 style={styles.logo}><span style={styles.ova}>ova</span><span style={styles.music}> music</span></h1>
        <form onSubmit={(e) => { e.preventDefault(); setActiveTab('search'); searchTracks(query, sortBy); }} style={styles.form}>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск треков..." style={styles.input} />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={styles.select}>
            <option value="default">По релевантности</option>
            <option value="popular">По популярности</option>
          </select>
          <button type="submit" style={styles.button}>Найти</button>
        </form>
      </header>

      {/* Кнопка "Мой вайб" + "Встряхнуть" */}
      <button
        style={{ ...styles.vibeButton, ...(isVibeMode ? styles.vibeActive : {}) }}
        onClick={() => startVibe()}
        disabled={vibeLoading}
      >
        {vibeLoading ? '⏳ Собираем вайб...' : isVibeMode ? '🌊 Мой вайб играет' : '🌊 Мой вайб'}
      </button>

      {isVibeMode && (
        <>
          <div style={styles.vibeBadge}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#bb86fc', boxShadow: '0 0 12px #bb86fc', animation: 'pulse 1.5s infinite', display: 'inline-block' }} />
            {vibeSource ? `Волна от «${vibeSource.title}»` : 'Мой вайб играет'}
            {vibeQueue.length > 0 && <span style={{ color: '#a89ec0', fontWeight: 400 }}> · в очереди {vibeQueue.length}</span>}
          </div>
          <button style={styles.shakeBtn} onClick={shakeVibe} disabled={vibeLoading}>
            🔄 Встряхнуть волну
          </button>
        </>
      )}

      <div style={styles.tabs}>
        <button style={styles.tab(activeTab === 'search')} onClick={() => setActiveTab('search')}>Поиск</button>
        <button style={styles.tab(activeTab === 'liked')} onClick={() => setActiveTab('liked')}>Понравившиеся ({likedTracks.length})</button>
        <button style={styles.tab(activeTab === 'playlists')} onClick={() => setActiveTab('playlists')}>Плейлисты</button>
      </div>

      {activeTab === 'search' && (
        <>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '16px' }}>Результаты поиска</h2>
          {loading ? <p style={styles.muted}>Загрузка...</p> : renderTrackGrid(tracks, true, true)}
        </>
      )}

      {activeTab === 'liked' && (
        <>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '16px' }}>Понравившиеся</h2>
          {likedTracks.length === 0 ? <p style={styles.muted}>Пока пусто.</p> : renderTrackGrid(likedTracks, false, true)}
        </>
      )}

      {activeTab === 'playlists' && (
        <>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '16px' }}>Мои плейлисты</h2>
          {!activePlaylistId ? (
            <>
              <div style={{ ...styles.playlistPanel, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="text" placeholder="Название плейлиста" value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} style={{ ...styles.input, ...glass, flex: '1 1 200px', padding: '10px 18px' }} />
                <button onClick={createPlaylist} style={styles.button}>Создать</button>
              </div>
              {playlists.length === 0 ? <p style={styles.muted}>Нет плейлистов. Создайте первый!</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {playlists.map(pl => (
                    <div key={pl.id} onClick={() => setActivePlaylistId(pl.id)} style={{ ...styles.playlistPanel, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>{pl.name}</span>
                      <span style={{ color: '#a89ec0', fontSize: '0.85rem' }}>{pl.tracks.length} треков</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button onClick={() => setActivePlaylistId(null)} style={{ ...styles.button, marginBottom: '16px', background: 'rgba(42, 35, 61, 0.8)' }}>← Назад к плейлистам</button>
              <h3 style={{ marginBottom: '16px' }}>{activePlaylist?.name} ({activePlaylist?.tracks.length})</h3>
              {activePlaylist?.tracks.length === 0 ? <p style={styles.muted}>Плейлист пуст.</p> : renderTrackGrid(activePlaylist.tracks, false, false, activePlaylist.id)}
            </>
          )}
        </>
      )}

      {currentTrack && (
        <div style={styles.playerBar}>
          <div style={styles.playerRow}>
            <div style={styles.playerInfo}>
              <img src={currentTrack.artwork?.['150x150'] || null} alt="" style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.title}</div>
                <div style={{ color: '#a89ec0', fontSize: '0.8rem' }}>{currentTrack.user.name}</div>
              </div>
            </div>
            <div style={styles.playerControls}>
              <button onClick={togglePlay} style={styles.playBtn}>{isPlaying ? '⏸' : '▶'}</button>
              <span style={{ fontSize: '0.8rem', color: '#a89ec0' }}>{formatTime(currentTime)} / {formatTime(duration)}</span>
              <input type="range" min="0" max={duration || 0} value={currentTime} onChange={handleSeek} style={styles.seekBar} />
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} style={styles.volumeBar} />
            </div>
          </div>
          <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={handleTrackEnded} style={{ display: 'none' }} />
        </div>
      )}
    </div>
  );
}

export default App;