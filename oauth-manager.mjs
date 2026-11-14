import { createHash } from 'node:crypto'; // 为 OAuth 客户端生成不可逆缓存键，避免使用秘密作为标识。
const failure = (status, message) => Object.assign(new Error(message), { status }); // 向调用方提供脱敏的认证错误。
export function createOAuthProvider({ requestToken, now = Date.now }) { // 将网络请求与时钟注入，便于测试自动续期。
  const records = new Map(), pending = new Map(), margin = 5 * 60000; // 缓存短期令牌，并在到期前五分钟续期。
  const keyOf = (config) => createHash('sha256').update(JSON.stringify([config.clientId || '', config.clientSecret || ''])).digest('hex'); // 客户端更换时自动使用独立缓存。
  function info(config) { const record = records.get(keyOf(config)); return { configured: Boolean(config.clientId && config.clientSecret), expiresAt: record?.expiresAt ? new Date(record.expiresAt).toISOString() : null, lastRenewedAt: record?.renewedAt ? new Date(record.renewedAt).toISOString() : null, renewalDueAt: record?.expiresAt ? new Date(record.expiresAt - margin).toISOString() : null, error: record?.error || null, scopes: record?.scopes || '' }; } // 只返回续期状态与权限，不回传令牌或客户端秘密。
  async function get(config) { // 所有管理 API 请求共用这一自动续期入口。
    if (!config.clientId || !config.clientSecret) throw failure(401, '请先配置 OAuth Client ID 和 Client Secret'); // 不向官方发送空凭证。
    const key = keyOf(config), record = records.get(key), timestamp = now(); // 查找当前客户端对应的短期凭证。
    if (record?.token && record.expiresAt - timestamp > margin) return record.token; // 距离到期较远时复用内存令牌。
    if (pending.has(key)) return pending.get(key); // 并发请求共享一次令牌申请，防止刷新风暴。
    if (record?.retryAt > timestamp) { if (record.token && record.expiresAt > timestamp + 30000) return record.token; throw failure(503, 'OAuth 自动续期暂时失败，将在稍后重试；请检查客户端凭证和网络'); } // 对失败续期作短暂退避，已到期令牌绝不继续使用。
    const task = Promise.resolve().then(async () => { // 在独立 Promise 中进行客户端凭证交换。
      try { const response = await requestToken(config), lifetime = Number(response.expires_in); if (typeof response.access_token !== 'string' || !response.access_token || /[\r\n]/.test(response.access_token) || !Number.isFinite(lifetime) || lifetime < 30 || lifetime > 86400 || String(response.token_type || 'Bearer').toLowerCase() !== 'bearer') throw failure(502, 'OAuth 返回了无效的短期令牌'); const renewedAt = now(); records.delete(key); records.set(key, { token: response.access_token, renewedAt, expiresAt: renewedAt + lifetime * 1000, scopes: typeof response.scope === 'string' ? response.scope : '', error: null, retryAt: 0 }); while (records.size > 4) records.delete(records.keys().next().value); return response.access_token; } // 只在完整响应校验成功后替换旧短期令牌，并限制候选缓存数量。
      catch (error) { const previous = records.get(key) || {}; records.set(key, { ...previous, error: error.status === 400 || error.status === 401 ? 'OAuth 客户端凭证无效或已被撤销' : 'OAuth 续期失败，请检查网络和客户端权限', retryAt: now() + 30000 }); if (previous.token && previous.expiresAt > now() + 30000) return previous.token; throw failure(error.status === 400 || error.status === 401 ? 401 : 503, records.get(key).error); } // 续期失败保留仍有效的旧令牌，并明确报告错误。
      finally { pending.delete(key); } // 失败或成功都允许下次续期。
    }); // 结束令牌申请任务定义。
    pending.set(key, task); return task; // 提交共享续期任务供所有调用者等待。
  } // 结束短期令牌读取。
  return { get, info }; // 向服务器只暴露令牌获取与脱敏状态。
} // 结束 OAuth 自动续期提供器。
