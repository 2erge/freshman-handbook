/* 校园新生手册 —— 前端渲染层（支持在线数据 / 后台草稿预览两种模式） */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var SLUG = params.get('s') || 'cqtbu';
  var PREVIEW = params.get('preview') === '1';
  /* 静态导出模式：GitHub Pages 等纯静态托管下，接口改为读取同目录的 .json 文件 */
  var STATIC = !!window.HANDBOOK_STATIC;
  function apiUrl(p) {
    if (!STATIC) return p;
    return p.replace(/^\//, '') + '.json';
  }
  var SCHOOL = null;
  var inbox = {}; // entryId -> 已解锁的 blocks

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /* **加粗** + 换行 */
  function inline(s) {
    var t = esc(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  /* ---------------- 渲染：整页 ---------------- */
  function renderSchool(data) {
    SCHOOL = data;
    var theme = data.theme || {};
    if (theme.primary) document.documentElement.style.setProperty('--primary', theme.primary);
    if (theme.bg) document.documentElement.style.setProperty('--bg', theme.bg);
    document.title = (data.name || '新生手册') + ' · 新生手册';

    $('#brandName').textContent = data.name || '';
    $('#brandSub').textContent = data.subtitle ? '· ' + data.subtitle : '';

    var page = $('#page');
    page.innerHTML = '';

    /* Banner */
    if (data.banner && (data.banner.title || data.banner.image)) {
      var bn = data.banner;
      var cover = bn.image && (bn.fit || 'cover') === 'cover';
      var b = el('div', 'banner' + (cover ? ' full' : '') + (cover && bn.textTone === 'light' ? ' light' : ''));

      if (!cover && bn.tint) {
        b.style.background = 'linear-gradient(160deg,' + bn.tint + ' 0%, #f1f6fc 55%, #f8f3ee 100%)';
      }

      if (cover) {
        var bg = el('img', 'bgimg');
        bg.src = bn.image;
        bg.alt = '';
        bg.onerror = function () { this.remove(); };
        b.appendChild(bg);
        var mask = el('div', 'bgmask');
        mask.style.background = overlayCss(bn.textTone === 'light' ? 'dark' : 'light', bn.overlay);
        b.appendChild(mask);
      } else if (bn.image) {
        var im = el('img', 'bi');
        im.src = bn.image;
        im.onerror = function () { this.remove(); };
        b.appendChild(im);
      }

      b.appendChild(el('div', 'bt', esc(bn.title || '')));
      if (bn.subtitle) b.appendChild(el('div', 'bs', esc(bn.subtitle)));
      page.appendChild(b);
    }

    /* 模块 */
    (data.sections || []).forEach(function (sec) {
      page.appendChild(renderSection(sec));
    });

    /* 页脚 */
    var f = data.footer || {};
    var foot = $('#footer');
    foot.innerHTML = '<div class="cp">' + esc(f.copyright || '') + '</div>';

    if (f.ctaText) {
      if ((f.ctaMode || 'contact') === 'contact') {
        var cbtn = el('button', 'cta cta-btn');
        cbtn.type = 'button';
        cbtn.appendChild(el('span', '', esc(f.ctaText)));
        cbtn.appendChild(el('i', 'cta-arrow', '›'));
        cbtn.addEventListener('click', function () { openContact(f); });
        foot.appendChild(cbtn);
      } else if (f.ctaUrl) {
        var clink = el('a', 'cta');
        clink.href = f.ctaUrl;
        clink.target = '_blank';
        clink.rel = 'noopener';
        clink.textContent = f.ctaText;
        foot.appendChild(clink);
      }
    }
  }

  /* ---------------- 联系学长（页脚名片弹层） ---------------- */
  function openContact(f) {
    closeSheet(true);
    var ct = (f && f.contact) || {};
    var wx = String(ct.wechatId || '').trim();
    var qr = String(ct.qr || '').trim();

    var mask = el('div', 'mask');
    var sheet = el('div', 'sheet sheet-contact');

    var head = el('div', 'sheet-head');
    head.appendChild(el('span', 'bar'));
    head.appendChild(el('h3', '', esc(ct.title || f.ctaText || '联系学长')));
    var x = el('button', 'sheet-close', '✕');
    x.addEventListener('click', function () { closeSheet(); });
    head.appendChild(x);
    sheet.appendChild(head);

    var body = el('div', 'sheet-body');
    var wrap = el('div', 'ct-wrap');

    if (ct.name) {
      wrap.appendChild(el('div', 'ct-name', esc(ct.name)));
    }

    if (qr) {
      var qbox = el('div', 'ct-qr');
      var qimg = el('img');
      qimg.src = qr;
      qimg.alt = '微信二维码';
      qimg.onerror = function () { this.remove(); };
      qbox.appendChild(qimg);
      wrap.appendChild(qbox);
    }

    if (wx) {
      var row = el('div', 'ct-id');
      var meta = el('div', 'ct-id-meta');
      meta.appendChild(el('span', 'ct-id-label', '微信号'));
      var val = el('span', 'ct-id-val', esc(wx));
      meta.appendChild(val);
      row.appendChild(meta);

      var copy = el('button', 'ct-copy', '复制');
      copy.type = 'button';
      copy.addEventListener('click', function () { copyText(wx, copy); });
      row.appendChild(copy);
      wrap.appendChild(row);
      val.addEventListener('click', function () { copyText(wx, copy); });
    }

    if (!qr && !wx) {
      wrap.appendChild(el('div', 'ct-empty', '学长还没留下联系方式，稍后再来看看。'));
    }

    if (ct.tip && (qr || wx)) wrap.appendChild(el('div', 'ct-tip', esc(ct.tip)));

    body.appendChild(wrap);
    sheet.appendChild(body);

    document.getElementById('sheetRoot').appendChild(mask);
    document.getElementById('sheetRoot').appendChild(sheet);
    requestAnimationFrame(function () { mask.classList.add('on'); sheet.classList.add('on'); });
    mask.addEventListener('click', function () { closeSheet(); });
  }

  /* 复制：安全上下文用 Clipboard API，局域网 http 回退到 execCommand */
  function copyText(text, btn) {
    var done = function (ok) {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = ok ? '已复制' : '请长按复制';
      btn.classList.toggle('ok', !!ok);
      setTimeout(function () {
        btn.textContent = old;
        btn.classList.remove('ok');
      }, 1600);
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function renderSection(sec) {
    var wrap = el('section', 'section');
    var head = el('div', 'sec-head');
    head.appendChild(el('div', 'sec-title', esc(sec.title || '')));
    var cnt = sec.countText || (sec.entries ? sec.entries.length + ' 项' : '');
    if (cnt) head.appendChild(el('div', 'sec-count', esc(cnt)));
    wrap.appendChild(head);

    var layout = sec.layout || 'grid';
    var box = el('div', layout === 'cards' ? 'cards' : layout === 'list' ? 'list' : 'grid');

    (sec.entries || []).forEach(function (e, i) {
      var it = el('div', 'item');
      if (layout === 'grid') {
        it.appendChild(el('div', 'ic', esc(e.icon || '📄')));
        it.appendChild(el('div', 'lb', esc(e.title)));
      } else if (layout === 'cards') {
        it.style.background = cardTint(i);
        it.appendChild(el('div', 'ic', esc(e.icon || '📄')));
        var cw = el('div');
        cw.appendChild(el('div', 'lb', esc(e.title)));
        if (e.subtitle) cw.appendChild(el('div', 'sb', esc(e.subtitle)));
        it.appendChild(cw);
      } else {
        var tw = el('div', 'txt');
        tw.appendChild(el('div', 'lb', esc(e.title)));
        if (e.subtitle) tw.appendChild(el('div', 'sb', esc(e.subtitle)));
        it.appendChild(tw);
        it.appendChild(el('div', 'ic', esc(e.icon || '📄')));
      }
      it.addEventListener('click', function () { openEntry(e); });
      box.appendChild(it);
    });

    wrap.appendChild(box);
    return wrap;
  }

  var TINTS = ['#f1f3f8', '#fce8f7', '#e7f8f5', '#fff3e0', '#eaf1ff', '#fdeaea'];
  function cardTint(i) { return TINTS[i % TINTS.length]; }

  /* 背景图遮罩：左浓右淡 + 底部压一层，保证标题与副标题都可读 */
  function overlayCss(tone, pct) {
    var a = pct == null || pct === '' ? 0.55 : Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
    var rgb = tone === 'dark' ? '0,0,0' : '255,255,255';
    var f = function (k) { return 'rgba(' + rgb + ',' + (a * k).toFixed(2) + ')'; };
    var side = 'linear-gradient(90deg,' + f(1) + ' 0%,' + f(0.62) + ' 52%,' + f(0.10) + ' 100%)';
    var bottom = 'linear-gradient(0deg,' + f(0.88) + ' 0%,' + f(0.46) + ' 24%,' + f(0) + ' 56%)';
    return bottom + ',' + side;
  }

  /* ---------------- 弹层 ---------------- */
  function openEntry(entry) {
    closeSheet(true);

    var mask = el('div', 'mask');
    var sheet = el('div', 'sheet');
    var head = el('div', 'sheet-head');
    head.appendChild(el('span', 'bar'));
    head.appendChild(el('h3', '', esc(entry.title)));
    var x = el('button', 'sheet-close', '✕');
    x.addEventListener('click', function () { closeSheet(); });
    head.appendChild(x);
    sheet.appendChild(head);

    var body = el('div', 'sheet-body');
    var wm = el('div', 'wm');
    wm.style.backgroundImage = watermarkUrl((SCHOOL && SCHOOL.watermark) || '');
    body.appendChild(wm);
    var content = el('div', 'sheet-content');
    body.appendChild(content);
    sheet.appendChild(body);

    document.getElementById('sheetRoot').appendChild(mask);
    document.getElementById('sheetRoot').appendChild(sheet);
    requestAnimationFrame(function () { mask.classList.add('on'); sheet.classList.add('on'); });
    mask.addEventListener('click', function () { closeSheet(); });

    if (entry.type === 'link' && entry.url) {
      content.innerHTML = '<div class="art-p">该入口指向外部链接。</div>' +
        '<a class="art-link" href="' + esc(entry.url) + '" target="_blank">打开链接 ↗</a>';
      return;
    }

    /* 预览模式：直接用草稿里的 blocks，不请求接口 */
    if (PREVIEW) {
      renderBlocks(content, entry.blocks || [], entry);
      return;
    }

    content.innerHTML = '';
    if (inbox[entry.id]) {
      renderBlocks(content, inbox[entry.id], entry);
      return;
    }
    content.innerHTML = '<div class="art-p" style="color:#9aa5b6">加载中…</div>';
    fetch(apiUrl('/api/entry/' + encodeURIComponent(SLUG) + '/' + encodeURIComponent(entry.id)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        content.innerHTML = '';
        renderBlocks(content, d.blocks || [], entry, d);
      })
      .catch(function () {
        content.innerHTML = '<div class="art-p">加载失败，请稍后重试。</div>';
      });
  }

  function closeSheet(immediate) {
    var root = document.getElementById('sheetRoot');
    if (!root.firstChild) return;
    var mask = root.querySelector('.mask');
    var sheet = root.querySelector('.sheet');
    if (mask) mask.classList.remove('on');
    if (sheet) sheet.classList.remove('on');
    if (immediate) { root.innerHTML = ''; return; }
    setTimeout(function () { root.innerHTML = ''; }, 300);
  }

  function watermarkUrl(text) {
    if (!text) return 'none';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="110">' +
      '<text x="20" y="60" font-size="13" fill="#0b1b33" fill-opacity="0.07" ' +
      'font-family="PingFang SC,Microsoft YaHei,sans-serif" transform="rotate(-22 20 60)">' +
      text.replace(/[<>&]/g, '') + '</text></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }

  /* ---------------- 渲染：正文块 ---------------- */
  function renderBlocks(root, blocks, entry, meta) {
    blocks.forEach(function (b) {
      root.appendChild(blockDom(b));
    });

    var lock = entry && entry.lock;
    var locked = meta ? meta.locked : (lock && lock.enabled && !PREVIEW);
    if (locked) {
      root.appendChild(lockDom(entry, meta && meta.lock));
    } else if (PREVIEW && lock && lock.enabled) {
      root.appendChild(el('div', 'pvw-note',
        '预览提示：该条目已开启密码墙，访客在此处只能看到前 ' +
        Math.round((lock.freeRatio || 0.2) * 100) + '% 正文。当前预览展示的是完整内容。'));
    }
    if (meta && meta.lock && meta.lock.contact && !locked) {
      root.appendChild(el('div', 'pvw-note', '联系方式：' + esc(meta.lock.contact)));
    }
  }

  function blockDom(b) {
    var n;
    switch (b.type) {
      case 'h2':
        n = el('div', 'art-h2');
        if (b.icon) n.appendChild(el('span', 'e', esc(b.icon)));
        n.appendChild(el('span', '', esc(b.text || '')));
        return n;
      case 'p':
        return el('p', 'art-p', inline(b.text || ''));
      case 'callout':
        return el('div', 'co ' + (b.tone || 'tip'), inline(b.text || ''));
      case 'list':
        n = el('ul', 'art-list');
        (b.items || []).forEach(function (i) { n.appendChild(el('li', '', inline(i))); });
        return n;
      case 'steps':
        n = el('ol', 'steps');
        (b.items || []).forEach(function (it, i) {
          var li = el('li');
          li.appendChild(el('div', 'n', String(i + 1)));
          var box = el('div');
          box.appendChild(el('div', 't', inline(it.t || '')));
          if (it.d) box.appendChild(el('div', 'd', inline(it.d)));
          li.appendChild(box);
          n.appendChild(li);
        });
        return n;
      case 'table':
        n = el('table', 'tb');
        if (b.head && b.head.length) {
          var thead = el('thead'); var tr = el('tr');
          b.head.forEach(function (h) { tr.appendChild(el('th', '', esc(h))); });
          thead.appendChild(tr); n.appendChild(thead);
        }
        var tb = el('tbody');
        (b.rows || []).forEach(function (row) {
          var r = el('tr');
          row.forEach(function (c) { r.appendChild(el('td', '', inline(c))); });
          tb.appendChild(r);
        });
        n.appendChild(tb);
        return n;
      case 'img':
        n = el('div', 'art-img');
        if (b.url) {
          var im = el('img'); im.src = b.url; im.alt = b.caption || '';
          im.onerror = function () { this.parentNode.querySelector('.ph') && (this.parentNode.querySelector('.ph').style.display = 'flex'); this.remove(); };
          n.appendChild(im);
        } else {
          n.appendChild(el('div', 'ph', '图片位（未设置 URL）'));
        }
        if (b.caption) n.appendChild(el('div', 'cap', esc(b.caption)));
        return n;
      case 'link':
        n = el('a', 'art-link', esc(b.text || '打开链接') + ' ↗');
        n.href = b.url || '#'; n.target = '_blank';
        return n;
      default:
        return el('p', 'art-p', inline(b.text || ''));
    }
  }

  function lockDom(entry, lockInfo) {
    var box = el('div', 'lock');
    var ratio = (lockInfo && lockInfo.freeRatio) || (entry.lock && entry.lock.freeRatio) || 0.2;
    box.innerHTML =
      '<div class="lic">🔒</div>' +
      '<div class="lt">已开放 ' + Math.round(ratio * 100) + '% 正文</div>' +
      '<div class="lh">后续内容已隐藏</div>' +
      '<div class="ld">设置密码是因为部分文件仅限本校同学查看。<br>如需完整内容，请联系管理员获取访问密码。</div>';
    if (lockInfo && lockInfo.contact) box.appendChild(el('div', 'lk', '联系方式：' + esc(lockInfo.contact)));

    var row = el('div', 'row');
    var input = el('input');
    input.type = 'password'; input.placeholder = '输入访问密码';
    var btn = el('button', '', '继续查看');
    row.appendChild(input); row.appendChild(btn);
    box.appendChild(row);
    var err = el('div', 'err');
    box.appendChild(err);

    function submit() {
      var pw = input.value.trim();
      if (!pw) { err.textContent = '请输入密码'; return; }
      if (STATIC) { err.textContent = '这是离线静态版本，请在联网的原站解锁'; return; }
      btn.disabled = true; btn.textContent = '验证中…';
      fetch('/api/entry/' + encodeURIComponent(SLUG) + '/' + encodeURIComponent(entry.id) + '/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw })
      }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (res.ok) {
            inbox[entry.id] = res.d.blocks;
            closeSheet(true);
            openEntry(entry);
          } else {
            err.textContent = res.d.error || '密码不正确';
            btn.disabled = false; btn.textContent = '继续查看';
          }
        })
        .catch(function () {
          err.textContent = '网络异常，请重试';
          btn.disabled = false; btn.textContent = '继续查看';
        });
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    return box;
  }

  /* ---------------- 搜索 ---------------- */
  var allEntries = [];
  function buildIndex() {
    allEntries = [];
    (SCHOOL.sections || []).forEach(function (s) {
      (s.entries || []).forEach(function (e) {
        allEntries.push({ entry: e, section: s.title });
      });
    });
  }

  function doSearch(kw) {
    var page = $('#page');
    kw = kw.trim().toLowerCase();
    if (!kw) { renderSchool(SCHOOL); return; }
    var hits = allEntries.filter(function (x) {
      return (x.entry.title + ' ' + (x.entry.subtitle || '') + ' ' + (x.section || '')).toLowerCase().indexOf(kw) >= 0;
    });
    page.innerHTML = '';
    if (!hits.length) {
      page.appendChild(el('div', 'search-empty', '没有找到「' + esc(kw) + '」相关内容'));
      return;
    }
    var box = el('div', 'search-hit');
    hits.forEach(function (x) {
      var row = el('div', 'row');
      row.appendChild(el('div', 'ic', esc(x.entry.icon || '📄')));
      var txt = el('div', 'txt');
      txt.appendChild(el('div', 't', esc(x.entry.title)));
      txt.appendChild(el('div', 's', esc(x.section)));
      row.appendChild(txt);
      row.addEventListener('click', function () { openEntry(x.entry); });
      box.appendChild(row);
    });
    page.appendChild(box);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    if (PREVIEW) {
      document.getElementById('pvwBadge').hidden = false;
      window.parent.postMessage({ type: 'preview-ready' }, '*');
      window.addEventListener('message', function (ev) {
        var m = ev.data || {};
        if (m.type !== 'render') return;
        renderSchool(m.data);
        buildIndex();
        if (m.openEntry) {
          var found = null;
          (m.data.sections || []).forEach(function (s) {
            (s.entries || []).forEach(function (e) { if (e.id === m.openEntry) found = e; });
          });
          if (found) openEntry(found); else closeSheet(true);
        } else {
          closeSheet(true);
        }
      });
      return;
    }

    fetch(apiUrl('/api/school/' + encodeURIComponent(SLUG)))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { document.getElementById('page').innerHTML = '<div class="search-empty">' + esc(d.error) + '</div>'; return; }
        renderSchool(d);
        buildIndex();
      })
      .catch(function () {
        document.getElementById('page').innerHTML = '<div class="search-empty">加载失败，请检查后端是否启动</div>';
      });

    var sb = $('#searchbar');
    var input = $('#searchInput');
    $('#btnSearch').addEventListener('click', function () {
      sb.classList.toggle('on');
      if (sb.classList.contains('on')) input.focus();
      else { input.value = ''; if (SCHOOL) renderSchool(SCHOOL); }
    });
    $('#searchCancel').addEventListener('click', function () {
      sb.classList.remove('on'); input.value = '';
      if (SCHOOL) renderSchool(SCHOOL);
    });
    input.addEventListener('input', function () { if (SCHOOL) doSearch(input.value); });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
