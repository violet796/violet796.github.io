(function () {
    'use strict';

    var SHELL_ID = 'knight-page-shell';
    var loadedScripts = new Set();
    Array.prototype.forEach.call(document.scripts || [], function (script) {
        if (script.src) loadedScripts.add(new URL(script.src, location.href).href);
    });

    function samePageHash(url) {
        return url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && !!url.hash;
    }

    function shouldHandleLink(anchor, event) {
        if (!anchor || event.defaultPrevented || event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        if (anchor.target && anchor.target !== '_self') return false;
        if (anchor.hasAttribute('download') || anchor.hasAttribute('data-no-pjax')) return false;
        if (anchor.classList.contains('modal-trigger') || anchor.classList.contains('sidenav-trigger')) return false;
        var href = anchor.getAttribute('href');
        if (!href || href === '#' || href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return false;
        var url;
        try { url = new URL(anchor.href, location.href); } catch (e) { return false; }
        if (url.origin !== location.origin) return false;
        if (samePageHash(url)) return false;
        if (/\.(?:zip|rar|7z|pdf|png|jpe?g|gif|webp|svg|mp3|flac|wav|ogg|mp4|webm|docx?|xlsx?|pptx?)(?:$|\?)/i.test(url.pathname)) return false;
        return true;
    }

    function updateHead(doc) {
        if (doc.title) document.title = doc.title;
        ['description', 'keywords'].forEach(function (name) {
            var incoming = doc.querySelector('meta[name="' + name + '"]');
            var current = document.querySelector('meta[name="' + name + '"]');
            if (incoming && current) current.setAttribute('content', incoming.getAttribute('content') || '');
        });
    }

    function copyScriptAttributes(from, to) {
        Array.prototype.forEach.call(from.attributes || [], function (attr) {
            if (attr.name === 'src') return;
            to.setAttribute(attr.name, attr.value);
        });
    }

    function loadExternalScript(inert) {
        return new Promise(function (resolve) {
            var absolute = new URL(inert.src, location.href).href;
            var alwaysReload = /\/libs\/codeBlock\//i.test(absolute);
            if (!alwaysReload && loadedScripts.has(absolute)) {
                inert.remove();
                resolve();
                return;
            }
            var script = document.createElement('script');
            copyScriptAttributes(inert, script);
            script.src = absolute;
            script.async = false;
            script.onload = function () {
                loadedScripts.add(absolute);
                resolve();
            };
            script.onerror = function () { resolve(); };
            inert.replaceWith(script);
        });
    }

    function runInlineScript(inert) {
        var type = (inert.getAttribute('type') || '').toLowerCase();
        if (type && type !== 'text/javascript' && type !== 'application/javascript' && type !== 'text/x-mathjax-config' && type !== 'module') {
            inert.remove();
            return Promise.resolve();
        }
        var script = document.createElement('script');
        copyScriptAttributes(inert, script);
        if (type === 'text/x-mathjax-config') script.type = 'text/javascript';
        script.text = inert.textContent || '';
        inert.replaceWith(script);
        return Promise.resolve();
    }

    async function executeShellScripts(shell) {
        var scripts = Array.prototype.slice.call(shell.querySelectorAll('script'));
        for (var i = 0; i < scripts.length; i++) {
            var inert = scripts[i];
            if (!inert.isConnected) continue;
            if (inert.src) await loadExternalScript(inert);
            else await runInlineScript(inert);
        }
    }

    function pageCleanup() {
        try {
            if (window.tocbot && typeof window.tocbot.destroy === 'function') window.tocbot.destroy();
        } catch (e) {}
        try {
            if (window.lightGallery && document.querySelector('#articleContent')) {
                // LightGallery instances live on the outgoing nodes and disappear with the shell.
            }
        } catch (e) {}
    }

    function postLoadInit() {
        if (typeof window.KnightMateryPageInit === 'function') {
            try { window.KnightMateryPageInit(); } catch (e) { console.warn('[KnightPJAX] page init:', e); }
        }
        try {
            if (window.MathJax && window.MathJax.Hub) window.MathJax.Hub.Queue(['Typeset', window.MathJax.Hub]);
        } catch (e) {}
        try {
            if (window.AOS && typeof window.AOS.refreshHard === 'function') window.AOS.refreshHard();
        } catch (e) {}
        document.dispatchEvent(new CustomEvent('knight:page-loaded', { detail: { url: location.href } }));
    }

    async function navigate(rawUrl, options) {
        options = options || {};
        var target = new URL(rawUrl, location.href);
        if (target.origin !== location.origin) {
            location.href = target.href;
            return;
        }
        var currentShell = document.getElementById(SHELL_ID);
        if (!currentShell) {
            location.href = target.href;
            return;
        }

        document.documentElement.classList.add('knight-pjax-loading');
        document.dispatchEvent(new CustomEvent('knight:before-navigate', { detail: { url: target.href } }));

        try {
            var response = await fetch(target.href, {
                credentials: 'same-origin',
                headers: { 'X-Knight-PJAX': '1' }
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var html = await response.text();
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var incomingShell = doc.getElementById(SHELL_ID);
            if (!incomingShell) throw new Error('PJAX shell missing');

            // fetch() follows redirects. Use the final canonical URL before running
            // page scripts so path-sensitive widgets (notably Valine) use the same
            // key as a direct page load, e.g. /contact/ instead of /contact.
            var finalTarget = response.url ? new URL(response.url, location.href) : target;
            if (target.hash) finalTarget.hash = target.hash;

            pageCleanup();
            updateHead(doc);
            currentShell.innerHTML = incomingShell.innerHTML;

            if (options.push !== false) history.pushState({ knightPjax: true }, '', finalTarget.href);
            else history.replaceState({ knightPjax: true }, '', finalTarget.href);
            target = finalTarget;

            await executeShellScripts(currentShell);
            postLoadInit();

            if (target.hash) {
                var id = decodeURIComponent(target.hash.slice(1));
                var node = document.getElementById(id);
                if (node) node.scrollIntoView();
                else window.scrollTo(0, 0);
            } else if (options.preserveScroll !== true) {
                window.scrollTo(0, 0);
            }
        } catch (error) {
            console.warn('[KnightPJAX] fallback navigation:', error);
            location.href = target.href;
            return;
        } finally {
            document.documentElement.classList.remove('knight-pjax-loading');
        }
    }

    document.addEventListener('click', function (event) {
        var anchor = event.target.closest && event.target.closest('a[href]');
        if (!shouldHandleLink(anchor, event)) return;
        event.preventDefault();
        navigate(anchor.href);
    });

    window.addEventListener('popstate', function () {
        navigate(location.href, { push: false });
    });

    history.replaceState({ knightPjax: true }, '', location.href);
    window.KnightPjax = { navigate: navigate };
})();
