/* 校园新生手册 —— 内容后台 */
(function () {
  'use strict';

  var state = {
    token: null,
    schools: [],
    slug: null,
    draft: null,
    sel: { type: 'school' },
    dirty: false
  };

  var $ = function (s) { return document.querySelector(s); };

  /* ---------------- 基础工具 ---------------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
    if (state.token) opts.headers.authorization = 'Bearer ' + state.token;
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, d: d };
      });
    });
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function markDirty() {
    if (state.dirty) return;
    state.dirty = true;
    var s = $('#status');
    s.textContent = '有未保存修改';
    s.classList.add('dirty');
  }
  function markClean() {
    state.dirty = false;
    var s = $('#status');
    s.textContent = '已保存';
    s.classList.remove('dirty');
  }

  /* ---------------- 表单构件 ---------------- */
  function field(labelText, el, hint) {
    var w = document.createElement('div');
    w.className = 'field';
    if (labelText) {
      var l = document.createElement('label');
      l.textContent = labelText;
      w.appendChild(l);
    }
    w.appendChild(el);
    if (hint) {
      var h = document.createElement('div');
      h.className = 'hint';
      h.innerHTML = hint;
      w.appendChild(h);
    }
    return w;
  }

  function bind(obj, key, opts) {
    opts = opts || {};
    return function (e) {
      var v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (opts.number) v = Number(v) || 0;
      obj[key] = v;
      markDirty();
      if (opts.rerender) renderAll();
      else schedulePreview();
    };
  }

  function input(obj, key, opts) {
    opts = opts || {};
    var i = document.createElement('input');
    i.type = 'text';
    i.value = obj[key] == null ? '' : obj[key];
    if (opts.placeholder) i.placeholder = opts.placeholder;
    i.addEventListener('input', bind(obj, key, opts));
    return i;
  }

  function area(obj, key, rows, opts) {
    opts = opts || {};
    var t = document.createElement('textarea');
    t.value = obj[key] == null ? '' : obj[key];
    t.rows = rows || 4;
    if (opts.mono) t.className = 'mono';
    if (opts.placeholder) t.placeholder = opts.placeholder;
    t.addEventListener('input', bind(obj, key, opts));
    return t;
  }

  function select(obj, key, options, opts) {
    opts = opts || {};
    var s = document.createElement('select');
    options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value; op.textContent = o.label;
      if (obj[key] === o.value) op.selected = true;
      s.appendChild(op);
    });
    s.addEventListener('change', bind(obj, key, opts));
    return s;
  }

  function check(obj, key, label, opts) {
    var w = document.createElement('label');
    w.className = 'inline-check switch';
    var c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!obj[key];
    c.addEventListener('change', bind(obj, key, opts));
    w.appendChild(c);
    w.appendChild(document.createTextNode(label));
    return w;
  }

  /* ---------------- 图片上传控件 ---------------- */
  var MAX_IMG = 8 * 1024 * 1024;

  function uploadImage(file) {
    return fetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'content-type': file.type, authorization: 'Bearer ' + state.token },
      body: file
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, d: d };
      });
    });
  }

  /**
   * 图片字段：可点选、可拖入、也可直接粘 URL。
   * opts.ratio 控制预览框比例（如 '16/9'）；opts.hint 给额外说明。
   */
  function imageField(obj, key, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'imgfield';
    if (opts.max) wrap.style.maxWidth = opts.max;

    var box = document.createElement('div');
    box.className = 'imgbox';
    if (opts.ratio) box.style.setProperty('--ar', opts.ratio);
    box.title = '点击选择图片，或把图片拖进来';

    var img = document.createElement('img');
    img.alt = '';
    var ph = document.createElement('div');
    ph.className = 'ph';
    var PH_TEXT = '<b>点击选择图片</b><span>或把图片拖到这里</span>';
    ph.innerHTML = PH_TEXT;

    box.appendChild(img);
    box.appendChild(ph);

    var file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp,image/gif';
    file.hidden = true;

    var bar = document.createElement('div');
    bar.className = 'imgbar';
    var pick = btn('选择图片', 'ghost small', function () { file.click(); });
    var clearBtn = btn('清除', 'ghost small', function () {
      obj[key] = '';
      urlInput.value = '';
      paint();
      markDirty(); schedulePreview();
    });
    bar.appendChild(pick);
    bar.appendChild(clearBtn);

    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'imgurl';
    urlInput.placeholder = '也可以直接填图片地址 https://…';
    urlInput.value = obj[key] == null ? '' : obj[key];
    urlInput.addEventListener('input', function () {
      obj[key] = urlInput.value.trim();
      paint();
      markDirty(); schedulePreview();
    });

    wrap.appendChild(box);
    wrap.appendChild(file);
    wrap.appendChild(bar);
    wrap.appendChild(urlInput);

    function paint() {
      var v = obj[key] || '';
      if (v) {
        if (img.getAttribute('src') !== v) img.src = v;
        img.style.display = 'block';
        ph.style.display = 'none';
        box.classList.add('has');
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        ph.style.display = 'flex';
        ph.innerHTML = PH_TEXT;
        box.classList.remove('has');
      }
      clearBtn.disabled = !v;
    }

    function doUpload(f) {
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast('请选择图片文件'); return; }
      if (f.size > MAX_IMG) { toast('图片超过 8MB，请先压缩'); return; }
      box.classList.add('busy');
      img.style.display = 'none';
      ph.style.display = 'flex';
      ph.innerHTML = '<b>上传中…</b><span>' + Math.round(f.size / 1024) + ' KB</span>';
      uploadImage(f).then(function (res) {
        box.classList.remove('busy');
        if (!res.ok) { toast(res.d.error || '上传失败'); paint(); return; }
        obj[key] = res.d.url;
        urlInput.value = res.d.url;
        paint();
        markDirty(); schedulePreview();
        toast('已上传，记得点右上角「保存」');
      }).catch(function () {
        box.classList.remove('busy');
        toast('上传失败，请确认后端在运行');
        paint();
      });
    }

    box.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      doUpload(file.files && file.files[0]);
      file.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      box.addEventListener(t, function (e) { e.preventDefault(); box.classList.add('drag'); });
    });
    ['dragleave', 'dragend'].forEach(function (t) {
      box.addEventListener(t, function () { box.classList.remove('drag'); });
    });
    box.addEventListener('drop', function (e) {
      e.preventDefault();
      box.classList.remove('drag');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      doUpload(f);
    });

    paint();
    return wrap;
  }

  function card(title, desc) {
    var c = document.createElement('div');
    c.className = 'card';
    if (title) {
      var h = document.createElement('h2');
      h.textContent = title;
      c.appendChild(h);
    }
    if (desc) {
      var d = document.createElement('div');
      d.className = 'desc';
      d.textContent = desc;
      c.appendChild(d);
    }
    return c;
  }

  function btn(text, cls, fn) {
    var b = document.createElement('button');
    b.textContent = text;
    b.className = cls || 'ghost';
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------------- 数据加载 ---------------- */
  function loadSchools() {
    return api('/api/schools').then(function (r) {
      state.schools = r.d || [];
      var sel = $('#schoolSel');
      sel.innerHTML = '';
      state.schools.forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.slug; o.textContent = s.name;
        sel.appendChild(o);
      });
      if (!state.slug && state.schools[0]) state.slug = state.schools[0].slug;
      sel.value = state.slug;
    });
  }

  function loadSchool(slug) {
    return api('/api/admin/school/' + slug).then(function (r) {
      if (!r.ok) { toast(r.d.error || '读取失败'); return; }
      state.draft = clone(r.d);
      state.sel = { type: 'school' };
      ensureDefaults();
      markClean();
      renderAll();
      setFrame(slug);
    });
  }

  function ensureDefaults() {
    var d = state.draft;
    d.theme = d.theme || { primary: '#2f6bff', bg: '#eef3fb' };
    d.banner = d.banner || { title: '', subtitle: '', image: '', tint: '#dfeaf7' };
    d.footer = d.footer || { copyright: '', ctaText: '', ctaUrl: '' };
    d.footer.ctaMode = d.footer.ctaMode || 'contact';
    d.footer.contact = d.footer.contact || {};
    var fc = d.footer.contact;
    if (fc.name == null) fc.name = '';
    if (fc.wechatId == null) fc.wechatId = '';
    if (fc.qr == null) fc.qr = '';
    if (fc.tip == null) fc.tip = '长按识别二维码，或复制微信号添加';
    d.sections = d.sections || [];
    d.sections.forEach(function (s) {
      s.entries = s.entries || [];
      s.entries.forEach(function (e) {
        e.blocks = e.blocks || [];
        e.lock = e.lock || { enabled: false, freeRatio: 0.2, password: '', contact: '' };
      });
    });
  }

  /* ---------------- 预览 ---------------- */
  var pvTimer = null;
  function schedulePreview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(pushPreview, 320);
  }
  function setFrame(slug) {
    var f = $('#pvFrame');
    f.src = '/?s=' + encodeURIComponent(slug) + '&preview=1';
    $('#pvFoot').textContent = '预览地址 /?s=' + slug;
  }
  function pushPreview() {
    if (!state.draft) return;
    var f = $('#pvFrame');
    if (!f.contentWindow) return;
    var openEntry = state.sel.type === 'entry' ? currentEntry().id : null;
    f.contentWindow.postMessage({ type: 'render', data: clone(state.draft), openEntry: openEntry }, '*');
  }

  /* ---------------- 树 ---------------- */
  function renderTree() {
    var t = $('#tree');
    t.innerHTML = '';

    var g = document.createElement('div');
    g.className = 'tree-group';
    var item = document.createElement('div');
    item.className = 'tree-item' + (state.sel.type === 'school' ? ' active' : '');
    item.innerHTML = '<span class="ic">🏫</span><span class="tx">学校基础信息</span>';
    item.addEventListener('click', function () { state.sel = { type: 'school' }; renderAll(); });
    g.appendChild(item);
    t.appendChild(g);

    var head = document.createElement('div');
    head.className = 'tree-sec-head';
    head.innerHTML = '<span>内容模块</span>';
    head.appendChild(btn('＋ 模块', '', addSection));
    t.appendChild(head);

    (state.draft.sections || []).forEach(function (s, si) {
      var sec = document.createElement('div');
      sec.className = 'tree-item' + (state.sel.type === 'section' && state.sel.si === si ? ' active' : '');
      sec.innerHTML = '<span class="ic">▤</span><span class="tx"></span>';
      sec.querySelector('.tx').textContent = s.title || '未命名模块';
      sec.addEventListener('click', function () { state.sel = { type: 'section', si: si }; renderAll(); });

      var del = document.createElement('button');
      del.className = 'mini';
      del.textContent = '✕';
      del.title = '删除模块';
      del.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!confirm('删除模块「' + (s.title || '') + '」及其下所有条目？')) return;
        state.draft.sections.splice(si, 1);
        state.sel = { type: 'school' };
        markDirty(); renderAll();
      });
      sec.appendChild(del);
      t.appendChild(sec);

      (s.entries || []).forEach(function (e, ei) {
        var row = document.createElement('div');
        row.className = 'tree-item child' + (state.sel.type === 'entry' && state.sel.si === si && state.sel.ei === ei ? ' active' : '');
        row.innerHTML = '<span class="ic"></span><span class="tx"></span>';
        row.querySelector('.ic').textContent = e.icon || '📄';
        row.querySelector('.tx').textContent = e.title || '未命名条目';
        row.addEventListener('click', function () { state.sel = { type: 'entry', si: si, ei: ei }; renderAll(); });
        t.appendChild(row);
      });
    });
  }

  /* ---------------- 表单 ---------------- */
  function renderForm() {
    var f = $('#form');
    f.innerHTML = '';
    if (!state.draft) return;
    if (state.sel.type === 'school') return renderSchoolForm(f);
    if (state.sel.type === 'section') return renderSectionForm(f);
    if (state.sel.type === 'entry') return renderEntryForm(f);
  }

  function renderSchoolForm(f) {
    var d = state.draft;

    var c1 = card('学校信息', '展示在页面顶部与分享卡片上');
    var g1 = document.createElement('div');
    g1.className = 'grid2';
    g1.appendChild(field('学校名称', input(d, 'name', { rerender: true })));
    g1.appendChild(field('副标题', input(d, 'subtitle', { placeholder: '连接世界 · 从这里开始' })));
    c1.appendChild(g1);
    var g1b = document.createElement('div');
    g1b.className = 'grid2';
    g1b.appendChild(field('正文水印文字', input(d, 'watermark', { placeholder: '如：新生手册 / 学校名' }), '出现在每篇正文背后的浅色斜排文字'));
    var colors = document.createElement('div');
    colors.className = 'grid2';
    var pi = document.createElement('input');
    pi.type = 'text'; pi.value = d.theme.primary || '#2f6bff';
    pi.addEventListener('input', function () { d.theme.primary = pi.value; markDirty(); schedulePreview(); });
    colors.appendChild(field('主题色', pi, '十六进制色值，如 #2f6bff'));
    var bg = document.createElement('input');
    bg.type = 'text'; bg.value = d.theme.bg || '#eef3fb';
    bg.addEventListener('input', function () { d.theme.bg = bg.value; markDirty(); schedulePreview(); });
    colors.appendChild(field('页面底色', bg));
    g1b.appendChild(field('配色', colors));
    c1.appendChild(g1b);
    f.appendChild(c1);

    var c2 = card('首屏 Banner', '第一屏的大图区域。可以直接上传本地图片，也可以只填一个渐变色。');
    c2.appendChild(field('主标题', area(d.banner, 'title', 2), '支持换行，用回车分行'));
    c2.appendChild(field('副标题', input(d.banner, 'subtitle')));
    c2.appendChild(field('背景图', imageField(d.banner, 'image', { ratio: '16/9' }),
      '支持 JPG / PNG / WebP / GIF，单张 ≤ 8MB。上传后自动存到 <b>uploads/</b> 目录，前台与预览同步生效。'));

    var gTone = document.createElement('div');
    gTone.className = 'grid2';
    gTone.appendChild(field('图片用法', select(d.banner, 'fit', [
      { value: 'cover', label: '整幅铺满背景（推荐）' },
      { value: 'side', label: '右侧半幅切图（原版）' }
    ], { rerender: true }), '整幅铺满时文字压在图片上，用下面的遮罩保证可读'));
    gTone.appendChild(field('文字颜色', select(d.banner, 'textTone', [
      { value: 'dark', label: '深色文字（浅色遮罩）' },
      { value: 'light', label: '白色文字（深色遮罩）' }
    ], { rerender: true })));
    c2.appendChild(gTone);

    var ovWrap = document.createElement('div');
    var oi = document.createElement('input');
    oi.type = 'number'; oi.min = '0'; oi.max = '100'; oi.step = '5';
    oi.value = d.banner.overlay == null ? 55 : d.banner.overlay;
    oi.addEventListener('input', function () {
      d.banner.overlay = Math.max(0, Math.min(100, Number(oi.value) || 0));
      markDirty(); schedulePreview();
    });
    ovWrap.appendChild(field('遮罩浓度（%）', oi, '0 = 图片完全露出，100 = 几乎全白（或全黑）'));
    c2.appendChild(ovWrap);

    c2.appendChild(field('渐变底色', input(d.banner, 'tint', { placeholder: '#dfeaf7' }),
      '仅在没有背景图、或使用「右侧半幅切图」时生效'));
    f.appendChild(c2);

    var c3 = card('页脚', '底部版权文案，以及「联系学长」按钮');
    c3.appendChild(field('版权文案', input(d.footer, 'copyright')));
    var g3 = document.createElement('div');
    g3.className = 'grid2';
    g3.appendChild(field('按钮文字', input(d.footer, 'ctaText', { placeholder: '联系学长' })));
    g3.appendChild(field('点击后', select(d.footer, 'ctaMode', [
      { value: 'contact', label: '弹出联系名片' },
      { value: 'link', label: '跳转外部链接' }
    ], { rerender: true }), '留空则整条按钮不显示'));
    c3.appendChild(g3);
    if (d.footer.ctaMode === 'link') {
      c3.appendChild(field('链接地址', input(d.footer, 'ctaUrl', { placeholder: 'https://…' })));
    }
    f.appendChild(c3);

    var fc = d.footer.contact;
    var c4 = card('联系学长名片', '点页脚按钮后弹出；二维码与微信号都留空时，前台显示「稍后再来」');
    c4.appendChild(field('称呼', input(fc, 'name', { placeholder: '例如：荣~荣学长' }), '显示在二维码上方，可留空'));
    c4.appendChild(field('微信号', input(fc, 'wechatId', { placeholder: '填微信号，前台可一键复制' }),
      '必填项之一：填了才出现「复制微信号」那一行'));
    c4.appendChild(field('微信二维码', imageField(fc, 'qr', { ratio: '1/1', max: '190px' }),
      '正方形图效果最好，建议 ≥ 500×500；可点选、可拖入、也可填图片地址'));
    c4.appendChild(field('底部提示', input(fc, 'tip', { placeholder: '长按识别二维码，或复制微信号添加' })));
    f.appendChild(c4);

    var tip = card('接下来');
    tip.appendChild(Object.assign(document.createElement('div'), {
      className: 'desc',
      innerHTML: '左侧选择「内容模块」编辑首页的各个板块；点开模块下的条目可编辑正文。<br>' +
        '前台访问地址：<b>/?s=' + state.slug + '</b>'
    }));
    f.appendChild(tip);
  }

  function renderSectionForm(f) {
    var s = state.draft.sections[state.sel.si];
    var c = card('模块设置', '一个模块对应首页上的一张卡片');
    var g = document.createElement('div');
    g.className = 'grid2';
    g.appendChild(field('模块标题', input(s, 'title', { rerender: true })));
    g.appendChild(field('布局样式', select(s, 'layout', [
      { value: 'grid', label: '图标网格（5 列，如「新生必看」）' },
      { value: 'cards', label: '横滑卡片（如「校园介绍」）' },
      { value: 'list', label: '双列列表（如「更多服务」）' }
    ], { rerender: true })));
    c.appendChild(g);
    var g2 = document.createElement('div');
    g2.className = 'grid2';
    g2.appendChild(field('右上角计数文案', input(s, 'countText', { placeholder: '留空则自动显示「N 项」' })));
    g2.appendChild(field('是否显示', check(s, 'visible', '在前台显示该模块', { rerender: true })));
    c.appendChild(g2);
    f.appendChild(c);

    var c2 = card('模块内条目', '共 ' + (s.entries || []).length + ' 条');
    var tools = document.createElement('div');
    tools.className = 'row-tools';
    tools.appendChild(btn('＋ 添加条目', 'primary', function () {
      s.entries.push({
        id: uid('e'), title: '新条目', subtitle: '', icon: '📄', type: 'article',
        url: '', lock: { enabled: false, freeRatio: 0.2, password: '', contact: '' },
        blocks: [{ type: 'p', text: '在这里写正文…' }]
      });
      state.sel = { type: 'entry', si: state.sel.si, ei: s.entries.length - 1 };
      markDirty(); renderAll();
    }));
    tools.appendChild(btn('↑ 模块上移', 'ghost', function () { moveItem(state.draft.sections, state.sel.si, -1); }));
    tools.appendChild(btn('↓ 模块下移', 'ghost', function () { moveItem(state.draft.sections, state.sel.si, 1); }));
    c2.appendChild(tools);

    (s.entries || []).forEach(function (e, ei) {
      var row = makeEntryRow(e, ei, state.sel.si);
      c2.appendChild(row);
    });
    if (!s.entries.length) {
      var d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '还没有条目，点上面的「＋ 添加条目」开始。';
      c2.appendChild(d);
    }
    f.appendChild(c2);
  }

  function makeEntryRow(e, ei, si) {
    var row = document.createElement('div');
    row.className = 'erow' + (state.sel.type === 'entry' && state.sel.si === si && state.sel.ei === ei ? ' active' : '');
    row.innerHTML = '<span class="ic"></span><span class="tx"></span><span class="ops"></span>';
    row.querySelector('.ic').textContent = e.icon || '📄';
    var tx = row.querySelector('.tx');
    tx.textContent = e.title || '未命名';
    if (e.lock && e.lock.enabled) {
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = '🔒 密码墙';
      tx.appendChild(sub);
    }
    var ops = row.querySelector('.ops');
    ops.appendChild(mkOp('↑', function (ev) { ev.stopPropagation(); moveItem(state.draft.sections[si].entries, ei, -1); }));
    ops.appendChild(mkOp('↓', function (ev) { ev.stopPropagation(); moveItem(state.draft.sections[si].entries, ei, 1); }));
    ops.appendChild(mkOp('✕', function (ev) {
      ev.stopPropagation();
      if (!confirm('删除条目「' + (e.title || '') + '」？')) return;
      state.draft.sections[si].entries.splice(ei, 1);
      state.sel = { type: 'section', si: si };
      markDirty(); renderAll();
    }));
    row.addEventListener('click', function () {
      state.sel = { type: 'entry', si: si, ei: ei };
      renderAll();
    });
    return row;
  }

  function mkOp(text, fn) {
    var b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  function moveItem(arr, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= arr.length) return;
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    if (state.sel.type === 'entry') state.sel.ei = j;
    if (state.sel.type === 'section') state.sel.si = j;
    markDirty(); renderAll();
  }

  function currentEntry() {
    return state.draft.sections[state.sel.si].entries[state.sel.ei];
  }

  function renderEntryForm(f) {
    var e = currentEntry();
    var s = state.draft.sections[state.sel.si];

    var c0 = card('所属模块', s.title + ' · 第 ' + (state.sel.ei + 1) + ' 条');
    var tools = document.createElement('div');
    tools.className = 'row-tools';
    tools.appendChild(btn('← 返回模块', 'ghost', function () {
      state.sel = { type: 'section', si: state.sel.si }; renderAll();
    }));
    c0.appendChild(tools);
    f.appendChild(c0);

    var c = card('条目信息', '标题与图标决定它在首页的样子');
    var g = document.createElement('div');
    g.className = 'grid2';
    g.appendChild(field('标题', input(e, 'title', { rerender: true })));
    g.appendChild(field('图标（emoji）', input(e, 'icon', { placeholder: '📶', rerender: true }), '直接粘一个 emoji，如 📶 🛏️ 🎓'));
    c.appendChild(g);
    var g2 = document.createElement('div');
    g2.className = 'grid2';
    g2.appendChild(field('副标题', input(e, 'subtitle', { placeholder: '横滑卡片/列表里的小字' })));
    g2.appendChild(field('类型', select(e, 'type', [
      { value: 'article', label: '图文正文（弹层打开）' },
      { value: 'link', label: '外部链接 / 跳转' }
    ], { rerender: true })));
    c.appendChild(g2);
    if (e.type === 'link') {
      c.appendChild(field('跳转地址', input(e, 'url', { placeholder: 'https://… 或小程序页面路径' })));
    }
    f.appendChild(c);

    if (e.type === 'article') {
      f.appendChild(lockCard(e));
      f.appendChild(blocksCard(e));
    }
  }

  function lockCard(e) {
    var c = card('密码墙（可选）', '只放出前面一部分内容，剩下的需要输入密码');
    c.appendChild(check(e.lock, 'enabled', '启用密码墙', { rerender: true }));
    if (e.lock.enabled) {
      var g = document.createElement('div');
      g.className = 'grid3';
      var ratioWrap = document.createElement('div');
      var ri = document.createElement('input');
      ri.type = 'number'; ri.min = '5'; ri.max = '100'; ri.step = '5';
      ri.value = Math.round((e.lock.freeRatio || 0.2) * 100);
      ri.addEventListener('input', function () {
        e.lock.freeRatio = Math.max(0.05, Math.min(1, (Number(ri.value) || 20) / 100));
        markDirty(); schedulePreview();
      });
      ratioWrap.appendChild(field('免费比例（%）', ri, '按正文字数计'));
      g.appendChild(ratioWrap);
      g.appendChild(field('访问密码', input(e.lock, 'password', { placeholder: '如 1234' })));
      g.appendChild(field('联系方式', input(e.lock, 'contact', { placeholder: '微信：xxx' })));
      c.appendChild(g);
    }
    return c;
  }

  var BLOCK_TYPES = [
    { value: 'p', label: '段落' },
    { value: 'h2', label: '小标题' },
    { value: 'table', label: '表格' },
    { value: 'callout', label: '提示块' },
    { value: 'list', label: '要点列表' },
    { value: 'steps', label: '步骤' },
    { value: 'img', label: '图片' },
    { value: 'link', label: '链接' }
  ];
  function blockLabel(t) {
    for (var i = 0; i < BLOCK_TYPES.length; i++) if (BLOCK_TYPES[i].value === t) return BLOCK_TYPES[i].label;
    return '段落';
  }
  function blankBlock(t) {
    switch (t) {
      case 'h2': return { type: 'h2', icon: '', text: '小标题' };
      case 'table': return { type: 'table', head: ['项目', '说明'], rows: [['', '']] };
      case 'callout': return { type: 'callout', tone: 'tip', text: '' };
      case 'list': return { type: 'list', items: ['要点一'] };
      case 'steps': return { type: 'steps', items: [{ t: '第一步', d: '' }] };
      case 'img': return { type: 'img', url: '', caption: '' };
      case 'link': return { type: 'link', text: '打开链接', url: '' };
      default: return { type: 'p', text: '' };
    }
  }

  function blocksCard(e) {
    var c = card('正文内容', '正文由「块」组成，可以自由排序。编辑时右侧实时预览。');
    var tools = document.createElement('div');
    tools.className = 'row-tools';
    var sel = document.createElement('select');
    BLOCK_TYPES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.value; o.textContent = t.label;
      sel.appendChild(o);
    });
    tools.appendChild(sel);
    tools.appendChild(btn('＋ 追加块', 'primary', function () {
      e.blocks.push(blankBlock(sel.value));
      markDirty(); renderAll();
    }));
    c.appendChild(tools);

    (e.blocks || []).forEach(function (b, bi) {
      c.appendChild(blockEditor(e, b, bi));
    });
    if (!e.blocks.length) {
      var d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '还没有内容，先追加一个「段落」吧。';
      c.appendChild(d);
    }
    return c;
  }

  function blockEditor(entry, b, bi) {
    var w = document.createElement('div');
    w.className = 'block';

    var head = document.createElement('div');
    head.className = 'block-head';
    var tsel = document.createElement('select');
    BLOCK_TYPES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.value; o.textContent = t.label;
      if (t.value === b.type) o.selected = true;
      tsel.appendChild(o);
    });
    tsel.addEventListener('change', function () {
      var nb = blankBlock(tsel.value);
      entry.blocks[bi] = nb;
      markDirty(); renderAll();
    });
    head.appendChild(tsel);
    head.appendChild(document.createTextNode('#' + (bi + 1)));
    var sp = document.createElement('span'); sp.className = 'sp';
    head.appendChild(sp);
    head.appendChild(mkOp('↑', function () { moveItem(entry.blocks, bi, -1); }));
    head.appendChild(mkOp('↓', function () { moveItem(entry.blocks, bi, 1); }));
    var del = mkOp('✕', function () {
      entry.blocks.splice(bi, 1);
      markDirty(); renderAll();
    });
    head.appendChild(del);
    w.appendChild(head);

    var body = document.createElement('div');
    body.className = 'block-body';

    if (b.type === 'p') {
      body.appendChild(field('文字', area(b, 'text', 4, { placeholder: '支持 **加粗**' })));
    } else if (b.type === 'h2') {
      body.appendChild(field('前置图标（emoji，可空）', input(b, 'icon', { placeholder: '🕐' })));
      body.appendChild(field('标题文字', input(b, 'text')));
    } else if (b.type === 'callout') {
      body.appendChild(field('样式', select(b, 'tone', [
        { value: 'tip', label: '蓝色 · 提示' },
        { value: 'warn', label: '橙色 · 警告' },
        { value: 'info', label: '灰色 · 说明' }
      ], { rerender: true })));
      body.appendChild(field('内容', area(b, 'text', 3, { placeholder: '支持 **加粗**' })));
    } else if (b.type === 'list') {
      var ta = document.createElement('textarea');
      ta.rows = 4;
      ta.value = (b.items || []).join('\n');
      ta.addEventListener('input', function () {
        b.items = ta.value.split('\n').filter(function (x) { return x.trim() !== ''; });
        markDirty(); schedulePreview();
      });
      body.appendChild(field('每行一个要点', ta));
    } else if (b.type === 'steps') {
      var ts = document.createElement('textarea');
      ts.rows = 4;
      ts.value = (b.items || []).map(function (i) { return (i.t || '') + ' | ' + (i.d || ''); }).join('\n');
      ts.addEventListener('input', function () {
        b.items = ts.value.split('\n').filter(function (x) { return x.trim() !== ''; }).map(function (line) {
          var p = line.split('|');
          return { t: (p[0] || '').trim(), d: (p[1] || '').trim() };
        });
        markDirty(); schedulePreview();
      });
      body.appendChild(field('每行一步：标题 | 描述', ts));
    } else if (b.type === 'table') {
      var th = document.createElement('input');
      th.type = 'text';
      th.value = (b.head || []).join(', ');
      th.addEventListener('input', function () {
        b.head = th.value.split(/[,，]/).map(function (x) { return x.trim(); });
        markDirty(); schedulePreview();
      });
      body.appendChild(field('表头（逗号分隔）', th));
      var tr = document.createElement('textarea');
      tr.rows = 4;
      tr.className = 'mono';
      tr.value = (b.rows || []).map(function (r) { return r.join(' | '); }).join('\n');
      tr.addEventListener('input', function () {
        b.rows = tr.value.split('\n').filter(function (x) { return x.trim() !== ''; }).map(function (line) {
          return line.split('|').map(function (c) { return c.trim(); });
        });
        markDirty(); schedulePreview();
      });
      body.appendChild(field('表格行（每行一条，单元格用 | 分隔）', tr));
    } else if (b.type === 'img') {
      body.appendChild(field('图片', imageField(b, 'url', { ratio: '4/3' }), '点选或拖入本地图片，也可以直接粘外部地址'));
      body.appendChild(field('图注', input(b, 'caption')));
    } else if (b.type === 'link') {
      body.appendChild(field('链接文字', input(b, 'text')));
      body.appendChild(field('链接地址', input(b, 'url', { placeholder: 'https://…' })));
    }

    w.appendChild(body);
    return w;
  }

  /* ---------------- 动作 ---------------- */
  function addSection() {
    state.draft.sections.push({
      id: uid('sec'), title: '新模块', layout: 'grid', countText: '', visible: true, entries: []
    });
    state.sel = { type: 'section', si: state.draft.sections.length - 1 };
    markDirty(); renderAll();
  }

  function renderAll() {
    renderTree();
    renderForm();
    schedulePreview();
  }

  function save() {
    if (!state.draft) return;
    var b = $('#btnSave');
    b.disabled = true; b.textContent = '保存中…';
    api('/api/admin/school/' + state.slug, { method: 'PUT', body: JSON.stringify(state.draft) })
      .then(function (r) {
        b.disabled = false; b.textContent = '保存';
        if (r.ok) { markClean(); toast('已保存，前台立即生效'); }
        else toast(r.d.error || '保存失败');
      })
      .catch(function () {
        b.disabled = false; b.textContent = '保存';
        toast('网络错误');
      });
  }

  /* ---------------- 分享 ---------------- */
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function openShare() {
    $('#shareMask').hidden = false;
    var box = $('#shareHosts');
    var suffix = '/?s=' + encodeURIComponent(state.slug || '');
    box.innerHTML = '<div class="share-empty">正在读取本机地址…</div>';

    api('/api/net').then(function (r) {
      box.innerHTML = '';
      var hosts = (r.d && r.d.hosts) || [];
      var port = (r.d && r.d.port) || location.port || 5173;

      if (!hosts.length) {
        var d = document.createElement('div');
        d.className = 'share-empty';
        d.textContent = '没读到局域网地址（可能没连网）。本机自测用：http://localhost:' + port + suffix;
        box.appendChild(d);
        return;
      }

      hosts.forEach(function (h) {
        var url = h.url + suffix;
        var row = document.createElement('div');
        row.className = 'share-row';

        var txt = document.createElement('div');
        txt.className = 'share-url';
        txt.textContent = url;
        var meta = document.createElement('span');
        meta.className = 'share-iface';
        meta.textContent = h.iface + ' · 端口 ' + port;
        txt.appendChild(meta);

        var b = btn('复制', 'ghost small', function () {
          copyText(url).then(function (ok) {
            toast(ok ? '已复制，发给对方即可' : '复制失败，请手动选中地址');
          });
        });

        row.appendChild(txt);
        row.appendChild(b);
        box.appendChild(row);
      });
    }).catch(function () {
      box.innerHTML = '';
      var d = document.createElement('div');
      d.className = 'share-empty';
      d.textContent = '读取失败，请手动使用 http://localhost:' + (location.port || 5173) + suffix;
      box.appendChild(d);
    });
  }

  /* ---------------- 启动 ---------------- */
  var TOKEN_KEY = 'hb.admin.token';

  function saveToken(t) {
    try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }
  function loadToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function showLogin(msg) {
    state.token = null;
    saveToken('');
    document.body.classList.add('auth-locked');
    $('#loginMask').hidden = false;
    $('#loginErr').textContent = msg || '';
    var p = $('#inPass');
    p.value = '';
    setTimeout(function () { p.focus(); }, 60);
  }

  function afterLogin() {
    document.body.classList.remove('auth-locked');
    $('#loginMask').hidden = true;
    $('#inPass').value = '';
    $('#loginErr').textContent = '';
    loadSchools().then(function () { return loadSchool(state.slug); });
  }

  function boot() {
    $('#btnLogin').addEventListener('click', function () {
      var u = $('#inUser').value.trim();
      var p = $('#inPass').value;
      if (!p) { $('#loginErr').textContent = '请输入密码'; return; }
      $('#btnLogin').disabled = true;
      api('/api/admin/login', { method: 'POST', body: JSON.stringify({ user: u, pass: p }) })
        .then(function (r) {
          $('#btnLogin').disabled = false;
          if (!r.ok) { $('#loginErr').textContent = r.d.error || '登录失败'; $('#inPass').value = ''; return; }
          state.token = r.d.token;
          saveToken(r.d.token);
          afterLogin();
        })
        .catch(function () {
          $('#btnLogin').disabled = false;
          $('#loginErr').textContent = '无法连接后端，请确认已运行 node server/server.js';
        });
    });
    $('#inPass').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') $('#btnLogin').click();
    });

    $('#schoolSel').addEventListener('change', function (ev) {
      if (state.dirty && !confirm('当前有未保存修改，切换后丢失。继续？')) {
        ev.target.value = state.slug;
        return;
      }
      state.slug = ev.target.value;
      loadSchool(state.slug);
    });

    $('#btnSave').addEventListener('click', save);
    $('#btnShare').addEventListener('click', openShare);
    $('#shareClose').addEventListener('click', function () { $('#shareMask').hidden = true; });
    $('#shareMask').addEventListener('click', function (ev) {
      if (ev.target === this) this.hidden = true;
    });
    $('#btnOpen').addEventListener('click', function () {
      window.open('/?s=' + encodeURIComponent(state.slug), '_blank');
    });

    $('#btnNew').addEventListener('click', function () {
      $('#newMask').hidden = false;
      $('#newName').value = '';
      $('#newSlug').value = '';
      $('#newErr').textContent = '';
    });
    $('#newCancel').addEventListener('click', function () { $('#newMask').hidden = true; });
    $('#newOk').addEventListener('click', function () {
      var name = $('#newName').value.trim();
      var slug = $('#newSlug').value.trim().toLowerCase();
      if (!name || !slug) { $('#newErr').textContent = '请填写名称与 slug'; return; }
      api('/api/admin/schools', {
        method: 'POST',
        body: JSON.stringify({ slug: slug, name: name, copyFrom: $('#newCopy').checked ? state.slug : null })
      }).then(function (r) {
        if (!r.ok) { $('#newErr').textContent = r.d.error || '创建失败'; return; }
        $('#newMask').hidden = true;
        return loadSchools().then(function () {
          state.slug = slug;
          $('#schoolSel').value = slug;
          return loadSchool(slug);
        });
      });
    });

    window.addEventListener('message', function (ev) {
      var m = ev.data || {};
      if (m.type === 'preview-ready') pushPreview();
    });

    window.addEventListener('beforeunload', function (ev) {
      if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
    });

    $('#btnLogout').addEventListener('click', function () {
      if (state.dirty && !confirm('有未保存的修改，退出后丢失。继续？')) return;
      api('/api/admin/logout', { method: 'POST' })
        .catch(function () {})
        .then(function () {
          state.dirty = false;
          saveToken('');
          state.token = null;
          location.replace('/admin/');
        });
    });

    /* 恢复当前窗口的会话：token 存在 sessionStorage，关掉浏览器即失效 */
    var saved = loadToken();
    if (!saved) { showLogin(''); return; }
    state.token = saved;
    api('/api/admin/me')
      .then(function (r) {
        if (r.ok) { afterLogin(); return; }
        if (r.status === 403) showLogin('后台仅限本机访问，请在这台电脑上用 localhost 打开');
        else if (r.status === 401) showLogin('登录已过期，请重新登录');
        else showLogin('无法验证登录状态（' + r.status + '）');
      })
      .catch(function () { showLogin('无法连接后端，请确认已运行 node server/server.js'); });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
