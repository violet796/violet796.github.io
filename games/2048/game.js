(function () {
    'use strict';
    var engine = window.Knight2048;
    var $ = function (s) { return document.querySelector(s); };
    var boardNode = $('[data-board]'), dialog = $('[data-dialog]'), input = $('#player-name');
    var progressKey = 'knight2048.progress.v1', ranksKey = 'knight2048.ranks.v1';
    var state, ranks = [], paused = false, restartAfterRecord = false, touch = null;
    function storageError() { $('[data-storage-note]').textContent = '浏览器未允许保存数据：本次可以游玩，关闭页面后进度和榜单可能无法保留。'; }
    function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { storageError(); return undefined; } }
    function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { storageError(); return false; } }
    function validScore(v) { return Number.isSafeInteger(v) && v >= 0 && v <= 1e12; }
    function validMax(v) { return Number.isSafeInteger(v) && v >= 2 && v <= 131072 && Number.isInteger(Math.log2(v)); }
    function uid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2); }
    function loadRanks() {
        var saved = read(ranksKey);
        if (saved === undefined) return;
        ranks = (Array.isArray(saved) ? saved : []).filter(function (r) {
            return r && typeof r.id === 'string' && r.id.length <= 100 && engine.validateName(r.name).ok && validScore(r.score) && r.score > 0 && Number.isFinite(r.date);
        }).map(function (r) { return { id: r.id, name: engine.validateName(r.name).name, score: r.score, maxTile: validMax(r.maxTile) ? r.maxTile : null, date: r.date }; });
        var unique = new Map();
        ranks.forEach(function (r) { if (!unique.has(r.id) || unique.get(r.id).score < r.score) unique.set(r.id, r); });
        ranks = Array.from(unique.values()).sort(function (a, b) { return b.score - a.score || a.date - b.date; }).slice(0, 10);
    }
    function saveProgress() { write(progressKey, state); }
    function start() {
        state = { id: uid(), board: engine.initial(), score: 0, wonAck: false, submitted: 0, name: '' };
        paused = false; restartAfterRecord = false;
        if (dialog.open) dialog.close();
        saveProgress(); render(); boardNode.focus({ preventScroll: true });
        message('新的一局，从两个方块开始。');
    }
    function message(text) { $('[data-message]').textContent = text; }
    function renderRanks() {
        var list = $('[data-leaderboard]'); list.replaceChildren();
        ranks.forEach(function (r, i) {
            var li = document.createElement('li'); li.className = 'rank-row' + (r.id === state.id ? ' is-current' : '');
            [['rank-number', String(i + 1).padStart(2, '0')], ['rank-name', r.name], ['rank-score', String(r.score)]].forEach(function (pair) {
                var span = document.createElement('span'); span.className = pair[0];
                if (pair[0] === 'rank-score') {
                    var points = document.createElement('strong'); points.className = 'rank-points'; points.textContent = pair[1];
                    var maximum = document.createElement('small'); maximum.className = 'rank-tile';
                    maximum.textContent = r.maxTile ? '最高 ' + r.maxTile : '最高方块未记录';
                    span.append(points, maximum);
                } else span.textContent = pair[1];
                li.appendChild(span);
            }); list.appendChild(li);
        });
        $('[data-empty]').hidden = ranks.length > 0;
    }
    function render(old) {
        boardNode.replaceChildren();
        state.board.forEach(function (n, i) {
            var tile = document.createElement('div'); tile.className = 'tile' + (n > 2048 ? ' tile-high' : '') + (old && n && old[i] !== n ? ' tile-new' : '');
            tile.dataset.value = n; tile.textContent = n || ''; tile.setAttribute('aria-label', '第 ' + (Math.floor(i / 4) + 1) + ' 行第 ' + (i % 4 + 1) + ' 列：' + (n || '空')); boardNode.appendChild(tile);
        });
        $('[data-score]').textContent = state.score;
        $('[data-best]').textContent = Math.max(state.score, ranks.length ? ranks[0].score : 0);
        $('[data-max]').textContent = Math.max.apply(null, state.board);
        $('[data-record]').disabled = !state.score || state.score <= state.submitted;
        $('[data-pause]').textContent = paused ? '继续' : '暂停';
        $('[data-pause-overlay]').hidden = !paused;
        renderRanks();
    }
    function record(reason) {
        if (!state.score || dialog.open) return;
        var ended = !engine.canMove(state.board);
        restartAfterRecord = reason === 'restart' || ended;
        $('[data-dialog-title]').textContent = ended ? '这一局，完成了' : restartAfterRecord ? '开新局前，留下成绩？' : reason === 'win' ? '你合成了 2048！' : '登记本局成绩';
        $('[data-dialog-copy]').textContent = ended ? '本局已结束。登记成绩后开始下一局，也可以跳过登记直接开始。' : '登记后仍可继续挑战，更高的分数会更新同一条记录。';
        $('[data-dialog-score]').textContent = state.score;
        $('[data-dialog-max]').textContent = '最高方块 ' + Math.max.apply(null, state.board);
        $('[data-name-error]').textContent = ''; input.value = state.name || '';
        input.setAttribute('aria-invalid', 'false');
        $('[data-save]').textContent = ended ? '保存并开始下一局' : restartAfterRecord ? '保存并开新局' : '保存成绩';
        $('[data-close]').textContent = '继续游戏';
        $('[data-close]').hidden = ended;
        $('[data-discard]').textContent = ended ? '不登记，开始下一局' : '不登记，开新局';
        $('[data-discard]').hidden = !restartAfterRecord;
        dialog.showModal(); input.focus();
    }
    function move(direction) {
        if (paused || dialog.open || !engine.canMove(state.board)) return;
        var old = state.board, result = engine.move(old, direction);
        if (!result.changed) { message('这个方向暂时无法移动，换个方向试试。'); return; }
        state.board = engine.spawn(result.board); state.score += result.gained;
        saveProgress(); render(old);
        message(result.gained ? '合并成功，+' + result.gained + ' 分。' : '继续寻找下一次合并。');
        if (!engine.canMove(state.board)) record('over');
        else if (!state.wonAck && Math.max.apply(null, state.board) >= 2048) {
            state.wonAck = true; saveProgress(); record('win');
        }
    }
    function togglePause() { if (dialog.open) return; paused = !paused; render(); if (!paused) boardNode.focus({ preventScroll: true }); }
    $('[data-new]').onclick = function () { if (state.score > state.submitted) record('restart'); else start(); };
    $('[data-record]').onclick = function () { record('manual'); };
    $('[data-pause]').onclick = togglePause; $('[data-resume]').onclick = togglePause;
    $('[data-close]').onclick = function () { restartAfterRecord = false; dialog.close(); boardNode.focus({ preventScroll: true }); };
    $('[data-discard]').onclick = start;
    dialog.addEventListener('cancel', function (event) {
        if (!engine.canMove(state.board)) { event.preventDefault(); return; }
        restartAfterRecord = false;
    });
    $('[data-form]').addEventListener('submit', function (event) {
        event.preventDefault();
        var result = engine.validateName(input.value);
        if (!result.ok) { $('[data-name-error]').textContent = result.error; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        loadRanks();
        var existing = ranks.find(function (r) { return r.id === state.id; });
        ranks = ranks.filter(function (r) { return r.id !== state.id; });
        ranks.push({ id: state.id, name: result.name, score: state.score, maxTile: Math.max.apply(null, state.board), date: existing ? existing.date : Date.now() });
        ranks.sort(function (a, b) { return b.score - a.score || a.date - b.date; }); ranks = ranks.slice(0, 10);
        var persisted = write(ranksKey, ranks);
        state.name = result.name; state.submitted = state.score; saveProgress();
        var restart = restartAfterRecord; restartAfterRecord = false; dialog.close();
        if (restart) start(); else { render(); message(persisted ? '成绩已登记，本地榜单已更新。' : '成绩暂存在本次页面中，关闭页面后可能丢失。'); boardNode.focus({ preventScroll: true }); }
    });
    input.addEventListener('input', function () { input.setAttribute('aria-invalid', 'false'); $('[data-name-error]').textContent = ''; });
    document.addEventListener('keydown', function (event) {
        if (dialog.open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
        var key = event.key.toLowerCase(), direction = ({ arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' })[key];
        if (direction) { event.preventDefault(); move(direction); }
        else if (key === 'p' && !event.repeat) { event.preventDefault(); togglePause(); }
    });
    document.querySelectorAll('[data-direction]').forEach(function (button) { button.onclick = function () { move(button.dataset.direction); }; });
    boardNode.addEventListener('pointerdown', function (event) {
        if (!event.isPrimary || event.button !== 0) return;
        touch = { x: event.clientX, y: event.clientY, id: event.pointerId };
        boardNode.focus({ preventScroll: true }); boardNode.setPointerCapture(event.pointerId);
    });
    boardNode.addEventListener('pointerup', function (event) {
        if (!touch || touch.id !== event.pointerId) return;
        var dx = event.clientX - touch.x, dy = event.clientY - touch.y; touch = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
    boardNode.addEventListener('pointercancel', function () { touch = null; });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { paused = true; saveProgress(); render(); }
    });
    window.addEventListener('pagehide', saveProgress);
    window.addEventListener('storage', function (event) { if (event.key === ranksKey) { loadRanks(); renderRanks(); } });
    loadRanks();
    var saved = read(progressKey);
    if (saved && typeof saved.id === 'string' && saved.id.length <= 100 && engine.validBoard(saved.board) && saved.board.filter(Boolean).length >= 2 && validScore(saved.score)) {
        state = { id: saved.id, board: saved.board, score: saved.score, wonAck: saved.wonAck === true, submitted: validScore(saved.submitted) ? Math.min(saved.submitted, saved.score) : 0, name: engine.validateName(saved.name).ok ? engine.validateName(saved.name).name : '' };
        render(); message(engine.canMove(state.board) ? '已恢复上一次的棋盘，继续挑战吧。' : '本局已结束，可以登记成绩或开启新的一局。');
    } else start();
    function resizeParent() {
        if (window.parent !== window) window.parent.postMessage({ type: 'knight:arcade-height', height: Math.ceil(document.body.getBoundingClientRect().height) }, location.origin);
    }
    if (window.ResizeObserver) new ResizeObserver(resizeParent).observe(document.body);
    window.addEventListener('resize', resizeParent);
    window.addEventListener('load', resizeParent);
    resizeParent();
}());
