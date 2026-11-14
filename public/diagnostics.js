export function collectNotices({ status, data, nodes, relays, error }, now = Date.now()) { // 从现有快照生成可解释的异常与到期提醒。
  const notices = [], add = (tone, title, text, tab) => notices.push({ tone, title, text, tab }); // 统一提醒结构供顶部和弹窗复用。
  if (status?.mock) add('info', '当前为演示模式', '这里的节点和密钥都是示例数据。', 'devices'); // 防止演示信息被当作真实告警。
  if (status && !status.mock && !status.hasToken) add('warn', '尚未配置管理令牌', '本机节点仍可查看，完整管理功能需要 API 管理令牌。', 'keys'); // 提供直接可操作的管理入口。
  if (error) add('warn', '管理 API 读取失败', '当前管理数据可能不是最新结果，请测试管理令牌与网络连接。', 'keys'); // 不显示可能包含外部内容的原始请求细节。
  if (status?.authMode === 'oauth' && status.oauth?.error) add('warn', 'OAuth 自动续期异常', status.oauth.error, 'keys'); // 将真实续期故障接入提醒中心。
  if (nodes && !nodes.available) add('warn', '本机客户端不可用', nodes.message || '请确认 Tailscale 已安装、运行并登录。', 'monitor'); // 客户端缺失不是零个正常节点。
  for (const peer of [nodes?.self, ...(nodes?.peers || [])].filter(Boolean)) { if (peer.online === false) add('warn', `${peer.hostname} 离线`, '客户端明确报告离线，可在节点信息中核对最近在线时间。', 'monitor'); else if (peer.online === null) add('info', `${peer.hostname} 状态未知`, '当前客户端没有提供在线结论。', 'monitor'); } // 在线未知与离线分别提醒。
  for (const message of nodes?.health || []) add('warn', '客户端健康提示', message, 'monitor'); // 保留实际客户端的健康信息。
  for (const key of data?.keys || []) { const expiry = Date.parse(key.expires || key.expiresAt || ''); if (!key.revoked && Number.isFinite(expiry) && expiry - now <= 7 * 86400000) add(expiry < now ? 'warn' : 'info', `设备注册密钥${expiry < now ? '已过期' : '即将到期'}`, `${key.description || key.id} · ${new Date(expiry).toLocaleDateString('zh-CN')}`, 'keys'); } // 仅按明确到期时间提醒，不能推测管理令牌有效期。
  for (const device of data?.devices || []) { const expiry = Date.parse(device.expires || ''); if (!device.keyExpiryDisabled && Number.isFinite(expiry) && expiry - now <= 14 * 86400000) add('warn', `${device.hostname} 设备密钥临近到期`, `到期日期 ${new Date(expiry).toLocaleDateString('zh-CN')}，请在设备详情中核对。`, 'devices'); } // 排除已明确禁用设备密钥到期的设备。
  for (const region of relays?.regions || []) if (region.custom && !region.loaded) add('warn', `自建中继 ${region.code} 尚未加载`, '区域只出现在网络策略中，当前客户端尚未加载。', 'nodes'); // 提醒配置与客户端映射不一致。
  for (const message of relays?.warnings || []) add('warn', '中继采集提示', message, 'nodes'); // 使用真实采集说明而非猜测离线。
  return notices; // 返回实际存在的提醒，不附加正常节点噪声。
} // 结束提醒收集。
export function buildDiagnosticReport({ status, nodes, relays }) { // 导出用于排障的白名单数据。
  const peer = (value) => ({ hostname: value.hostname, os: value.os, ips: value.ips, online: value.online, connection: value.connection, relay: value.relay, endpoint: value.endpoint, exitNode: value.exitNode, exitNodeOption: value.exitNodeOption, lastSeen: value.lastSeen, lastHandshake: value.lastHandshake, rxBytes: value.rxBytes, txBytes: value.txBytes }); // 排除公钥、用户配置和后台认证内容。
  const report = { schema: 1, generatedAt: new Date().toISOString(), service: { version: status?.version, mock: status?.mock, hasManagementToken: Boolean(status?.hasToken) }, client: nodes ? { available: nodes.available, backendState: nodes.backendState, observedAt: nodes.observedAt, version: nodes.version, health: nodes.health, self: nodes.self ? peer(nodes.self) : null, peers: (nodes.peers || []).map(peer) } : null, derp: relays ? { observedAt: relays.observedAt, latencyAt: relays.latencyAt, selfRelay: relays.selfRelay, warnings: relays.warnings, regions: (relays.regions || []).map((region) => ({ id: region.id, code: region.code, name: region.name, custom: region.custom, loaded: region.loaded, source: region.source, latencyMs: region.latencyMs, hosts: region.nodes.map((node) => ({ hostname: node.hostname, port: node.port, stunPort: node.stunPort })) })) } : null }; // 只导出节点与中继诊断需要的字段。
  return JSON.parse(JSON.stringify(report, (_, value) => typeof value === 'string' ? value.replace(/tskey-[A-Za-z0-9_-]+/g, '[令牌已隐藏]') : value)); // 防止异常消息或节点名称携带令牌文本。
} // 结束脱敏报告构建。
