import { createHash } from 'node:crypto'; // 对标签初始化前的策略生成并发校验标识。
export const MANAGED_TAG = 'tag:managed-node'; // 为首次通过后台加入的设备提供明确的管理标签。
const error = (status, message) => Object.assign(new Error(message), { status }); // 统一返回可展示给用户的明确错误。
export function parsePolicy(text) { // 解析 HuJSON，同时保留字符串里的网址、逗号和注释标记。
  const source = String(text); let clean = '', quoted = false, escaped = false; // 跟踪字符串边界，避免使用会破坏字符串的正则替换。
  for (let i = 0; i < source.length; i++) { const c = source[i], next = source[i + 1]; if (quoted) { clean += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; } else if (c === '"') { quoted = true; clean += c; } else if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; clean += '\n'; } else if (c === '/' && next === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++; if (i >= source.length) throw error(400, '策略注释没有闭合'); i++; clean += ' '; } else clean += c; } // 只移除字符串以外的注释。
  let normalized = ''; quoted = false; escaped = false; // 第二遍只处理对象或数组末尾的逗号。
  for (let i = 0; i < clean.length; i++) { const c = clean[i]; if (!quoted && c === ',' && /^[\s]*[}\]]/.test(clean.slice(i + 1))) continue; normalized += c; if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; } else if (c === '"') quoted = true; } // 字符串中的逗号与转义均原样保留。
  const policy = JSON.parse(normalized); if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw error(400, '策略必须是 JSON 对象'); return policy; // 只接受完整策略对象。
} // 结束策略解析。
export function enrollmentOptions({ policy, authMode, scopes = '', configured = true, etag = '', policyError = null }) { // 根据真实配置推导创建条件，不尝试创建密钥。
  const grants = String(scopes).split(/[\s,]+/), oauth = authMode === 'oauth', all = grants.includes('all'), known = grants.some(Boolean); // 区分 OAuth 授权范围与普通 API 令牌。
  const tags = Object.keys(policy?.tagOwners || {}).filter((tag) => /^tag:[a-z][a-z0-9-]*$/.test(tag)).sort(), defaultTag = tags.includes(MANAGED_TAG) ? MANAGED_TAG : tags.length === 1 ? tags[0] : ''; // 仅从已定义的标签中选择可确定的默认项。
  const canCreate = configured && !(oauth && known && !all && !grants.includes('auth_keys')); // 明确缺少创建设备密钥权限时在提交前提示。
  const canInitialize = configured && !policyError && Boolean(etag) && !tags.length && (!oauth || all || grants.includes('policy_file')); // 仅在可安全写策略且确实缺少标签时提供初始化。
  return { ok: true, authMode, requiresTags: oauth, tags, defaultTag, canCreate, policyError, scopeError: !configured ? '请先在设置中保存有效的管理凭证。' : !canCreate ? '当前 OAuth 缺少 auth_keys 写权限，请在官方后台调整授权。' : null, initialization: canInitialize ? { tag: MANAGED_TAG, owners: ['autogroup:admin'], revision: createHash('sha256').update(JSON.stringify(policy)).digest('hex'), etag } : null }; // 仅返回必要的授权元信息，不返回策略全文或秘密。
} // 结束创建条件生成。
export function initializePolicy(policy, revision) { // 为已明确确认的首次初始化生成最小语义变更。
  if (revision !== createHash('sha256').update(JSON.stringify(policy)).digest('hex')) throw error(409, '网络策略已变化，请刷新后重新确认标签初始化。'); // 防止旧表单覆盖更新后的策略。
  if (Object.keys(policy.tagOwners || {}).length) throw error(409, '网络已经有标签，请刷新后选择现有标签。'); // 不重复初始化或替换任何现有标签所有者。
  return { ...policy, tagOwners: { [MANAGED_TAG]: ['autogroup:admin'] } }; // 保留原有网络规则，仅定义管理员持有的设备标签。
} // 结束最小策略构造。
export function keyCreationError(status, message) { // 将官方注册密钥错误转换为具体可执行的提示。
  const safe = String(message || '').replace(/tskey-[\w-]+/g, '[已隐藏密钥]').slice(0, 600); // 隐去上游错误可能包含的凭证。
  if (/description.*invalid characters/i.test(safe)) return '密钥备注包含不支持的字符。请将用途备注改为英文设备名（例如 home-server），或清空备注后重新生成。'; // 将官方备注拒绝翻译为具体纠正方法。
  if (/must have tags|tags.*required/i.test(safe)) return 'OAuth 创建的设备注册密钥必须带标签。请在添加设备中选择已定义标签；尚无标签时先确认初始化。'; // 明确默认无标签失败的根因。
  if (/tags.*invalid|tags.*not permitted|invalid.*tag/i.test(safe)) return '所选标签未定义或当前 OAuth 无权使用。请刷新标签列表，确认 OAuth 授权包含该标签，或使用 API 管理令牌创建。'; // 区分格式有效和官方实际授权。
  if (status === 403) return '当前管理身份无权创建设备注册密钥，请检查 auth_keys 写权限及所选标签授权。'; // 不将所有授权问题归因于用户角色。
  if (status === 429) return 'Tailscale 请求过于频繁，请稍后再试；不要连续点击创建。'; // 正确解释官方限流。
  return safe || '注册密钥创建失败，请核对管理凭证和网络连接。'; // 保留有用且脱敏的其他错误。
} // 结束密钥错误翻译。
