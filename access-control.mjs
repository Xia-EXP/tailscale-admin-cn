import fs from 'node:fs'; // 读取独立的后台访问密码摘要。
import { randomBytes, scryptSync, scrypt, timingSafeEqual, createHash } from 'node:crypto'; // 使用加盐摘要校验密码并缓存短期成功结果。
import { promisify } from 'node:util'; // 将密码计算转换为异步任务，避免阻塞所有请求。
const derive = promisify(scrypt); // 复用异步密码推导函数。
export function passwordRecord(password) { // 为安装或修改后台密码创建不可逆摘要。
  if (typeof password !== 'string' || password.length < 12 || password.length > 256 || /[\r\n]/.test(password)) throw new Error('后台密码必须为 12 至 256 个字符，且不能包含换行。'); // 拒绝弱密码和异常输入。
  const salt = randomBytes(24).toString('hex'); // 每次设置使用独立随机盐。
  return { username: 'admin', salt, hash: scryptSync(password, salt, 64).toString('hex') }; // 磁盘仅保存固定账号和密码摘要。
} // 结束摘要生成。
export function createAccessControl({ file, host, allowedHosts = [], now = Date.now }) { // 为局域网部署创建独立访问门禁。
  const record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; // 配置损坏时直接停止启动，避免意外放行。
  if (!record && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('开放网络监听前必须先设置后台访问密码。'); // 禁止无密码监听局域网。
  if (record && (record.username !== 'admin' || !/^[a-f0-9]{48}$/.test(record.salt) || !/^[a-f0-9]{128}$/.test(record.hash))) throw new Error('后台访问配置损坏，请重新设置密码。'); // 不接受空摘要或非法格式。
  const hosts = new Set(['localhost', '127.0.0.1', '::1', ...allowedHosts].map((value) => value.toLowerCase())); // 限定域名并保留回环诊断地址。
  const attempts = new Map(), verified = new Map(); let pending = 0; // 限制失败重试、成功缓存和并发密码计算。
  const respond = (res, status, message, challenge = false) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(challenge ? { 'WWW-Authenticate': 'Basic realm="Tailscale Admin", charset="UTF-8"' } : {}) }); res.end(message); return false; }; // 统一返回不含凭证的拒绝响应。
  return async function authorize(req, res, url) { // 所有静态资源和管理接口都经过相同门禁。
    if (!record) return true; // 原有仅回环服务保持兼容。
    const local = (req.socket.localAddress || '').replace(/^::ffff:/, '').toLowerCase(); // 允许当前实际接收请求的本机 IP。
    if (req.headers.host?.includes('@') || (!hosts.has(url.hostname.replace(/^\[|\]$/g, '').toLowerCase()) && url.hostname !== local)) return respond(res, 421, '该域名未配置到此管理台。'); // 阻止任意域名指向本机后的 DNS 重绑定访问。
    if (url.pathname === '/api/health' && ['GET', 'HEAD'].includes(req.method)) return true; // 仅公开无敏感数据的健康标识，兼容启动器发现。
    const address = req.socket.remoteAddress || 'unknown', time = now(); // 失败次数按实际连接地址计算，不信任转发头。
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key); // 清除过期失败计数，防止长期增长。
    const failed = attempts.get(address); // 读取当前连接来源的失败窗口。
    if (failed?.count >= 8) { res.setHeader('Retry-After', String(Math.ceil((failed.until - time) / 1000))); return respond(res, 429, '登录失败次数过多，请稍后重试。'); } // 八次失败后限制一分钟内继续尝试。
    const authorization = req.headers.authorization || ''; // 只读取标准 HTTP 身份验证头。
    if (!authorization.startsWith('Basic ') || authorization.length > 2048) return respond(res, 401, '请输入后台管理员账号和密码。', true); // 未登录浏览器显示原生密码输入框。
    const digest = createHash('sha256').update(authorization).digest('hex'); // 缓存不保留明文密码或原始请求头。
    if ((verified.get(digest) || 0) > time) return true; // 十分钟内复用成功结果，避免每个静态文件重新推导密码。
    if (pending >= 4) return respond(res, 503, '登录校验繁忙，请稍后重试。'); // 对未认证请求限制昂贵计算的并发数。
    pending += 1; let valid = false; // 在异步校验期间保留计算配额。
    try { const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'), separator = decoded.indexOf(':'); if (separator >= 0 && decoded.slice(0, separator) === record.username && decoded.length <= 512) valid = timingSafeEqual(await derive(decoded.slice(separator + 1), record.salt, 64), Buffer.from(record.hash, 'hex')); } finally { pending -= 1; } // 异步校验固定账号与密码摘要，始终释放配额。
    if (!valid) { const latest = attempts.get(address); if (attempts.size >= 256 && !latest) return respond(res, 429, '登录请求过多，请稍后重试。'); attempts.set(address, { count: (latest?.count || 0) + 1, until: latest?.until || time + 60000 }); return respond(res, 401, '账号或密码错误。', true); } // 读取异步校验后的最新计数，避免并发失败相互覆盖。
    attempts.delete(address); if (verified.size >= 128) verified.delete(verified.keys().next().value); verified.set(digest, time + 600000); return true; // 成功后清除失败计数并限制缓存容量。
  }; // 返回门禁处理函数。
} // 结束访问控制创建。
