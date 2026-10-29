/* Busuanzi official endpoint, with explicit failure states and PJAX support. */
(function () {
    'use strict';
    if (window.KnightStatistics) return;
    var keys = ['site_pv', 'site_uv', 'page_pv'];
    var active = null;
    var lastPath = '';
    var sequence = 0;

    function state(message, value, retry) {
        keys.forEach(function (key) {
            var node = document.getElementById('busuanzi_value_' + key);
            if (node) node.textContent = value;
        });
        var status = document.querySelector('[data-statistics-status]');
        if (status) status.textContent = message;
        var button = document.querySelector('[data-statistics-retry]');
        if (button) { button.hidden = !retry; button.disabled = !retry; }
    }

    function cancel() {
        if (active) active.finish();
    }

    function refresh(force) {
        var path = location.origin + location.pathname + location.search;
        if (!force && path === lastPath) return;
        lastPath = path;
        cancel();
        if (!keys.some(function (key) { return document.getElementById('busuanzi_value_' + key); })) return;
        if (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(location.hostname)) {
            state('', '—', false);
            return;
        }

        state('', '加载中', false);
        var script = document.createElement('script');
        var name = 'KnightBusuanzi_' + Date.now() + '_' + (++sequence);
        var timer;
        var request = { finish: function () {
            window.clearTimeout(timer);
            script.remove();
            // Ignore any late JSONP result after timeout or navigation.
            window[name] = function () {};
            window.setTimeout(function () { delete window[name]; }, 60000);
            if (active === request) active = null;
        } };
        active = request;
        function fail() {
            if (active !== request) return;
            request.finish();
            state('统计服务暂不可用', '—', true);
        }
        window[name] = function (data) {
            if (active !== request) return;
            var values = {};
            var valid = data && keys.every(function (key) {
                if (!document.getElementById('busuanzi_value_' + key)) return true;
                var raw = data[key];
                var number = Number(raw);
                if ((typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+$/.test(raw))) ||
                    !Number.isSafeInteger(number) || number < 0) return false;
                values[key] = String(number);
                return true;
            });
            if (!valid) { fail(); return; }
            request.finish();
            state('', '', false);
            Object.keys(values).forEach(function (key) {
                document.getElementById('busuanzi_value_' + key).textContent = values[key];
                var container = document.getElementById('busuanzi_container_' + key);
                if (container) container.style.display = 'inline';
            });
        };
        script.async = true;
        // Match the official script's referrer policy, including the article path.
        script.referrerPolicy = 'no-referrer-when-downgrade';
        script.src = 'https://busuanzi.ibruce.info/busuanzi?jsonpCallback=' + name;
        script.onerror = fail;
        timer = window.setTimeout(fail, 12000);
        document.head.appendChild(script);
    }

    document.addEventListener('click', function (event) {
        if (event.target.closest('[data-statistics-retry]')) refresh(true);
    });
    document.addEventListener('knight:before-navigate', function () { cancel(); lastPath = ''; });
    document.addEventListener('knight:page-loaded', function () { refresh(false); });
    window.KnightStatistics = { refresh: function () { refresh(true); } };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { refresh(false); }, { once: true });
    } else refresh(false);
}());
