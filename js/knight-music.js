(function () {
    'use strict';

    var STORAGE_KEY = 'knight-music-state-v1';
    var root = document.getElementById('knightMusicRoot');
    var meting = root ? root.querySelector('[data-km-engine]') : null;
    if (!root || !meting) return;

    var ui = {
        dock: root.querySelector('[data-km-dock]'),
        toggle: root.querySelector('[data-km-toggle]'),
        close: root.querySelector('[data-km-close]'),
        playMini: root.querySelector('[data-km-play-mini]'),
        prevMini: root.querySelector('[data-km-prev-mini]'),
        nextMini: root.querySelector('[data-km-next-mini]'),
        panel: root.querySelector('[data-km-panel]'),
        play: root.querySelector('[data-km-play]'),
        prev: root.querySelector('[data-km-prev]'),
        next: root.querySelector('[data-km-next]'),
        order: root.querySelector('[data-km-order]'),
        orderLabel: root.querySelector('[data-km-order-label]'),
        volume: root.querySelector('[data-km-volume]'),
        progress: root.querySelector('[data-km-progress]'),
        current: root.querySelector('[data-km-current]'),
        duration: root.querySelector('[data-km-duration]'),
        title: root.querySelector('[data-km-title]'),
        artist: root.querySelector('[data-km-artist]'),
        titleMini: root.querySelector('[data-km-title-mini]'),
        artistMini: root.querySelector('[data-km-artist-mini]'),
        cover: root.querySelector('[data-km-cover]'),
        coverMini: root.querySelector('[data-km-cover-mini]'),
        coverFallback: root.querySelector('[data-km-cover-fallback]'),
        coverFallbackLarge: root.querySelector('[data-km-cover-fallback-large]'),
        playlist: root.querySelector('[data-km-playlist]'),
        count: root.querySelector('[data-km-count]'),
        refresh: root.querySelector('[data-km-refresh]')
    };

    var rememberState = root.getAttribute('data-remember-state') !== 'false';
    var defaultOpen = false;
    var apiPrimary = root.getAttribute('data-music-api') || '';
    var apiFallbacks = (root.getAttribute('data-music-api-fallbacks') || '').split('|KM|').filter(Boolean);
    var apiCandidates = [apiPrimary].concat(apiFallbacks).filter(function (item, index, list) {
        return item && list.indexOf(item) === index;
    });
    var syncMinutes = Math.max(1, Number(root.getAttribute('data-music-sync-minutes')) || 15);
    var ap = null;
    var initialized = false;
    var draggingProgress = false;
    var pendingRestore = null;
    var restoreAttemptedPlay = false;
    var playlistBound = false;
    var playlistSyncing = false;
    var lastPlaylistSyncAt = 0;

    function safeJSONParse(text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    function loadState() {
        if (!rememberState) return null;
        try { return safeJSONParse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
    }

    function saveState(extra) {
        if (!rememberState || !ap) return;
        var state = {
            index: ap.list && Number.isFinite(ap.list.index) ? ap.list.index : 0,
            currentTime: ap.audio && Number.isFinite(ap.audio.currentTime) ? ap.audio.currentTime : 0,
            volume: ap.audio && Number.isFinite(ap.audio.volume) ? ap.audio.volume : 0.7,
            playing: !!(ap.audio && !ap.audio.paused),
            order: ap.options && ap.options.order ? ap.options.order : 'list',
            updatedAt: Date.now()
        };
        if (extra) Object.keys(extra).forEach(function (key) { state[key] = extra[key]; });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    }

    function formatTime(seconds) {
        seconds = Number(seconds);
        if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
        var m = Math.floor(seconds / 60);
        var s = Math.floor(seconds % 60);
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function setRangeFill(input, valuePercent) {
        if (!input) return;
        var pct = Math.max(0, Math.min(100, valuePercent || 0));
        input.style.setProperty('--km-range', pct + '%');
    }

    function setOpen(open) {
        root.classList.toggle('is-open', !!open);
        if (ui.panel) ui.panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (ui.toggle) ui.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function currentAudio() {
        if (!ap || !ap.list || !ap.list.audios || !ap.list.audios.length) return null;
        return ap.list.audios[ap.list.index] || ap.list.audios[0] || null;
    }

    function setCover(img, fallback, url) {
        if (!img) return;
        if (url) {
            img.src = url;
            img.style.display = 'block';
            if (fallback) fallback.style.display = 'none';
            img.onerror = function () {
                img.removeAttribute('src');
                img.style.display = 'none';
                if (fallback) fallback.style.display = 'grid';
            };
        } else {
            img.removeAttribute('src');
            img.style.display = 'none';
            if (fallback) fallback.style.display = 'grid';
        }
    }

    function refreshTrackMeta() {
        if (!ap) return;
        var audio = currentAudio();
        if (!audio) return;
        var title = audio.name || audio.title || 'Untitled';
        var artist = audio.artist || audio.author || 'Unknown Artist';
        if (ui.title) ui.title.textContent = title;
        if (ui.artist) ui.artist.textContent = artist;
        if (ui.titleMini) ui.titleMini.textContent = title;
        if (ui.artistMini) ui.artistMini.textContent = artist;
        setCover(ui.cover, ui.coverFallbackLarge, audio.cover || audio.pic || '');
        setCover(ui.coverMini, ui.coverFallback, audio.cover || audio.pic || '');
        refreshPlaylistActive();
    }

    function refreshPlayingState() {
        if (!ap || !ap.audio) return;
        var playing = !ap.audio.paused;
        root.classList.toggle('is-playing', playing);
        if (ui.play) ui.play.setAttribute('aria-label', playing ? '暂停' : '播放');
        if (ui.playMini) ui.playMini.setAttribute('aria-label', playing ? '暂停音乐' : '播放音乐');
    }

    function refreshTime() {
        if (!ap || !ap.audio) return;
        var now = ap.audio.currentTime || 0;
        var duration = ap.audio.duration || 0;
        if (ui.current) ui.current.textContent = formatTime(now);
        if (ui.duration) ui.duration.textContent = formatTime(duration);
        if (!draggingProgress && ui.progress) {
            var ratio = duration > 0 ? now / duration : 0;
            ui.progress.value = Math.round(ratio * 1000);
            setRangeFill(ui.progress, ratio * 100);
        }
    }

    function refreshVolume() {
        if (!ap || !ap.audio || !ui.volume) return;
        var volume = Math.max(0, Math.min(1, ap.audio.volume));
        ui.volume.value = Math.round(volume * 100);
        setRangeFill(ui.volume, volume * 100);
    }

    function refreshOrder() {
        if (!ap || !ap.options || !ui.orderLabel) return;
        var random = ap.options.order === 'random';
        ui.orderLabel.textContent = random ? '随机' : '顺序';
        if (ui.order) ui.order.classList.toggle('is-random', random);
    }

    function escapeHTML(text) {
        return String(text || '').replace(/[&<>'"]/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch];
        });
    }

    function renderPlaylist() {
        if (!ap || !ap.list || !ap.list.audios || !ui.playlist) return;
        var audios = ap.list.audios;
        if (ui.count) ui.count.textContent = audios.length + ' TRACKS';
        ui.playlist.innerHTML = audios.map(function (audio, index) {
            var number = String(index + 1).padStart(2, '0');
            var title = escapeHTML(audio.name || audio.title || 'Untitled');
            var artist = escapeHTML(audio.artist || audio.author || 'Unknown Artist');
            return '<button type="button" class="km-track" data-km-track="' + index + '" aria-label="播放 ' + title + '">' +
                '<span class="km-track-index">' + number + '</span>' +
                '<span class="km-track-text"><span class="km-track-title">' + title + '</span><span class="km-track-artist">' + artist + '</span></span>' +
                '<span class="km-track-state">♪</span>' +
                '</button>';
        }).join('');
        if (!playlistBound) {
            playlistBound = true;
            ui.playlist.addEventListener('click', function (event) {
                var track = event.target.closest('[data-km-track]');
                if (!track || !ap) return;
                var index = Number(track.getAttribute('data-km-track'));
                if (!Number.isFinite(index)) return;
                if (ap.list.index !== index) ap.list.switch(index);
                var promise = ap.play();
                if (promise && typeof promise.catch === 'function') promise.catch(function () {});
            });
        }
        refreshPlaylistActive();
    }

    function refreshPlaylistActive() {
        if (!ui.playlist || !ap || !ap.list) return;
        Array.prototype.forEach.call(ui.playlist.querySelectorAll('[data-km-track]'), function (item) {
            item.classList.toggle('is-active', Number(item.getAttribute('data-km-track')) === ap.list.index);
        });
        var active = ui.playlist.querySelector('.km-track.is-active');
        if (active && root.classList.contains('is-open')) {
            var top = active.offsetTop;
            var bottom = top + active.offsetHeight;
            if (top < ui.playlist.scrollTop) ui.playlist.scrollTop = Math.max(0, top - 8);
            else if (bottom > ui.playlist.scrollTop + ui.playlist.clientHeight) ui.playlist.scrollTop = bottom - ui.playlist.clientHeight + 8;
        }
    }

    function tryRestoreSeekAndPlay() {
        if (!ap || !pendingRestore || !ap.audio) return;
        if (Number.isFinite(pendingRestore.currentTime) && pendingRestore.currentTime > 0 && Number.isFinite(ap.audio.duration) && ap.audio.duration > 0) {
            var target = Math.min(pendingRestore.currentTime, Math.max(0, ap.audio.duration - 0.5));
            try { ap.seek(target); } catch (e) {}
            pendingRestore.currentTime = 0;
        }
        if (pendingRestore.playing && !restoreAttemptedPlay) {
            restoreAttemptedPlay = true;
            try {
                var promise = ap.play();
                if (promise && typeof promise.catch === 'function') {
                    promise.catch(function () {
                        refreshPlayingState();
                    });
                }
            } catch (e) {}
        }
    }

    function restoreState() {
        var state = loadState();
        if (!state || !ap) {
            setOpen(false);
            return;
        }
        pendingRestore = state;
        if (state.order === 'list' || state.order === 'random') ap.options.order = state.order;
        if (Number.isFinite(state.volume)) {
            try { ap.volume(Math.max(0, Math.min(1, state.volume)), true); } catch (e) {}
        }
        if (ap.list && ap.list.audios && Number.isFinite(state.index) && state.index >= 0 && state.index < ap.list.audios.length) {
            if (ap.list.index !== state.index) ap.list.switch(state.index);
        }
        // The visual panel always starts collapsed. Audio state is remembered, panel state is not.
        setOpen(false);
        refreshOrder();
        refreshVolume();
        window.setTimeout(tryRestoreSeekAndPlay, 80);
    }

    function audioKey(audio) {
        if (!audio) return '';
        return String(audio.name || audio.title || '').trim() + '\u0000' + String(audio.artist || audio.author || '').trim();
    }

    function playlistSignature(audios) {
        return (audios || []).map(audioKey).join('\u0001');
    }

    function buildPlaylistApiUrl(template) {
        if (!template) return '';
        var url = template
            .replace(':server', encodeURIComponent(root.getAttribute('data-music-server') || 'netease'))
            .replace(':type', encodeURIComponent(root.getAttribute('data-music-type') || 'playlist'))
            .replace(':id', encodeURIComponent(root.getAttribute('data-music-id') || ''))
            .replace(':auth', '')
            .replace(':r', String(Date.now()) + '-' + String(Math.random()).slice(2));
        // Some proxies ignore :r when building their upstream cache key. The
        // extra query value still prevents browser/CDN reuse when supported.
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_kmts=' + Date.now();
        return url;
    }

    function fetchPlaylist(template) {
        var url = buildPlaylistApiUrl(template);
        if (!url) return Promise.reject(new Error('empty api'));
        return fetch(url, { cache: 'no-store', credentials: 'omit' })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                if (!Array.isArray(data) || !data.length) throw new Error('empty playlist');
                return data;
            });
    }

    function setSyncState(syncing, label) {
        playlistSyncing = !!syncing;
        root.classList.toggle('is-syncing-playlist', playlistSyncing);
        if (ui.refresh) {
            ui.refresh.disabled = playlistSyncing;
            ui.refresh.setAttribute('title', label || (playlistSyncing ? '正在同步网易云歌单' : '重新同步网易云歌单'));
        }
    }

    function replacePlaylist(data) {
        if (!ap || !ap.list || !Array.isArray(data) || !data.length) return;
        var oldAudio = currentAudio();
        var oldKey = audioKey(oldAudio);
        var oldTime = ap.audio && Number.isFinite(ap.audio.currentTime) ? ap.audio.currentTime : 0;
        var wasPlaying = !!(ap.audio && !ap.audio.paused);
        var oldVolume = ap.audio && Number.isFinite(ap.audio.volume) ? ap.audio.volume : 0.7;
        var oldOrder = ap.options && ap.options.order ? ap.options.order : 'list';
        var targetIndex = data.map(audioKey).indexOf(oldKey);
        if (targetIndex < 0) targetIndex = 0;

        try { ap.pause(); } catch (e) {}
        ap.list.clear();
        ap.list.add(data);
        if (ap.list.index !== targetIndex) ap.list.switch(targetIndex);
        if (ap.options) ap.options.order = oldOrder;
        try { ap.volume(oldVolume, true); } catch (e) {}

        renderPlaylist();
        refreshTrackMeta();
        refreshOrder();
        refreshVolume();

        var canRestorePosition = oldKey && audioKey(currentAudio()) === oldKey && oldTime > 0;
        var playlistRestoreDone = false;
        var restore = function () {
            if (playlistRestoreDone) return;
            playlistRestoreDone = true;
            if (canRestorePosition && ap.audio && Number.isFinite(ap.audio.duration) && ap.audio.duration > 0) {
                try { ap.seek(Math.min(oldTime, Math.max(0, ap.audio.duration - 0.5))); } catch (e) {}
            }
            if (wasPlaying) {
                try {
                    var promise = ap.play();
                    if (promise && typeof promise.catch === 'function') promise.catch(function () {});
                } catch (e) {}
            }
            refreshPlayingState();
            saveState();
        };
        if (ap.audio) ap.audio.addEventListener('loadedmetadata', restore, { once: true });
        window.setTimeout(restore, 600);
    }

    function syncPlaylist(options) {
        options = options || {};
        if (!ap || playlistSyncing || !apiCandidates.length) return Promise.resolve(false);
        // Automatic sync never interrupts a song that is currently playing.
        if (!options.force && ap.audio && !ap.audio.paused) return Promise.resolve(false);

        setSyncState(true, '正在同步网易云歌单');
        var currentSig = playlistSignature(ap.list && ap.list.audios ? ap.list.audios : []);
        var templates = options.tryFallbacks ? apiCandidates.slice() : apiCandidates.slice(0, 1);
        var index = 0;
        var lastData = null;

        function next() {
            if (index >= templates.length) {
                if (lastData && playlistSignature(lastData) !== currentSig) {
                    replacePlaylist(lastData);
                    return true;
                }
                return false;
            }
            var template = templates[index++];
            return fetchPlaylist(template).then(function (data) {
                lastData = data;
                var incomingSig = playlistSignature(data);
                if (incomingSig !== currentSig) {
                    replacePlaylist(data);
                    return true;
                }
                return options.tryFallbacks ? next() : false;
            }).catch(function () {
                return next();
            });
        }

        return Promise.resolve(next()).then(function (changed) {
            lastPlaylistSyncAt = Date.now();
            setSyncState(false, changed ? '歌单已同步更新' : '当前歌单已是最新');
            if (ui.refresh) {
                window.setTimeout(function () {
                    if (!playlistSyncing) ui.refresh.setAttribute('title', '重新同步网易云歌单');
                }, 2200);
            }
            return changed;
        }).catch(function () {
            lastPlaylistSyncAt = Date.now();
            setSyncState(false, '同步失败，请稍后重试');
            return false;
        });
    }

    function startPlaylistSync() {
        // MetingJS only resolves the playlist once when it creates APlayer. With
        // PJAX the player then survives for the whole session, so the first view
        // could keep an API-cached playlist until the user pressed refresh. Run
        // the exact same forced/fallback sync used by the refresh button shortly
        // after APlayer becomes ready.
        lastPlaylistSyncAt = 0;
        window.setTimeout(function () {
            syncPlaylist({ force: true, tryFallbacks: true });
        }, 450);

        window.setInterval(function () {
            syncPlaylist({ force: false, tryFallbacks: false });
        }, syncMinutes * 60 * 1000);
        window.addEventListener('focus', function () {
            if (Date.now() - lastPlaylistSyncAt >= syncMinutes * 60 * 1000) {
                syncPlaylist({ force: false, tryFallbacks: false });
            }
        });
    }

    function bindUI() {
        if (ui.toggle) ui.toggle.addEventListener('click', function () { setOpen(true); });
        if (ui.close) ui.close.addEventListener('click', function () { setOpen(false); });
        if (ui.refresh) ui.refresh.addEventListener('click', function () {
            syncPlaylist({ force: true, tryFallbacks: true });
        });
        if (ui.prevMini) ui.prevMini.addEventListener('click', function (event) {
            event.stopPropagation();
            if (ap) ap.skipBack();
        });
        if (ui.playMini) ui.playMini.addEventListener('click', function (event) {
            event.stopPropagation();
            if (ap) ap.toggle();
        });
        if (ui.nextMini) ui.nextMini.addEventListener('click', function (event) {
            event.stopPropagation();
            if (ap) ap.skipForward();
        });
        if (ui.play) ui.play.addEventListener('click', function () { if (ap) ap.toggle(); });
        if (ui.prev) ui.prev.addEventListener('click', function () { if (ap) ap.skipBack(); });
        if (ui.next) ui.next.addEventListener('click', function () { if (ap) ap.skipForward(); });
        if (ui.order) ui.order.addEventListener('click', function () {
            if (!ap || !ap.options) return;
            ap.options.order = ap.options.order === 'random' ? 'list' : 'random';
            refreshOrder();
            saveState();
        });
        if (ui.volume) ui.volume.addEventListener('input', function () {
            if (!ap) return;
            var value = Math.max(0, Math.min(100, Number(ui.volume.value) || 0));
            try { ap.volume(value / 100); } catch (e) {}
            setRangeFill(ui.volume, value);
        });
        if (ui.progress) {
            ui.progress.addEventListener('pointerdown', function () { draggingProgress = true; });
            ui.progress.addEventListener('input', function () {
                draggingProgress = true;
                setRangeFill(ui.progress, (Number(ui.progress.value) || 0) / 10);
            });
            var commitProgress = function () {
                if (!ap || !ap.audio) return;
                var duration = ap.audio.duration || 0;
                if (duration > 0) ap.seek((Number(ui.progress.value) / 1000) * duration);
                draggingProgress = false;
                saveState();
            };
            ui.progress.addEventListener('change', commitProgress);
            ui.progress.addEventListener('pointerup', commitProgress);
        }
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && root.classList.contains('is-open')) setOpen(false);
        });
    }

    function bindAPlayerEvents() {
        ['play', 'pause', 'playing'].forEach(function (eventName) {
            ap.on(eventName, function () {
                refreshPlayingState();
                saveState();
            });
        });
        ap.on('timeupdate', function () {
            refreshTime();
            if (Math.floor(ap.audio.currentTime || 0) % 4 === 0) saveState();
        });
        ap.on('loadedmetadata', function () {
            refreshTime();
            window.setTimeout(tryRestoreSeekAndPlay, 20);
        });
        ap.on('durationchange', refreshTime);
        ap.on('volumechange', function () { refreshVolume(); saveState(); });
        ap.on('listswitch', function () {
            window.setTimeout(function () {
                refreshTrackMeta();
                refreshTime();
                saveState({ currentTime: 0 });
            }, 0);
        });
        ap.on('ended', function () { saveState({ currentTime: 0 }); });
        window.addEventListener('beforeunload', function () { saveState(); });
        document.addEventListener('visibilitychange', function () { if (document.hidden) saveState(); });
    }

    function init(player) {
        if (initialized || !player) return;
        initialized = true;
        ap = player;
        window.KnightMusic = {
            player: ap,
            open: function () { setOpen(true); },
            close: function () { setOpen(false); },
            toggle: function () { ap.toggle(); },
            save: saveState
        };
        bindUI();
        bindAPlayerEvents();
        renderPlaylist();
        refreshTrackMeta();
        refreshPlayingState();
        refreshTime();
        refreshVolume();
        refreshOrder();
        restoreState();
        root.classList.add('is-ready');
        startPlaylistSync();
    }

    function showEngineStatus(title, detail, finalFailure) {
        if (ui.titleMini) ui.titleMini.textContent = title;
        if (ui.artistMini) ui.artistMini.textContent = detail;
        if (ui.title) ui.title.textContent = title;
        if (ui.artist) ui.artist.textContent = detail;
        if (ui.playlist) {
            ui.playlist.innerHTML = finalFailure
                ? '<div class="km-load-error"><strong>歌单暂时无法读取</strong><span>请检查网络或稍后刷新页面。播放器界面本身已正常加载。</span></div>'
                : '<div class="km-loading"><span></span><span></span><span></span>' + detail + '</div>';
        }
    }

    function replaceMeting(api) {
        var previous = meting;
        var fresh = document.createElement('meting-js');
        fresh.setAttribute('data-km-engine', '');
        fresh.className = 'knight-music-engine';
        fresh.setAttribute('server', root.getAttribute('data-music-server') || 'netease');
        fresh.setAttribute('type', root.getAttribute('data-music-type') || 'playlist');
        fresh.setAttribute('id', root.getAttribute('data-music-id') || '');
        if (api) fresh.setAttribute('api', api);
        fresh.setAttribute('fixed', 'false');
        fresh.setAttribute('mini', 'false');
        fresh.setAttribute('autoplay', 'false');
        fresh.setAttribute('mutex', 'false');
        fresh.setAttribute('theme', '#42b983');
        fresh.setAttribute('loop', 'all');
        fresh.setAttribute('order', 'random');
        fresh.setAttribute('preload', 'auto');
        fresh.setAttribute('volume', '0.7');
        fresh.setAttribute('list-folded', 'true');
        fresh.setAttribute('lrc-type', '3');
        if (previous && previous.parentNode) previous.parentNode.replaceChild(fresh, previous);
        meting = fresh;
        return fresh;
    }

    function waitForPlayer(apiIndex) {
        apiIndex = Number.isFinite(apiIndex) ? apiIndex : 0;
        var selectedApi = apiCandidates[apiIndex] || apiPrimary;
        if (apiIndex > 0) {
            showEngineStatus('正在切换音乐接口', '尝试备用歌单服务 ' + (apiIndex + 1), false);
            replaceMeting(selectedApi);
        }
        if (meting && meting.aplayer) {
            init(meting.aplayer);
            return;
        }
        var attempts = 0;
        var timer = window.setInterval(function () {
            attempts += 1;
            if (meting && meting.aplayer) {
                window.clearInterval(timer);
                init(meting.aplayer);
                return;
            }
            if (attempts >= 36) { // 9 seconds per endpoint
                window.clearInterval(timer);
                if (apiIndex + 1 < apiCandidates.length) {
                    waitForPlayer(apiIndex + 1);
                } else {
                    showEngineStatus('歌单加载失败', '网易云歌单接口未响应', true);
                    root.classList.add('is-load-failed');
                }
            }
        }, 250);
    }

    // Always begin visually collapsed, even if an older version saved expanded=true.
    setOpen(false);
    waitForPlayer(0);
})();
