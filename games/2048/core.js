(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Knight2048 = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function spawn(board, random) {
        random = random || Math.random;
        var next = board.slice(), empty = [];
        next.forEach(function (n, i) { if (!n) empty.push(i); });
        if (empty.length) next[empty[Math.floor(random() * empty.length)]] = random() < .9 ? 2 : 4;
        return next;
    }
    function initial(random) { return spawn(spawn(Array(16).fill(0), random), random); }
    function move(board, direction) {
        var next = board.slice(), gained = 0;
        if (['left', 'right', 'up', 'down'].indexOf(direction) < 0) throw new Error('Invalid direction');
        for (var line = 0; line < 4; line++) {
            var indexes = [];
            for (var k = 0; k < 4; k++) {
                indexes.push(direction === 'left' ? line * 4 + k : direction === 'right' ? line * 4 + 3 - k
                    : direction === 'up' ? k * 4 + line : (3 - k) * 4 + line);
            }
            var values = indexes.map(function (i) { return board[i]; }).filter(Boolean), merged = [];
            for (var j = 0; j < values.length; j++) {
                if (values[j] === values[j + 1]) { var value = values[j] * 2; merged.push(value); gained += value; j++; }
                else merged.push(values[j]);
            }
            indexes.forEach(function (i, k) { next[i] = merged[k] || 0; });
        }
        return { board: next, gained: gained, changed: next.some(function (n, i) { return n !== board[i]; }) };
    }
    function canMove(board) {
        return board.some(function (n, i) {
            return !n || (i % 4 < 3 && n === board[i + 1]) || (i < 12 && n === board[i + 4]);
        });
    }
    // Keep this local list editable. Client filtering cannot cover every euphemism.
    var blocked = ['傻逼','傻比','煞笔','傻屄','沙比','煞比','草泥马','操你','艹你','曹尼玛','妈逼','妈批','妈的','你妈','尼玛','日你','狗日','婊子','贱人','畜生','去死','滚蛋','妓女','鸡巴','几把','阴茎','阴道','精液','肛交','口交','做爱','强奸','轮奸','约炮','裸聊','色情','黄色网站','迷奸','卖淫','嫖娼','法轮','邪教','纳粹','希特勒','恐怖分子','台独','疆独','藏独','六四','天安门事件','习近平','毛泽东','共产党','fuck','fuk','shit','bitch','cunt','nigger','nigga','asshole','dick','porn','pussy','sex','cao ni ma','cnm','nmsl','tmd','sb'];
    function validateName(raw) {
        var name = String(raw || '').normalize('NFKC').trim();
        if (!/^[\p{Script=Han}A-Za-z0-9]{2,10}$/u.test(name)) return { ok: false, error: '请输入 2–10 个汉字、字母或数字，不含空格和符号。' };
        var lower = name.toLowerCase();
        var candidates = [lower.replace(/\d/g, ''), lower.replace(/[014]/g, function (c) { return ({'0':'o','1':'i','4':'a'})[c]; }).replace(/\d/g, '')];
        if (blocked.some(function (term) { return candidates.some(function (value) { return value.indexOf(term.replace(/\s/g, '')) >= 0; }); }))
            return { ok: false, error: '这个名称含有不适合展示的词，请换一个名称。' };
        return { ok: true, name: name };
    }
    function validBoard(board) {
        return Array.isArray(board) && board.length === 16 && board.every(function (v) {
            return Number.isSafeInteger(v) && v >= 0 && (v === 0 || (v >= 2 && v <= 131072 && Number.isInteger(Math.log2(v))));
        });
    }
    return { spawn: spawn, initial: initial, move: move, canMove: canMove, validateName: validateName, validBoard: validBoard };
}));
