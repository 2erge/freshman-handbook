#!/usr/bin/env node
/**
 * 设置后台登录密码（零依赖，直接改写 server/data/db.json 中的 scrypt 哈希）
 *
 *   node server/setpass.js                 # 随机生成一个强密码并打印
 *   node server/setpass.js 你的新密码       # 指定密码（8 位以上）
 *   node server/setpass.js 新密码 用户名     # 指定密码与用户名（默认 admin）
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

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

  let db;
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('  读不到 ' + DATA_FILE + '：' + e.message);
    process.exit(1);
  }

  db.users = db.users || [];
  const hit = db.users.find((u) => u.user === user);
  if (hit) {
    hit.hash = hashPass(pass);
    delete hit.pass; /* 清掉可能残留的明文 */
  } else {
    db.users.push({ user, hash: hashPass(pass) });
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);

  console.log('  账号：' + user);
  console.log('  密码：' + pass);
  console.log('  已写入 ' + DATA_FILE + '（scrypt 哈希，不可逆）');
  console.log('  提示：如果服务正在运行，请重启一次，让旧会话全部失效。');
  console.log('');
}

main();
