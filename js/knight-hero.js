(function () {
    'use strict';

    var destroy = null;

    function mount() {
        if (destroy) destroy();
        var root = document.querySelector('[data-hero-media]');
        if (!root) return;
        var video = root.querySelector('[data-hero-video]');
        var toggle = root.querySelector('[data-hero-toggle]');
        var status = root.querySelector('[data-hero-status]');
        var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        var connection = navigator.connection;
        var visible = !('IntersectionObserver' in window);
        var ready = false;
        var disposed = false;
        var userPaused = false;
        var userEnabled = false;
        var blocked = false;
        var failed = false;
        var pending = false;
        var observer;
        var idle;

        function automaticAllowed() {
            return !reducedMotion.matches && !(connection &&
                (connection.saveData || /(^|-)2g$/.test(connection.effectiveType || '')));
        }

        function wantsPlayback() {
            return !disposed && root.isConnected && ready && visible && !document.hidden &&
                !userPaused && !blocked && !failed && (userEnabled || automaticAllowed());
        }

        function updateControl() {
            var playing = !video.paused && !failed;
            root.classList.toggle('is-playing', playing);
            var label = failed ? '重试播放首页动图' : (playing || pending ? '暂停首页动图' : '播放首页动图');
            toggle.setAttribute('aria-label', label);
            toggle.title = label;
        }

        function sync() {
            if (!wantsPlayback()) {
                video.pause();
                updateControl();
                return;
            }
            if (pending || !video.paused) return;
            if (!video.getAttribute('src')) {
                video.muted = true;
                video.src = video.getAttribute('data-src');
                video.load();
            }
            pending = true;
            status.textContent = '';
            updateControl();
            var play = video.play();
            if (play && typeof play.then === 'function') {
                play.then(function () {
                    pending = false;
                    if (disposed) return;
                    if (!wantsPlayback()) video.pause();
                    updateControl();
                }).catch(function (error) {
                    pending = false;
                    if (disposed) return;
                    // A pause during loading is expected when scrolling or navigating.
                    if (error.name !== 'AbortError') blocked = true;
                    updateControl();
                    if (error.name === 'AbortError' && wantsPlayback()) sync();
                });
            } else {
                pending = false;
                updateControl();
            }
        }

        function onToggle() {
            if (!video.paused || pending) {
                userPaused = true;
            } else {
                userEnabled = true;
                userPaused = false;
                blocked = false;
                ready = true;
                if (failed) {
                    failed = false;
                    video.removeAttribute('src');
                    status.textContent = '';
                }
            }
            sync();
        }

        function onPlaying() {
            if (!wantsPlayback()) video.pause();
            updateControl();
        }

        function onError() {
            if (disposed) return;
            failed = true;
            pending = false;
            video.pause();
            video.removeAttribute('src');
            video.load();
            status.textContent = '暂无法播放，可点击重试';
            updateControl();
        }

        function onPreferenceChange() { userEnabled = false; sync(); }
        toggle.hidden = false;
        toggle.addEventListener('click', onToggle);
        video.addEventListener('playing', onPlaying);
        video.addEventListener('pause', updateControl);
        video.addEventListener('error', onError);
        document.addEventListener('visibilitychange', sync);
        if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onPreferenceChange);
        if (connection && connection.addEventListener) connection.addEventListener('change', onPreferenceChange);

        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver(function (entries) {
                visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
                sync();
            }, { threshold: [0, .15] });
            observer.observe(root);
        }

        // Paint the small poster first. The MP4 URL is attached only when playback is needed.
        var timer = window.setTimeout(function () {
            function start() { ready = true; sync(); }
            if ('requestIdleCallback' in window) idle = window.requestIdleCallback(start, { timeout: 1500 });
            else start();
        }, 350);

        destroy = function () {
            disposed = true;
            window.clearTimeout(timer);
            if (idle !== undefined && window.cancelIdleCallback) window.cancelIdleCallback(idle);
            if (observer) observer.disconnect();
            toggle.removeEventListener('click', onToggle);
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('pause', updateControl);
            video.removeEventListener('error', onError);
            document.removeEventListener('visibilitychange', sync);
            if (reducedMotion.removeEventListener) reducedMotion.removeEventListener('change', onPreferenceChange);
            if (connection && connection.removeEventListener) connection.removeEventListener('change', onPreferenceChange);
            video.pause();
            video.removeAttribute('src');
            video.load();
            destroy = null;
        };
    }

    document.addEventListener('knight:before-navigate', function () { if (destroy) destroy(); });
    document.addEventListener('knight:page-loaded', mount);
    window.addEventListener('pagehide', function () { if (destroy) destroy(); });
    window.addEventListener('pageshow', function (event) { if (event.persisted) mount(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
}());
