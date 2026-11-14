import { createHash } from 'node:crypto'; // 用不可逆短指纹识别已配置令牌，避免返回令牌明文。
const fail = (status, message) => Object.assign(new Error(message), { status }); // 为接口提供明确的错误状态。
export function isDeviceRegistrationKey(key) { return key?.keyType ? key.keyType === 'auth' : Boolean(key?.capabilities?.devices?.create); } // 官方 keys 列表还包含 OAuth 客户端和 API 令牌，仅把 auth 类型作为设备注册密钥。
export function credentialInfo(config, mock = false) { // 仅公开凭证配置元信息。
  const oauth = config.authMode === 'oauth', secret = oauth ? config.clientSecret : config.token; // 根据当前认证方式选择用于指纹的凭证。
  return { authMode: oauth ? 'oauth' : 'token', clientId: config.clientId || '', hasClientSecret: Boolean(config.clientSecret), hasToken: Boolean(oauth ? config.clientId && config.clientSecret : config.token), fingerprint: secret ? createHash('sha256').update(secret).digest('hex').slice(0, 12) : null, tailnet: config.tailnet || '-', updatedAt: config.credentialsUpdatedAt || null, mock }; // 不把任何秘密或令牌片段返回浏览器。
} // 结束凭证信息生成。
export function createCredentialManager({ current, verify, persist, mock = false }) { // 将验证、并发控制和提交集中管理。
  let busy = false; // 防止两个并发请求互相覆盖待验证的配置。
  async function apply(body, save = false) { // 测试与保存共享候选配置验证。
    if (busy) throw fail(409, '已有凭证操作正在进行，请稍后重试'); // 不允许并发替换同一凭证。
    busy = true; // 在任何异步操作前取得提交锁。
    try { // 保证失败时释放锁并保留旧配置。
      const previous = { ...current() }, next = { ...previous }; // 候选值独立于当前正在使用的配置。
      if (body.authMode !== undefined) { if (!['token', 'oauth'].includes(body.authMode)) throw fail(400, '请选择 API 令牌或 OAuth 自动续期'); next.authMode = body.authMode; } // 显式选择凭证模式，旧配置默认使用 API 令牌。
      if (body.clientId !== undefined) { const value = String(body.clientId).trim(); if (!/^[A-Za-z0-9_-]{3,256}$/.test(value)) throw fail(400, 'OAuth Client ID 格式不正确'); next.clientId = value; } // 校验 OAuth 客户端标识。
      if (body.clientSecret !== undefined) { const value = String(body.clientSecret).trim(); if (value.length < 8 || value.length > 4096 || /\s/.test(value)) throw fail(400, '请填写有效的 OAuth Client Secret'); next.clientSecret = value; } // 允许保存完整客户端秘密，但不在响应中回传。
      if (body.token !== undefined) { const token = String(body.token).trim(); if (!/^tskey-api-[A-Za-z0-9_-]{8,}$/.test(token) || token.length > 4096) throw fail(400, '请填写 tskey-api- 开头的 API 管理令牌；tskey-auth- 设备注册密钥不能用于后台管理'); next.token = token; } // 阻止误填设备密钥或意外清空现有凭证。
      if (body.tailnet !== undefined) { const value = String(body.tailnet || '').trim() || '-'; if (value.length > 253 || /[\x00-\x20/\\]/.test(value)) throw fail(400, 'Tailnet 应为网络名称、邮箱或 -，不能包含空格或路径'); next.tailnet = value; } // 验证网络标识并避免错误路径。
      if (body.exitAutoFallback !== undefined) next.exitAutoFallback = Boolean(body.exitAutoFallback); // 保留既有出口自动回落设置能力。
      if (next.authMode === 'oauth' && (!next.clientId || !next.clientSecret)) throw fail(400, 'OAuth 自动续期需要 Client ID 和 Client Secret'); // 配置不完整时不能切换认证模式。
      const changed = next.token !== previous.token || next.tailnet !== previous.tailnet || (next.authMode || 'token') !== (previous.authMode || 'token') || next.clientId !== previous.clientId || next.clientSecret !== previous.clientSecret; // 客户端或模式更改同样必须验证后提交。
      const needsTest = !save || changed || body.test === true; // 新凭证与显式测试都必须先验证。
      let test = null; // 没有要求测试时不制造验证结果。
      if (needsTest) { if (next.authMode !== 'oauth' && !next.token && !mock) throw fail(400, '尚未配置 API 管理令牌，请先填写'); try { test = await verify(next); if (!test?.ok) throw fail(401, '验证失败'); } catch (error) { throw fail(error.status === 403 ? 403 : error.status === 401 ? 401 : 502, error.status === 403 ? '凭证验证失败：没有读取目标网络设备的权限，旧配置已保留' : error.status === 401 ? '凭证验证失败：令牌／OAuth 客户端无效或已过期，旧配置已保留' : '凭证验证失败：请检查凭证、Tailnet 与网络连接，旧配置已保留'); } } // 验证失败既不写文件，也不改运行中的凭证。
      const saved = save && (changed || next.exitAutoFallback !== previous.exitAutoFallback); // 仅对实际改动进行提交。
      if (saved) { if (changed) next.credentialsUpdatedAt = new Date().toISOString(); await persist(next); } // 持久化成功后才允许外部切换当前配置。
      return { ok: true, saved, test, ...credentialInfo(save && saved ? next : previous, mock), candidateVerified: Boolean(test?.ok), exitAutoFallback: (save && saved ? next : previous).exitAutoFallback !== false }; // 返回状态与验证结论，不返回候选令牌。
    } finally { busy = false; } // 无论验证或写入失败都释放操作锁。
  } // 结束候选凭证处理。
  return { info: () => ({ ok: true, ...credentialInfo(current(), mock) }), test: (body) => apply(body, false), save: (body) => apply(body, true) }; // 提供只读信息、仅测试和验证后替换入口。
} // 结束管理器创建。
