import fs from 'node:fs'; // 安全读取或提交部署配置文件。
import path from 'node:path'; // 使用与工作目录无关的部署路径。
import { fileURLToPath, pathToFileURL } from 'node:url'; // 区分模块导入与命令行执行。
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'; // 为跨电脑迁移提供带完整性验证的加密封装。
import { passwordRecord } from './access-control.mjs'; // 安装时仅保存后台密码的加盐摘要。
export function migrationConfig(source) { // 仅迁移当前实际使用的管理凭证，不携带历史令牌或审计。
  if (!source || typeof source !== 'object') throw new Error('迁移配置无效。'); // 拒绝空配置。
  const target = { authMode: source.authMode === 'oauth' ? 'oauth' : 'token', tailnet: typeof source.tailnet === 'string' ? source.tailnet : '-', exitAutoFallback: false }; // 部署后不自动改变目标电脑的出口设置。
  if (target.authMode === 'oauth') { if (!source.clientId || !source.clientSecret) throw new Error('OAuth 配置不完整。'); target.clientId = String(source.clientId); target.clientSecret = String(source.clientSecret); } else { if (!source.token) throw new Error('管理令牌为空。'); target.token = String(source.token); } // 排除当前未使用的旧管理凭证。
  return target; // 返回最小迁移内容。
} // 结束配置筛选。
export function encryptMigration(source, passphrase) { // 为专用部署包加密用户授权迁移的凭证。
  if (typeof passphrase !== 'string' || passphrase.length < 20) throw new Error('迁移口令太短。'); // 使用独立强随机迁移口令。
  const salt = randomBytes(24), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv); // 使用随机盐和 GCM 随机向量。
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(migrationConfig(source)), 'utf8'), cipher.final()]); // 加密最小配置并计算完整性标签。
  return { version: 1, salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') }; // 封装可跨电脑读取且不含口令的迁移文件。
} // 结束加密。
export function decryptMigration(envelope, passphrase) { // 安装时验证迁移口令与密文完整性。
  try { if (envelope?.version !== 1 || !/^[a-f0-9]{48}$/.test(envelope.salt) || !/^[a-f0-9]{24}$/.test(envelope.iv) || !/^[a-f0-9]{32}$/.test(envelope.tag) || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 16384) throw new Error(); const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, Buffer.from(envelope.salt, 'hex'), 32), Buffer.from(envelope.iv, 'hex')); decipher.setAuthTag(Buffer.from(envelope.tag, 'hex')); return migrationConfig(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'))); } catch { throw new Error('迁移口令错误或文件已损坏；原配置未修改。'); } // 不输出解密失败的细节或凭证。
} // 结束解密。
export function savePrivate(file, value) { // 使用同目录临时文件原子保存配置。
  fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = file + '.' + randomBytes(6).toString('hex') + '.tmp'; // 确保目标目录存在并避免临时文件冲突。
  try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file); } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } // 完成后才切换正式文件，失败清理临时文件。
} // 结束配置保存。
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) { // 仅命令行直接运行时初始化安装配置。
  const root = path.dirname(fileURLToPath(import.meta.url)), directory = path.join(root, 'data'), command = process.argv[2]; // 将数据固定保存到部署目录。
  if (command === 'password') { const password = process.env.TSADMIN_SETUP_PASSWORD; delete process.env.TSADMIN_SETUP_PASSWORD; savePrivate(path.join(directory, 'access.json'), passwordRecord(password)); console.log('Administrator password saved as a salted hash.'); } // 密码只经当前进程环境传入，不进入命令行或日志。
  else if (command === 'migrate') { const passphrase = process.env.TSADMIN_MIGRATION_CODE; delete process.env.TSADMIN_MIGRATION_CODE; const file = path.join(directory, 'config.json'); if (fs.existsSync(file)) throw new Error('Existing configuration preserved; migration cancelled.'); const migrated = decryptMigration(JSON.parse(fs.readFileSync(path.join(root, 'migration.enc.json'), 'utf8')), passphrase); savePrivate(file, migrated); console.log('Encrypted credentials imported.'); } // 原配置存在时拒绝覆盖，密码错误时不会产生配置。
  else throw new Error('Unknown deployment command.'); // 禁止误操作未实现的部署动作。
} // 结束命令行入口。
