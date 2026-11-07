#!/usr/bin/env node
/**
 * 设置后台登录密码
 *
 *   node server/setpass.js                 # 随机生成一个强密码并打印
 *   node server/setpass.js 你的新密码       # 指定密码（8 位以上）
 *   node server/setpass.js 新密码 用户名     # 指定密码与用户名（默认 admin）
 *
 * 密码只写入 server/data/admin.local.json（scrypt 加盐哈希，不入 git），
 * 这样仓库里的 db.json 可以保持 hash 为空、随手公开也不会泄露登录凭据。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const LOCAL_FILE = path.join(__dirname, 'data', 'admin.local.json');

function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}

/* 避开 0/O、1/l/I 这些看着像的字符，方便手输 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomPass(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  let pass = process.argv[2];
  const user = process.argv[3] || 'admin';

  if (!pass) {
    pass = randomPass(16);
    console.log('');
    console.log('  已生成随机密码：' + pass);
    console.log('  （请立刻记下，这个密码只显示这一次）');
  } else if (pass.length < 8) {
    console.error('  密码太短，至少 8 位。');
    process.exit(1);
  }

  if (!readJson(DATA_FILE)) {
    console.error('  读不到 ' + DATA_FILE + '，请确认在项目根目录执行。');
    process.exit(1);
  }

  const local = readJson(LOCAL_FILE) || { users: [] };
  local.users = Array.isArray(local.users) ? local.users : [];
  const hit = local.users.find((u) => u.user === user);
  if (hit) {
    hit.hash = hashPass(pass);
    delete hit.pass;
  } else {
    local.users.push({ user, hash: hashPass(pass) });
  }

  const tmp = LOCAL_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(local, null, 2), 'utf8');
  fs.renameSync(tmp, LOCAL_FILE);

  console.log('  账号：' + user);
  console.log('  密码：' + pass);
  console.log('  已写入 ' + LOCAL_FILE + '（scrypt 哈希，不入 git）');
  console.log('  提示：如果服务正在运行，请重启一次，让旧会话全部失效。');
  console.log('');
}

main();
