(function () {
    'use strict';

    function decodeName(value) {
        try { return decodeURIComponent(value || ''); } catch (e) { return value || ''; }
    }

    function decodeArray(value) {
        try { return JSON.parse(decodeURIComponent(value || '%5B%5D')); } catch (e) { return []; }
    }

    function initTaxonomyHub() {
        var hub = document.getElementById('taxonomy-hub');
        if (!hub || hub.dataset.taxonomyBound === '1') return;
        hub.dataset.taxonomyBound = '1';

        var posts = Array.prototype.slice.call(hub.querySelectorAll('[data-taxonomy-post]'));
        var title = hub.querySelector('[data-taxonomy-result-title]');
        var clear = hub.querySelector('[data-taxonomy-clear]');
        var empty = hub.querySelector('[data-taxonomy-empty]');
        var resultSection = hub.querySelector('#taxonomy-results');
        var pagination = hub.querySelector('[data-taxonomy-pagination]');
        var pagesRoot = hub.querySelector('[data-taxonomy-pages]');
        var prevBtn = hub.querySelector('[data-taxonomy-prev]');
        var nextBtn = hub.querySelector('[data-taxonomy-next]');
        var pageSize = Math.max(1, parseInt(hub.getAttribute('data-page-size'), 10) || 9);

        var activeKind = '';
        var activeName = '';
        var currentPage = 1;
        var matchedPosts = posts.slice();

        function setActiveVisual(kind, name) {
            Array.prototype.forEach.call(hub.querySelectorAll('[data-taxonomy-filter]'), function (node) {
                var nodeKind = node.getAttribute('data-taxonomy-filter') || '';
                var nodeName = decodeName(node.getAttribute('data-taxonomy-name'));
                node.classList.toggle('taxonomy-filter-active', !!kind && nodeKind === kind && nodeName === name);
            });

            Array.prototype.forEach.call(hub.querySelectorAll('#tag-wordcloud a'), function (node) {
                node.classList.toggle('taxonomy-filter-active', kind === 'tag' && node.textContent.trim() === name);
            });
        }

        function scrollToResults() {
            if (!resultSection) return;
            var top = resultSection.getBoundingClientRect().top + window.pageYOffset - 88;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }

        function renderPagination() {
            var totalPages = Math.max(1, Math.ceil(matchedPosts.length / pageSize));
            currentPage = Math.min(Math.max(currentPage, 1), totalPages);

            posts.forEach(function (post) { post.hidden = true; });
            var start = (currentPage - 1) * pageSize;
            var end = Math.min(start + pageSize, matchedPosts.length);
            matchedPosts.slice(start, end).forEach(function (post) { post.hidden = false; });

            if (empty) empty.hidden = matchedPosts.length !== 0;
            if (pagination) pagination.hidden = matchedPosts.length === 0 || totalPages <= 1;
            if (prevBtn) prevBtn.disabled = currentPage <= 1;
            if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

            if (pagesRoot) {
                pagesRoot.innerHTML = '';
                for (var i = 1; i <= totalPages; i++) {
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'forum-feed-pagination__page' + (i === currentPage ? ' is-active' : '');
                    btn.textContent = i;
                    btn.setAttribute('aria-label', '第 ' + i + ' 页');
                    if (i === currentPage) btn.setAttribute('aria-current', 'page');
                    (function (targetPage) {
                        btn.addEventListener('click', function () {
                            currentPage = targetPage;
                            renderPagination();
                            scrollToResults();
                        });
                    })(i);
                    pagesRoot.appendChild(btn);
                }
            }
        }

        function applyFilter(kind, name, options) {
            options = options || {};
            activeKind = kind || '';
            activeName = name || '';
            currentPage = 1;

            matchedPosts = posts.filter(function (post) {
                if (activeKind === 'category') {
                    return decodeArray(post.getAttribute('data-categories')).indexOf(activeName) !== -1;
                }
                if (activeKind === 'tag') {
                    return decodeArray(post.getAttribute('data-tags')).indexOf(activeName) !== -1;
                }
                return true;
            });

            if (title) {
                title.textContent = activeKind
                    ? (activeKind === 'category' ? '分类 · ' : '标签 · ') + activeName
                    : '全部文章';
            }
            if (clear) clear.hidden = !activeKind;
            setActiveVisual(activeKind, activeName);
            renderPagination();

            if (options.scroll) scrollToResults();
        }

        hub.addEventListener('click', function (event) {
            var filter = event.target.closest && event.target.closest('[data-taxonomy-filter]');
            if (filter && hub.contains(filter)) {
                event.preventDefault();
                applyFilter(
                    filter.getAttribute('data-taxonomy-filter'),
                    decodeName(filter.getAttribute('data-taxonomy-name')),
                    { scroll: true }
                );
                return;
            }

            var cloudLink = event.target.closest && event.target.closest('#tag-wordcloud a');
            if (cloudLink && hub.contains(cloudLink)) {
                event.preventDefault();
                applyFilter('tag', cloudLink.textContent.trim(), { scroll: true });
                return;
            }

            var clearButton = event.target.closest && event.target.closest('[data-taxonomy-clear]');
            if (clearButton && hub.contains(clearButton)) {
                event.preventDefault();
                applyFilter('', '', { scroll: false });
            }
        });

        if (prevBtn) {
            prevBtn.addEventListener('click', function () {
                if (currentPage <= 1) return;
                currentPage -= 1;
                renderPagination();
                scrollToResults();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function () {
                var totalPages = Math.max(1, Math.ceil(matchedPosts.length / pageSize));
                if (currentPage >= totalPages) return;
                currentPage += 1;
                renderPagination();
                scrollToResults();
            });
        }

        var initialKind = hub.getAttribute('data-initial-kind') || '';
        var initialName = decodeName(hub.getAttribute('data-initial-name'));
        applyFilter(initialKind, initialName, { scroll: false });

        // jQCloud paints asynchronously. Re-apply selected visual after it finishes.
        setTimeout(function () { setActiveVisual(activeKind, activeName); }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTaxonomyHub);
    } else {
        initTaxonomyHub();
    }
    document.addEventListener('knight:page-loaded', initTaxonomyHub);
})();
