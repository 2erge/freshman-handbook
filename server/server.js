/**
 * 校园新生手册 —— 零依赖后端
 * 运行：node server/server.js   默认 http://localhost:5173
 * 前端：/        后台：/admin
 *
 * 后台安全策略（默认）：
 *   1. 仅允许本机访问 /admin 与 /api/admin/*（别人的电脑连登录页都打不开）
 *   2. 密码以 scrypt 加盐哈希保存在 db.json，不再存明文
 *   3. 登录连续失败 5 次锁定 10 分钟；会话 8 小时滑动过期，且绑定来源 IP
 *   要远程管理：ADMIN_REMOTE=1 node server/server.js（先设强密码）
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT || 5173);

/* 后台是否允许非本机访问：默认关闭 */
const REMOTE_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.ADMIN_REMOTE || ''));

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- 存储层（JSON 文件；替换成 SQLite/PG 只需改这 4 个函数） ------------- */
function readDb() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeDb(db) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}
function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(4).toString('hex');
}

/* ---------------- 密码：scrypt 加盐哈希 ----------------
 * 存储格式：scrypt$<salt hex>$<hash hex>
 * 兼容旧版明文（首次登录成功后自动升级为哈希）。
 */
function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

function verifyPass(pass, stored) {
  if (!stored) return false;
  const s = String(stored);
  if (s.indexOf('scrypt$') === 0) {
    const parts = s.split('$');
    if (parts.length !== 3) return false;
    let calc;
    try { calc = crypto.scryptSync(String(pass), parts[1], 64); } catch { return false; }
    const want = Buffer.from(parts[2], 'hex');
    if (want.length !== calc.length) return false;
    return crypto.timingSafeEqual(calc, want);
  }
  /* 旧版明文：定长比较，避免逐字节短路泄露长度信息 */
  const a = crypto.createHash('sha256').update(String(pass)).digest();
  const b = crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * 本地凭据文件：server/data/admin.local.json（已被 .gitignore 忽略）
 * 用途：让「仓库里的 db.json」保持 hash 为空、可以安全公开，
 *       而本机的登录密码单独存在这个不入库的文件里。
 */
function localAdminUsers() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'admin.local.json'), 'utf8'));
    return Array.isArray(j.users) ? j.users : [];
  } catch {
    return [];
  }
}

/** db.json 里的账号 + 本地凭据文件，同名时以本地文件为准 */
function allUsers(db) {
  const map = new Map();
  for (const u of db.users || []) if (u && u.user) map.set(u.user, u);
  for (const u of localAdminUsers()) if (u && u.user) map.set(u.user, u);
  return [...map.values()];
}

function getUser(db, name) {
  return allUsers(db).find((u) => u.user === name) || null;
}
function userSecret(u) {
  return (u && (u.hash || u.pass)) || '';
}

/* ---------------- 来源判定：是不是"本机" ---------------- */
let selfCache = { at: 0, set: new Set(['127.0.0.1', '::1']) };

function selfIps() {
  if (Date.now() - selfCache.at < 30000) return selfCache.set;
  const set = new Set(['127.0.0.1', '::1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n && n.address) set.add(n.address);
  }
  selfCache = { at: Date.now(), set };
  return set;
}

function clientIp(req) {
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

/** 本机访问：环回地址，或就是这台机器自己的某个网卡 IP（自己用局域网 IP 打开也算） */
function isSelf(req) {
  if (REMOTE_ADMIN) return true;
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || selfIps().has(ip);
}

/* ---------------- 会话 ---------------- */
const sessions = new Map();
const SESSION_TTL = 8 * 3600 * 1000;

function issueToken(user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, ip: clientIp(req), exp: Date.now() + SESSION_TTL });
  return token;
}

function checkAuth(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  if (s.ip !== clientIp(req)) { sessions.delete(token); return null; } /* 会话绑定来源 IP */
  s.exp = Date.now() + SESSION_TTL; /* 滑动续期 */
  return s;
}

function dropSession(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token) sessions.delete(token);
}

/* ---------------- 登录限速 ---------------- */
const FAIL_MAX = 5;
const FAIL_WINDOW = 10 * 60 * 1000;
const FAIL_LOCK = 10 * 60 * 1000;
const loginFails = new Map();

/** 返回剩余锁定秒数，0 表示可以尝试 */
function loginWait(ip) {
  const r = loginFails.get(ip);
  if (!r) return 0;
  const now = Date.now();
  if (r.until > now) return Math.ceil((r.until - now) / 1000);
  if (now - r.first > FAIL_WINDOW) { loginFails.delete(ip); return 0; }
  return 0;
}

function noteFail(ip) {
  const now = Date.now();
  let r = loginFails.get(ip);
  if (!r || now - r.first > FAIL_WINDOW) r = { n: 0, first: now, until: 0 };
  r.n += 1;
  if (r.n >= FAIL_MAX) r.until = now + FAIL_LOCK;
  loginFails.set(ip, r);
  return Math.max(0, Math.ceil((r.until - now) / 1000));
}

/* ---------------- 内容遮蔽（服务端做，前端拿不到锁定正文） ---------------- */
function blockText(b) {
  if (!b) return '';
  switch (b.type) {
    case 'p': case 'h2': return b.text || '';
    case 'list': return (b.items || []).join('');
    case 'steps': return (b.items || []).map((i) => (i.t || '') + (i.d || '')).join('');
    case 'table': return ((b.head || []).join('')) + (b.rows || []).map((r) => r.join('')).join('');
    case 'callout': return b.text || '';
    case 'img': return b.caption || '';
    case 'link': return b.text || '';
    default: return '';
  }
}

/**
 * 按字符比例截断 blocks，返回可公开的预览。
 * 被截断的那一块整体丢弃（保持版式完整），返回 locked=true。
 */
function maskBlocks(blocks, ratio) {
  const total = blocks.reduce((n, b) => n + blockText(b).length, 0);
  if (!ratio || ratio >= 1 || total === 0) return { blocks, locked: false, total };
  const budget = Math.floor(total * ratio);
  const out = [];
  let used = 0;
  for (const b of blocks) {
    const len = blockText(b).length;
    if (used + len > budget) break;
    out.push(b);
    used += len;
  }
  return { blocks: out, locked: out.length < blocks.length, total };
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveFile(res, baseDir, relPath) {
  const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(baseDir, safe);
  if (!full.startsWith(baseDir)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found'); return; }
    const isUpload = full.startsWith(UPLOAD_DIR);
    res.writeHead(200, {
      'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'cache-control': isUpload ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    }).end(buf);
  });
}

/* ---------------- 响应工具 ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }).end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

/* ---------------- 业务：对外视图 ---------------- */
/* 实现见 server/lib/public.js —— 静态导出脚本复用同一份逻辑 */
const { publicSchool } = require('./lib/public');

function findEntry(db, slug, entryId) {
  const school = db.schools[slug];
  if (!school) return null;
  for (const s of school.sections || []) {
    const e = (s.entries || []).find((x) => x.id === entryId);
    if (e) return { school, section: s, entry: e };
  }
  return null;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  const method = req.method;

  if (method === 'OPTIONS') return json(res, 204, {});

  /* ---- 后台闸门：非本机一律拒绝，连登录页都不给 ---- */
  const isAdminPath = p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin');
  if (isAdminPath && !isSelf(req)) {
    res.writeHead(403, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    }).end(
      '403 · 后台仅限本机访问\n\n' +
      '当前来源：' + clientIp(req) + '\n' +
      '后台管理只能在运行服务的这台电脑上，通过 http://localhost:' + PORT + '/admin/ 打开。\n' +
      '（若确需远程管理：设置强密码后，用 ADMIN_REMOTE=1 重启服务）'
    );
    return;
  }

  /* ---- 登录 ---- */
  if (p === '/api/admin/login' && method === 'POST') {
    const ip = clientIp(req);
    const wait = loginWait(ip);
    if (wait > 0) {
      res.setHeader('retry-after', String(wait));
      return json(res, 429, { error: '试错次数过多，请 ' + Math.ceil(wait / 60) + ' 分钟后再试', retryAfter: wait });
    }
    const { user, pass } = await readBody(req);
    const db = readDb();
    const hit = getUser(db, String(user || ''));
    if (!hit || !verifyPass(pass || '', userSecret(hit))) {
      const locked = noteFail(ip);
      return json(res, 401, {
        error: locked
          ? '连续 ' + FAIL_MAX + ' 次错误，账号已锁定 ' + Math.round(FAIL_LOCK / 60000) + ' 分钟'
          : '账号或密码错误',
      });
    }
    /* 旧的明文密码：登录成功即升级为哈希 */
    if (hit.pass && !hit.hash) {
      hit.hash = hashPass(hit.pass);
      delete hit.pass;
      writeDb(db);
      console.log('[auth] 已将 ' + hit.user + ' 的明文密码升级为 scrypt 哈希');
    }
    loginFails.delete(ip);
    return json(res, 200, { token: issueToken(hit.user, req), user: hit.user, ttl: SESSION_TTL });
  }

  /* ---- 校验当前会话 ---- */
  if (p === '/api/admin/me' && method === 'GET') {
    const s = checkAuth(req);
    if (!s) return json(res, 401, { error: '未登录' });
    return json(res, 200, { user: s.user, exp: s.exp, remoteAllowed: REMOTE_ADMIN });
  }

  /* ---- 退出登录 ---- */
  if (p === '/api/admin/logout' && method === 'POST') {
    dropSession(req);
    return json(res, 200, { ok: true });
  }

  /* ---- 学校列表 ---- */
  if (p === '/api/schools' && method === 'GET') {
    const db = readDb();
    return json(res, 200, Object.values(db.schools).map((s) => ({ slug: s.slug, name: s.name })));
  }

  /* ---- 访问地址（后台「分享」面板用，需登录） ---- */
  if (p === '/api/net' && method === 'GET') {
    if (!checkAuth(req)) return json(res, 401, { error: '未登录' });
    return json(res, 200, { port: PORT, hosts: lanHosts(), remoteAdmin: REMOTE_ADMIN });
  }

  /* ---- 公开：学校数据 ---- */
  if (p.startsWith('/api/school/') && method === 'GET' && !p.startsWith('/api/admin/')) {
    const slug = p.slice('/api/school/'.length);
    const db = readDb();
    const school = db.schools[slug];
    if (!school) return json(res, 404, { error: '学校不存在' });
    return json(res, 200, publicSchool(school));
  }

  /* ---- 公开：条目正文（自动遮蔽） ---- */
  if (p.startsWith('/api/entry/') && p.endsWith('/unlock') && method === 'POST') {
    const rest = p.slice('/api/entry/'.length, -'/unlock'.length);
    const idx = rest.lastIndexOf('/');
    const slug = rest.slice(0, idx);
    const entryId = rest.slice(idx + 1);
    const body = await readBody(req);
    const db = readDb();
    const hit = findEntry(db, slug, entryId);
    if (!hit) return json(res, 404, { error: '条目不存在' });
    const lock = hit.entry.lock || {};
    if (!lock.enabled) return json(res, 200, { blocks: hit.entry.blocks || [] });
    if ((body.password || '') !== (lock.password || '\u0000')) {
      return json(res, 403, { error: '密码不正确' });
    }
    return json(res, 200, { blocks: hit.entry.blocks || [] });
  }

  if (p.startsWith('/api/entry/') && method === 'GET') {
    const rest = p.slice('/api/entry/'.length);
    const idx = rest.lastIndexOf('/');
    const slug = rest.slice(0, idx);
    const entryId = rest.slice(idx + 1);
    const db = readDb();
    const hit = findEntry(db, slug, entryId);
    if (!hit) return json(res, 404, { error: '条目不存在' });
    const e = hit.entry;
    const lock = e.lock || { enabled: false };
    if (!lock.enabled) {
      return json(res, 200, { title: e.title, blocks: e.blocks || [], locked: false });
    }
    const masked = maskBlocks(e.blocks || [], lock.freeRatio || 0.2);
    return json(res, 200, {
      title: e.title,
      blocks: masked.blocks,
      locked: masked.locked,
      lock: { freeRatio: lock.freeRatio || 0.2, contact: lock.contact || '', hint: lock.hint || '' },
    });
  }

  /* ---- 后台：读整校 ---- */
  if (p.startsWith('/api/admin/school/') && method === 'GET') {
    if (!checkAuth(req)) return json(res, 401, { error: '未登录' });
    const slug = p.slice('/api/admin/school/'.length);
    const db = readDb();
    const school = db.schools[slug];
    if (!school) return json(res, 404, { error: '学校不存在' });
    return json(res, 200, school);
  }

  /* ---- 后台：保存整校 ---- */
  if (p.startsWith('/api/admin/school/') && method === 'PUT') {
    if (!checkAuth(req)) return json(res, 401, { error: '未登录' });
    const slug = p.slice('/api/admin/school/'.length);
    const body = await readBody(req);
    const db = readDb();
    if (!db.schools[slug]) return json(res, 404, { error: '学校不存在' });
    body.slug = slug;
    db.schools[slug] = body;
    writeDb(db);
    return json(res, 200, { ok: true, savedAt: Date.now() });
  }

  /* ---- 后台：新建学校（可复制现有） ---- */
  if (p === '/api/admin/schools' && method === 'POST') {
    if (!checkAuth(req)) return json(res, 401, { error: '未登录' });
    const { slug, name, copyFrom } = await readBody(req);
    if (!slug || !/^[a-z0-9-]{2,32}$/.test(slug)) return json(res, 400, { error: 'slug 需为 2-32 位小写字母/数字/短横线' });
    const db = readDb();
    if (db.schools[slug]) return json(res, 409, { error: 'slug 已存在' });
    const base = copyFrom && db.schools[copyFrom]
      ? JSON.parse(JSON.stringify(db.schools[copyFrom]))
      : blankSchool(slug, name || slug);
    base.slug = slug;
    base.name = name || base.name;
    base.sections.forEach((s) => {
      s.id = uid('sec');
      (s.entries || []).forEach((e) => { e.id = uid('e'); });
    });
    db.schools[slug] = base;
    writeDb(db);
    return json(res, 200, { ok: true, slug });
  }

  /* ---- 后台：图片上传 ---- */
  if (p === '/api/admin/upload' && method === 'POST') {
    if (!checkAuth(req)) return json(res, 401, { error: '未登录' });
    return handleUpload(req, res);
  }

  /* ---- 静态 ---- */
  if (p.startsWith('/uploads/')) return serveFile(res, UPLOAD_DIR, p.slice('/uploads/'.length));
  if (p === '/admin' || p === '/admin/') return serveFile(res, ADMIN_DIR, 'index.html');
  if (p.startsWith('/admin/')) return serveFile(res, ADMIN_DIR, p.slice('/admin/'.length));
  if (p === '/') return serveFile(res, WEB_DIR, 'index.html');
  return serveFile(res, WEB_DIR, p.slice(1));
});

/* ---------------- 图片上传 ----------------
 * 前端直接把 File 作为请求体 POST 过来，content-type 就是图片类型。
 * 只接受位图，校验文件头（magic bytes），不信任扩展名与 content-type。
 */
const MAX_UPLOAD = 8 * 1024 * 1024; // 8MB
const IMG_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function handleUpload(req, res) {
  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_UPLOAD) {
      aborted = true;
      json(res, 413, { error: '图片超过 8MB，请压缩后再上传' });
      req.resume();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    const mime = sniffImage(buf);
    if (!mime) return json(res, 415, { error: '只支持 JPG / PNG / WebP / GIF 图片' });
    const name = Date.now().toString(36) + '_' + crypto.randomBytes(5).toString('hex') + IMG_EXT[mime];
    try {
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    } catch (e) {
      return json(res, 500, { error: '写入文件失败：' + e.message });
    }
    return json(res, 200, { ok: true, url: '/uploads/' + name, size: buf.length, mime });
  });
  req.on('error', () => { if (!aborted) { aborted = true; json(res, 400, { error: '上传中断' }); } });
}

function blankSchool(slug, name) {
  return {
    slug, name, subtitle: '', watermark: name,
    theme: { primary: '#2f6bff', bg: '#eef3fb', text: '#1b2333' },
    banner: {
      title: '欢迎来到' + name, subtitle: '新学期 · 新起点 · 新未来',
      image: '', fit: 'cover', overlay: 55, textTone: 'dark', tint: '#dbe8f8',
    },
    footer: {
      copyright: '© ' + new Date().getFullYear() + ' ' + name,
      ctaText: '联系学长',
      ctaMode: 'contact',
      ctaUrl: '',
      contact: {
        name: '', wechatId: '', qr: '',
        tip: '长按识别二维码，或复制微信号添加',
      },
    },
    sections: [],
  };
}

/* ---------------- 局域网地址（分享用） ---------------- */
const VIRTUAL_IFACE = /(vmware|virtualbox|vbox|hyper-?v|vethernet|docker|wsl|loopback|tap|tun|zerotier|tailscale)/i;

function lanHosts() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    if (VIRTUAL_IFACE.test(name)) continue; // 跳过虚拟机 / 容器网卡，免得给错地址
    for (const n of nets[name] || []) {
      const fam = typeof n.family === 'string' ? n.family : 'IPv4';
      if (fam !== 'IPv4' || n.internal) continue;
      if (n.address.startsWith('169.254.')) continue;
      out.push({ iface: name, ip: n.address, url: 'http://' + n.address + ':' + PORT });
    }
  }
  // 家用/校园网段优先：192.168 > 10.x > 172.16-31
  const rank = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  out.sort((a, b) => rank(a.ip) - rank(b.ip));
  return out;
}

server.listen(PORT, () => {
  const db = readDb();
  const users = allUsers(db);
  const slugs = Object.keys(db.schools || {});
  const first = slugs[0] || '<slug>';
  console.log('');
  console.log('  前端（只读，可分享）  http://localhost:' + PORT + '/?s=' + first);
  console.log('  后台（仅本机）        http://localhost:' + PORT + '/admin/');
  console.log('  学校                  ' + (slugs.length ? slugs.join(', ') : '（尚无数据）'));
  console.log('  管理账号              ' + (users.map((u) => u.user).join(', ') || '（尚未设置）'));
  console.log('  访问策略              后台' + (REMOTE_ADMIN ? '允许远程访问（ADMIN_REMOTE=1）' : '仅限本机，其他设备 403'));
  if (!users.some((u) => u.hash)) {
    console.log('  ⚠ 还没有设置管理密码，执行：node server/setpass.js 你的密码');
  }
  console.log('');
});
