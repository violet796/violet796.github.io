(function () {
    'use strict';

    var script = document.currentScript;
    if (!script) return;
    var scriptPromises = Object.create(null);
    var stylePromises = Object.create(null);
    var travelPromise = null;
    var musicPromise = null;
    var pendingMusicAction = '';
    var musicRoot = document.getElementById('knightMusicRoot');

    function setting(name) { return script.getAttribute('data-' + name) || ''; }

    function loadScript(url) {
        if (scriptPromises[url]) return scriptPromises[url];
        scriptPromises[url] = new Promise(function (resolve, reject) {
            var node = document.createElement('script');
            node.src = url;
            node.async = true;
            node.onload = function () { resolve(); };
            node.onerror = function () {
                delete scriptPromises[url];
                node.remove();
                reject(new Error('Script unavailable: ' + url));
            };
            document.head.appendChild(node);
        });
        return scriptPromises[url];
    }

    function loadStyle(url) {
        if (stylePromises[url]) return stylePromises[url];
        stylePromises[url] = new Promise(function (resolve, reject) {
            var node = document.createElement('link');
            node.rel = 'stylesheet';
            node.href = url;
            node.onload = function () { resolve(); };
            node.onerror = function () {
                delete stylePromises[url];
                node.remove();
                reject(new Error('Stylesheet unavailable: ' + url));
            };
            document.head.appendChild(node);
        });
        return stylePromises[url];
    }

    function ensureTravel() {
        var root = document.querySelector('[data-travel-page]');
        if (!root) return Promise.resolve();
        if (!travelPromise) {
            var mapEngine = Promise.resolve().then(function () {
                return window.L ? null : loadScript(setting('leaflet-js'));
            }).then(function () {
                return window.L && typeof window.L.markerClusterGroup === 'function'
                    ? null : loadScript(setting('cluster-js'));
            });
            travelPromise = Promise.all([
                loadStyle(setting('leaflet-css')),
                loadStyle(setting('cluster-css')),
                loadStyle(setting('cluster-theme-css')),
                loadStyle(setting('travel-css')),
                mapEngine
            ]).then(function () {
                return loadScript(setting('travel-js'));
            }).catch(function (error) {
                travelPromise = null;
                throw error;
            });
        }
        return travelPromise.then(function () {
            if (root.isConnected && typeof window.KnightTravelInit === 'function') window.KnightTravelInit();
        }).catch(function () {
            var loading = root.querySelector('[data-travel-loading]');
            if (!loading || !root.isConnected) return;
            loading.textContent = '地图暂时无法加载，点击重试';
            loading.style.pointerEvents = 'auto';
            loading.style.cursor = 'pointer';
            loading.tabIndex = 0;
            loading.setAttribute('role', 'button');
            if (loading.dataset.assetRetryBound) return;
            loading.dataset.assetRetryBound = '1';
            var retry = function () {
                loading.textContent = '正在加载地图';
                loading.style.pointerEvents = 'none';
                ensureTravel();
            };
            loading.addEventListener('click', retry);
            loading.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    retry();
                }
            });
        });
    }

    function musicMessage(text) {
        if (!musicRoot) return;
        ['[data-km-title-mini]', '[data-km-title]'].forEach(function (selector) {
            var node = musicRoot.querySelector(selector);
            if (node) node.textContent = text;
        });
    }

    function ensureMusic() {
        if (!musicRoot) return Promise.resolve();
        if (musicPromise) return musicPromise;
        musicMessage('音乐加载中');
        musicPromise = Promise.all([
            loadStyle(setting('player-css')),
            typeof window.APlayer === 'function' ? null : loadScript(setting('player-js'))
        ]).then(function () {
            return window.customElements && window.customElements.get('meting-js')
                ? null : loadScript(setting('meting-js'));
        }).then(function () {
            return loadScript(setting('music-js'));
        }).catch(function () {
            musicPromise = null;
            musicMessage('音乐暂不可用，点击重试');
        });
        return musicPromise;
    }

    if (musicRoot) {
        // Remember the first click while the engine is still loading.
        musicRoot.addEventListener('click', function (event) {
            if (musicRoot.classList.contains('is-ready')) return;
            var control = event.target.closest('[data-km-toggle], [data-km-play-mini], [data-km-next-mini], [data-km-prev-mini]');
            if (!control || !musicRoot.contains(control)) return;
            pendingMusicAction = control.hasAttribute('data-km-toggle') ? 'open'
                : control.hasAttribute('data-km-next-mini') ? 'next'
                : control.hasAttribute('data-km-prev-mini') ? 'previous' : 'play';
            event.preventDefault();
            ensureMusic();
        }, true);
        document.addEventListener('knight:music-ready', function () {
            var action = pendingMusicAction;
            pendingMusicAction = '';
            if (!action || !window.KnightMusic) return;
            if (action === 'open') window.KnightMusic.open();
            else if (action === 'next') window.KnightMusic.player.skipForward();
            else if (action === 'previous') window.KnightMusic.player.skipBack();
            else window.KnightMusic.toggle();
        });
    }

    function pageReady() {
        ensureTravel();
        if (!musicRoot) return;
        var backgroundMusic = function () {
            if ('requestIdleCallback' in window) window.requestIdleCallback(ensureMusic, { timeout: 2000 });
            else window.setTimeout(ensureMusic, 600);
        };
        if (window.requestAnimationFrame) window.requestAnimationFrame(backgroundMusic);
        else backgroundMusic();
    }

    document.addEventListener('knight:page-loaded', ensureTravel);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pageReady, { once: true });
    else pageReady();
})();
