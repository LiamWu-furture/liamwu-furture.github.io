/* 网易云音乐仿站 — 共享播放引擎
 * 跨页面续播：歌曲、进度、音量、静音、播放模式、喜欢状态全部经 localStorage 持久化。
 * 暴露全局 window.NeteasePlayer，页面脚本通过它驱动 UI 并订阅变化。
 */
(function () {
    'use strict';

    // ===== 核心歌单（5 首真实音源，全站唯一数据源） =====
    const CORE_PLAYLIST = [
        {
            name: "你曾是少年", artist: "焦迈奇", album: "你曾是少年",
            src: "audio/你曾是少年.mp3",
            cover: "images/songs/shaonian.jpg",
            duration: "04:23",
            bg: "linear-gradient(135deg, #3a7bd5, #3a6073)",
            lyrics: ["许多年前", "你曾是个朴素的少年", "爱上一个人", "就不怕付出自己一生", "相信爱会永恒"]
        },
        {
            name: "没有什么不同", artist: "曲婉婷", album: "Say The Words",
            src: "audio/没有什么不同.mp3",
            cover: "images/songs/butong.jpg",
            duration: "04:51",
            bg: "linear-gradient(135deg, #ff5e62, #ff9966)",
            lyrics: ["如果有一天", "我变得更复杂", "请记得曾经那个", "简单的我", "没有什么不同"]
        },
        {
            name: "修炼爱情", artist: "林俊杰", album: "因你而在",
            src: "audio/修炼爱情.m4a",
            cover: "images/songs/xiulian.jpg",
            duration: "05:24",
            bg: "linear-gradient(135deg, #701ebd, #3f51b5)",
            lyrics: ["修炼爱情的心酸", "我们这些努力不简单", "快乐炼成泪水", "是一种勇敢", "回忆烧成灰还是等结尾"]
        },
        {
            name: "时光隧道", artist: "陈奕迅", album: "米·闪",
            src: "audio/时光隧道.m4a",
            cover: "images/songs/suidao.jpg",
            duration: "04:14",
            bg: "linear-gradient(135deg, #11998e, #38ef7d)",
            lyrics: ["穿过时光隧道", "回到那一年", "我们都还年少", "笑得很甜", "不知道什么是离别"]
        },
        {
            name: "隐隐作痛", artist: "动力火车", album: "都是因为爱",
            src: "audio/隐隐作痛.m4a",
            cover: "images/songs/yintong.jpg",
            duration: "04:47",
            bg: "linear-gradient(135deg, #de6262, #ffb88c)",
            lyrics: ["心还在隐隐作痛", "那些回忆挥之不去", "你的笑容", "成了最深的伤口", "却舍不得放手"]
        }
    ];

    const SONG_NAME_ALIASES = {
        "有什么不同": "没有什么不同",
        "时空隧道": "时光隧道"
    };

    function coverStyle(song) {
        return song && song.cover
            ? `url('${song.cover}') center/cover no-repeat`
            : (song ? song.bg : '');
    }

    // 播放模式
    const MODE = { ORDER: 0, SHUFFLE: 1, REPEAT_ONE: 2 };
    const STORAGE_KEY = 'nem_player';

    // ===== 状态：读取持久化，给默认值 =====
    function loadState() {
        let s = {};
        try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { s = {}; }
        return {
            index: Number.isInteger(s.index) ? s.index : 0,
            position: typeof s.position === 'number' ? s.position : 0,
            playing: !!s.playing,
            volume: typeof s.volume === 'number' ? s.volume : 0.7,
            muted: !!s.muted,
            mode: [0, 1, 2].includes(s.mode) ? s.mode : MODE.ORDER,
            liked: (s.liked && typeof s.liked === 'object') ? s.liked : {}
        };
    }

    const state = loadState();

    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) { /* 隐私模式或 file:// 限制，忽略 */ }
    }

    // ===== 单例 audio =====
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = state.muted ? 0 : state.volume;
    audio.muted = state.muted;

    // 订阅者（页面 UI 通过 onChange 注册回调）
    const subscribers = [];
    const progressSubscribers = [];
    function notify() {
        const snapshot = getSnapshot();
        subscribers.forEach(cb => { try { cb(snapshot); } catch (e) {} });
    }
    function notifyProgress() {
        const cur = audio.currentTime;
        const dur = audio.duration || 0;
        progressSubscribers.forEach(cb => { try { cb(cur, dur); } catch (e) {} });
    }
    function getSnapshot() {
        return {
            index: state.index,
            song: CORE_PLAYLIST[state.index],
            playing: !audio.paused && !audio.ended,
            mode: state.mode,
            muted: state.muted,
            volume: state.volume,
            liked: isLiked(CORE_PLAYLIST[state.index])
        };
    }

    function isLiked(song) {
        return !!(song && state.liked[song.name]);
    }

    // ===== 核心播放逻辑 =====
    let pendingResume = false; // 自动播放被拦截，等首次交互

    function loadSong(index, autoplay) {
        state.index = ((index % CORE_PLAYLIST.length) + CORE_PLAYLIST.length) % CORE_PLAYLIST.length;
        const song = CORE_PLAYLIST[state.index];
        if (audio.src !== new URL(song.src, location.href).href) {
            audio.src = song.src;
        }
        if (autoplay) {
            const p = audio.play();
            if (p && p.catch) {
                p.then(() => { state.playing = true; saveState(); })
                 .catch(() => { state.playing = false; armResumeOnInteract(); saveState(); });
            }
        }
        saveState();
        notify();
    }

    function playByIndex(index) {
        loadSong(index, true);
    }

    function toggle() {
        if (audio.paused) {
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
        } else {
            audio.pause();
        }
    }

    function next(userInitiated) {
        if (state.mode === MODE.SHUFFLE) {
            let n = state.index;
            if (CORE_PLAYLIST.length > 1) {
                while (n === state.index) n = Math.floor(Math.random() * CORE_PLAYLIST.length);
            }
            loadSong(n, true);
        } else {
            loadSong(state.index + 1, true);
        }
    }

    function prev() {
        if (state.mode === MODE.SHUFFLE) { next(); return; }
        loadSong(state.index - 1, true);
    }

    function seek(pct) {
        if (audio.duration) audio.currentTime = Math.min(Math.max(pct, 0), 1) * audio.duration;
    }

    function setVolume(v) {
        v = Math.min(Math.max(v, 0), 1);
        state.volume = v;
        state.muted = v === 0;
        audio.muted = state.muted;
        audio.volume = v;
        saveState();
        notify();
    }

    function toggleMute() {
        state.muted = !state.muted;
        audio.muted = state.muted;
        audio.volume = state.muted ? 0 : state.volume;
        saveState();
        notify();
    }

    function cycleMode() {
        state.mode = (state.mode + 1) % 3;
        audio.loop = false; // 由 ended 手动处理，避免 loop 与 ended 冲突
        saveState();
        notify();
    }

    function toggleLike() {
        const song = CORE_PLAYLIST[state.index];
        if (!song) return;
        if (state.liked[song.name]) delete state.liked[song.name];
        else state.liked[song.name] = true;
        saveState();
        notify();
    }

    // 自动播放被浏览器拦截时，挂到首次用户交互恢复
    function armResumeOnInteract() {
        if (pendingResume) return;
        pendingResume = true;
        const resume = () => {
            pendingResume = false;
            document.removeEventListener('click', resume);
            document.removeEventListener('keydown', resume);
            if (state.playing) { const p = audio.play(); if (p && p.catch) p.catch(() => {}); }
        };
        document.addEventListener('click', resume);
        document.addEventListener('keydown', resume);
    }

    // ===== audio 事件 =====
    let lastSaved = 0;
    audio.addEventListener('timeupdate', () => {
        state.position = audio.currentTime;
        notifyProgress();
        // 节流：约每秒持久化一次进度
        const now = Date.now();
        if (now - lastSaved > 1000) { lastSaved = now; saveState(); }
    });

    audio.addEventListener('play', () => { state.playing = true; saveState(); notify(); });
    audio.addEventListener('pause', () => { state.playing = false; saveState(); notify(); });

    audio.addEventListener('ended', () => {
        if (state.mode === MODE.REPEAT_ONE) {
            audio.currentTime = 0;
            const p = audio.play(); if (p && p.catch) p.catch(() => {});
        } else {
            next();
        }
    });

    // 页面隐藏/卸载时落盘，保证跨页续播精确
    function persistNow() { state.position = audio.currentTime; saveState(); }
    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });

    // ===== 初始恢复（页面加载即执行） =====
    (function restore() {
        const song = CORE_PLAYLIST[state.index];
        audio.src = song.src;
        audio.muted = state.muted;
        audio.volume = state.muted ? 0 : state.volume;
        audio.addEventListener('loadedmetadata', function once() {
            audio.removeEventListener('loadedmetadata', once);
            if (state.position && isFinite(state.position) && state.position < audio.duration) {
                try { audio.currentTime = state.position; } catch (e) {}
            }
        });
        if (state.playing) {
            const p = audio.play();
            if (p && p.catch) p.catch(() => { armResumeOnInteract(); });
        }
    })();

    // ===== 工具：秒 → mm:ss =====
    function formatTime(sec) {
        if (isNaN(sec) || !isFinite(sec)) return "00:00";
        const m = Math.floor(sec / 60).toString().padStart(2, '0');
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return m + ':' + s;
    }

    // ===== 底栏顶部进度条（网易云风格：灰轨 + 红条 + 白点 + 时间气泡） =====
    function injectPlayerBarStyles() {
        let style = document.getElementById('nem-player-bar-styles');
        if (!style) {
            style = document.createElement('style');
            style.id = 'nem-player-bar-styles';
            document.head.appendChild(style);
        }
        style.textContent = `
            .player-bar { position: fixed; overflow: visible; border-top: none !important; }
            .player-top-progress {
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 14px;
                cursor: pointer;
                z-index: 20;
            }
            .player-top-progress-inner {
                position: absolute;
                top: 0; left: 0; right: 0;
                width: 100%;
                height: 3px;
                background: rgba(0, 0, 0, 0.06);
                transition: height 0.2s ease;
            }
            .player-top-progress:hover .player-top-progress-inner,
            .player-top-progress.is-active .player-top-progress-inner {
                height: 6px;
            }
            .player-top-progress-fill {
                position: absolute;
                left: 0; top: 0; bottom: 0;
                width: 0%;
                background: #ec4141;
                pointer-events: none;
            }
            .player-top-progress-thumb {
                position: absolute;
                top: 50%;
                left: 0%;
                width: 12px;
                height: 12px;
                margin: -6px 0 0 -6px;
                background: #fff;
                border-radius: 50%;
                box-shadow: 0 1px 6px rgba(0, 0, 0, 0.22);
                pointer-events: none;
                opacity: 0;
                transform: scale(0.6);
                transition: opacity 0.15s, transform 0.15s;
            }
            .player-top-progress:hover .player-top-progress-thumb,
            .player-top-progress.is-active .player-top-progress-thumb {
                opacity: 1;
                transform: scale(1);
            }
            .player-progress-fill-tip {
                position: absolute;
                bottom: 16px;
                left: 0;
                transform: translateX(-50%);
                padding: 3px 10px;
                background: rgba(55, 55, 55, 0.92);
                color: #fff;
                font-size: 11px;
                line-height: 1.3;
                border-radius: 12px;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s;
            }
            .player-top-progress:hover .player-progress-fill-tip,
            .player-top-progress.is-active .player-progress-fill-tip {
                opacity: 1;
            }
            .player-time-row { display: none !important; }
        `;
    }

    function setupTopProgressBar() {
        const playerBar = document.querySelector('.player-bar');
        if (!playerBar) return;

        const old = document.getElementById('progressBarContainer');
        if (old) old.remove();

        const track = document.createElement('div');
        track.className = 'player-top-progress';
        track.id = 'progressBarContainer';
        track.innerHTML = `
            <div class="player-top-progress-inner">
                <div class="player-top-progress-fill" id="progressBar"></div>
                <div class="player-top-progress-thumb" id="progressThumb"></div>
            </div>
            <div class="player-progress-fill-tip" id="progressFillTip">00:00 / 00:00</div>
        `;
        playerBar.insertBefore(track, playerBar.firstChild);
    }

    function bindProgressBarInteractions(container, fill, thumb, currentTimeEl, totalTimeEl) {
        if (!container || !fill) return;

        const inner = container.querySelector('.player-top-progress-inner') || container;
        const fillTip = container.querySelector('#progressFillTip');

        function updateFillTip() {
            if (!fillTip || !audio.duration) return;
            const cur = audio.currentTime;
            const dur = audio.duration;
            const pct = Math.min(Math.max(cur / dur, 0), 1) * 100;
            fillTip.style.left = pct + '%';
            fillTip.textContent = formatTime(cur) + ' / ' + formatTime(dur);
        }

        function setProgressUI(ratio, cur, dur) {
            const pct = Math.min(Math.max(ratio, 0), 1) * 100;
            fill.style.width = pct + '%';
            if (thumb) thumb.style.left = pct + '%';
            updateFillTip();
        }

        function setPreviewUI(ratio) {
            const pct = Math.min(Math.max(ratio, 0), 1) * 100;
            if (thumb) thumb.style.left = pct + '%';
            updateFillTip();
        }

        function ratioFromEvent(e) {
            const rect = inner.getBoundingClientRect();
            return (e.clientX - rect.left) / rect.width;
        }

        function previewAt(e) {
            if (!audio.duration) return;
            setPreviewUI(ratioFromEvent(e));
        }

        container.addEventListener('mouseenter', () => {
            container.classList.add('is-active');
            updateFillTip();
        });
        container.addEventListener('mouseleave', () => {
            if (!container.dataset.dragging) container.classList.remove('is-active');
            if (audio.duration) {
                setProgressUI(audio.currentTime / audio.duration, audio.currentTime, audio.duration);
            }
        });
        container.addEventListener('mousemove', previewAt);
        container.addEventListener('click', (e) => {
            const ratio = ratioFromEvent(e);
            seek(ratio);
        });

        container.addEventListener('mousedown', (e) => {
            container.dataset.dragging = '1';
            container.classList.add('is-active');
            previewAt(e);
            const onMove = (ev) => previewAt(ev);
            const onUp = (ev) => {
                delete container.dataset.dragging;
                container.classList.remove('is-active');
                seek(ratioFromEvent(ev));
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        audio.addEventListener('timeupdate', () => {
            if (!audio.duration || container.dataset.dragging) return;
            const cur = audio.currentTime;
            const dur = audio.duration;
            const ratio = cur / dur;
            fill.style.width = (Math.min(Math.max(ratio, 0), 1) * 100) + '%';
            if (container.classList.contains('is-active')) {
                updateFillTip();
            } else {
                setProgressUI(ratio, cur, dur);
            }
            if (currentTimeEl) currentTimeEl.textContent = formatTime(cur);
            if (totalTimeEl) totalTimeEl.textContent = formatTime(dur);
        });
        audio.addEventListener('loadedmetadata', () => {
            const dur = audio.duration;
            if (totalTimeEl) totalTimeEl.textContent = formatTime(dur);
            updateFillTip();
        });

        return setProgressUI;
    }

    // ===== 自动绑定标准底栏（6 个页面 ID 一致） =====
    function bindStandardPlayerBar() {
        const $ = id => document.getElementById(id);
        const trackCover = $('trackCover');
        const trackName = $('trackName');
        const artistName = $('artistName');
        const playBtn = $('playBtn');
        const playIcon = $('playIcon');
        const prevBtn = $('prevBtn');
        const nextBtn = $('nextBtn');
        const currentTimeEl = $('currentTime');
        const totalTimeEl = $('totalTime');
        const progressBar = $('progressBar');
        const progressBarContainer = $('progressBarContainer');
        const progressThumb = $('progressThumb');
        const volumeContainer = $('volumeContainer');
        const volumeBar = $('volumeBar');
        const likeBtn = $('likeBtn');
        const modeBtn = $('modeBtn');
        const volumeIcon = $('volumeIcon');

        if (playBtn) playBtn.addEventListener('click', toggle);
        if (prevBtn) prevBtn.addEventListener('click', prev);
        if (nextBtn) nextBtn.addEventListener('click', () => next(true));

        if (progressBarContainer) {
            bindProgressBarInteractions(
                progressBarContainer, progressBar, progressThumb, currentTimeEl, totalTimeEl
            );
        }
        if (volumeContainer) {
            volumeContainer.addEventListener('click', (e) => {
                const rect = volumeContainer.getBoundingClientRect();
                setVolume((e.clientX - rect.left) / rect.width);
            });
        }
        if (likeBtn) likeBtn.addEventListener('click', toggleLike);
        if (modeBtn) modeBtn.addEventListener('click', cycleMode);
        if (volumeIcon) volumeIcon.addEventListener('click', toggleMute);

        audio.addEventListener('loadedmetadata', () => {
            if (totalTimeEl) totalTimeEl.textContent = formatTime(audio.duration);
        });

        // 统一刷新底栏 UI
        function renderBar(snap) {
            const song = snap.song;
            if (trackName) trackName.textContent = song.name;
            if (artistName) artistName.textContent = song.artist;
            if (trackCover) trackCover.style.background = coverStyle(song);
            if (playIcon) playIcon.className = snap.playing ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            // 喜欢
            if (likeBtn) {
                const icon = likeBtn.querySelector('i');
                likeBtn.classList.toggle('liked', snap.liked);
                if (icon) {
                    icon.classList.toggle('fa-solid', snap.liked);
                    icon.classList.toggle('fa-regular', !snap.liked);
                }
            }
            // 音量条 + 音量图标
            if (volumeBar) volumeBar.style.width = (snap.muted ? 0 : snap.volume * 100) + '%';
            if (volumeIcon) {
                volumeIcon.className = 'fa-solid right-icon ' + (snap.muted ? 'fa-volume-xmark' : 'fa-volume-high');
                volumeIcon.id = 'volumeIcon';
                volumeIcon.title = '音量';
            }
            // 播放模式按钮
            if (modeBtn) {
                const mi = modeBtn.querySelector('i');
                if (mi) {
                    if (snap.mode === MODE.REPEAT_ONE) {
                        mi.className = 'fa-solid fa-repeat';
                        modeBtn.title = '单曲循环';
                        modeBtn.style.color = '#ec4141';
                    } else if (snap.mode === MODE.SHUFFLE) {
                        mi.className = 'fa-solid fa-shuffle';
                        modeBtn.title = '随机播放';
                        modeBtn.style.color = '#ec4141';
                    } else {
                        mi.className = 'fa-solid fa-list-ol';
                        modeBtn.title = '顺序播放';
                        modeBtn.style.color = '';
                    }
                }
            }
        }
        subscribers.push(renderBar);
        renderBar(getSnapshot());
        if (totalTimeEl && audio.duration) totalTimeEl.textContent = formatTime(audio.duration);
    }

    // ===== 公开 API =====
    window.NeteasePlayer = {
        MODE,
        playlist: CORE_PLAYLIST,
        playByIndex,
        toggle,
        next: () => next(true),
        prev,
        seek,
        setVolume,
        toggleMute,
        cycleMode,
        toggleLike,
        formatTime,
        isLiked,
        getState: getSnapshot,
        // 按歌名找 core 索引（列表页用来匹配真实音源）
        indexOfName: (name) => CORE_PLAYLIST.findIndex(s => s.name === (SONG_NAME_ALIASES[name] || name)),
        coverStyle,
        onChange: (cb) => { if (typeof cb === 'function') { subscribers.push(cb); cb(getSnapshot()); } },
        onProgress: (cb) => { if (typeof cb === 'function') { progressSubscribers.push(cb); cb(audio.currentTime, audio.duration || 0); } }
    };

    // DOM 就绪后绑定底栏
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectPlayerBarStyles();
            setupTopProgressBar();
            bindStandardPlayerBar();
        });
    } else {
        injectPlayerBarStyles();
        setupTopProgressBar();
        bindStandardPlayerBar();
    }
})();
