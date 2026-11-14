import { execFile } from 'node:child_process'; // 使用参数数组调用本机客户端，避免 shell 插值。

export function connectionType(peer, self = false) { // 根据当前活动与路径证据判断连接类型。
  if (self) return 'self'; // 本机不参与对等连接方式统计。
  if (peer.Online === false) return 'offline'; // 明确离线时忽略历史路径。
  if (peer.Online !== true) return 'unknown'; // 缺少在线字段时保留未知状态。
  if (peer.Active === false) return 'idle'; // 空闲节点的地址可能是历史连接，不能作为当前路径。
  if (peer.Active !== true) return 'unknown'; // 未返回活动信息时不猜测连接方式。
  if (peer.CurAddr) return 'direct'; // 活动节点存在当前远端地址时显示直连。
  if (peer.PeerRelay) return 'peer-relay'; // 优先识别正在使用的对等中继。
  if (peer.Relay) return 'derp'; // 活动节点没有直连地址时识别 DERP 中继。
  return 'unknown'; // 无可用路径证据时保留待确认。
} // 结束连接分类。

function validDate(value) { // 排除 CLI 用于表示未记录时间的零日期。
  const time = Date.parse(value || ''); // 解析可选时间字段。
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null; // 只输出有效时间。
} // 结束时间清理。

export function normalizePeer(peer, self = false) { // 明确列出允许发送给浏览器的节点字段。
  const bytes = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; // 区分没有采集到流量与真实零流量。
  return { // 构造只读节点快照。
    id: String(peer.ID || peer.DNSName || peer.HostName || 'unknown'), // 为列表与详情生成稳定标识。
    hostname: peer.HostName || peer.DNSName || '未命名节点', // 提供可读名称。
    dnsName: peer.DNSName || '', // 展示 MagicDNS 完整名称。
    ips: Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : [], // 保留 IPv4 与 IPv6 地址。
    os: peer.OS || '', // 展示操作系统。
    online: typeof peer.Online === 'boolean' ? peer.Online : null, // 保留在线状态的三种情况。
    active: typeof peer.Active === 'boolean' ? peer.Active : null, // 保留原始活动状态。
    connection: connectionType(peer, self), // 生成有证据的连接分类。
    endpoint: peer.CurAddr || null, // 展示客户端报告的当前端点。
    relay: peer.Relay || null, // 单独展示首选 DERP 区域，避免与实际路径混淆。
    peerRelay: peer.PeerRelay || null, // 展示对等中继信息。
    rxBytes: bytes(peer.RxBytes), // 记录本机从该节点接收的累计字节。
    txBytes: bytes(peer.TxBytes), // 记录本机向该节点发送的累计字节。
    lastSeen: validDate(peer.LastSeen), // 保留最近在线时间。
    lastHandshake: validDate(peer.LastHandshake), // 保留最近握手时间。
    created: validDate(peer.Created), // 保留节点创建时间。
    exitNode: peer.ExitNode === true, // 标记本机正在使用的出口。
    exitNodeOption: peer.ExitNodeOption === true, // 标记可用出口候选。
    routes: Array.isArray(peer.PrimaryRoutes) ? peer.PrimaryRoutes : [], // 只展示 CLI 明确提供的主路由。
    self, // 标记本机节点。
  }; // 返回经过筛选的节点信息。
} // 结束节点标准化。

export function normalizeStatus(raw, mock = false) { // 将真实与演示 CLI 数据转换为统一响应。
  const peers = Object.values(raw.Peer || {}).map((peer) => normalizePeer(peer)); // 标准化本机可见的对等节点。
  const count = (predicate) => peers.filter(predicate).length; // 复用精确的计数规则。
  return { // 构造节点监控响应。
    ok: true, available: Boolean(raw.Self), mock, observedAt: new Date().toISOString(), // 标注采集时间与数据模式。
    backendState: raw.BackendState || 'Unknown', version: raw.Version || '', // 说明客户端运行与版本状态。
    health: Array.isArray(raw.Health) ? raw.Health.filter((item) => typeof item === 'string') : [], // 仅接收客户端健康提示文本。
    self: raw.Self ? normalizePeer(raw.Self, true) : null, peers, // 返回本机与对等节点。
    summary: { total: peers.length, online: count((p) => p.online === true), offline: count((p) => p.online === false), unknown: count((p) => p.online === null), direct: count((p) => p.connection === 'direct'), relayed: count((p) => ['derp', 'peer-relay'].includes(p.connection)), idle: count((p) => p.connection === 'idle') }, // 汇总互斥的在线状态与有证据的活动路径。
  }; // 返回统一快照。
} // 结束快照标准化。

export function mockStatus() { // 创建完全独立于真实客户端的演示节点。
  const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString(); // 为演示生成相对时间。
  const peer = (id, name, os, ip, extra = {}) => ({ ID: id, HostName: name, DNSName: `${name}.demo.ts.net.`, OS: os, TailscaleIPs: [ip], Online: true, Active: true, Relay: 'hkg', RxBytes: 38273024, TxBytes: 186241024, LastHandshake: ago(2), Created: ago(86400), ...extra }); // 统一演示节点字段。
  return normalizeStatus({ // 使用生产标准化逻辑生成演示响应。
    BackendState: 'Running', Version: '1.90.2 · 演示', Health: [], // 明确标注版本数据来自演示。
    Self: peer('local-demo', 'studio-desktop', 'windows', '100.64.0.1', { Relay: 'hkg', Active: false }), // 展示演示本机。
    Peer: { // 覆盖各种真实可见的状态分支。
      nas: peer('demo-nas', 'home-nas', 'linux', '100.64.0.10', { CurAddr: '192.168.31.10:41641', ExitNodeOption: true, RxBytes: 2834567168 }), // 演示活跃直连。
      server: peer('demo-server', 'cloud-singapore', 'linux', '100.64.0.20', { Relay: 'sin', ExitNode: true, ExitNodeOption: true }), // 演示实际 DERP 中继。
      laptop: peer('demo-laptop', 'work-macbook', 'macOS', '100.64.0.30', { CurAddr: '192.168.31.20:41641' }), // 演示第二个直连节点。
      phone: peer('demo-phone', 'my-iphone', 'iOS', '100.64.0.40', { Active: false, RxBytes: 0, TxBytes: 0 }), // 演示在线空闲节点。
      offline: peer('demo-offline', 'office-windows', 'windows', '100.64.0.50', { Online: false, Active: false, LastSeen: ago(180), LastHandshake: ago(185) }), // 演示离线及最后在线时间。
      unknown: peer('demo-unknown', 'travel-android', 'android', '100.64.0.60', { Online: undefined, Active: undefined, RxBytes: undefined, TxBytes: undefined }), // 演示未知状态与缺失指标。
    }, // 结束演示节点集合。
  }, true); // 始终携带演示标记。
} // 结束演示数据生成。

export function createNodeStatusReader(binary) { // 创建具有短缓存与请求合并的只读采集器。
  let cached = null, collectedAt = 0, pending = null; // 保存采集结果与正在进行的请求。
  return async () => { // 返回供 HTTP 路由使用的采集函数。
    if (cached && Date.now() - collectedAt < 4000) return cached; // 在四秒内复用快照，避免频繁启动 CLI。
    if (pending) return pending; // 并发浏览器请求共享一次采集。
    pending = new Promise((resolve) => { // 以显式错误结果处理 CLI 故障。
      execFile(binary, ['status', '--json'], { timeout: 6000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => { // 使用固定命令，绝不改动网络配置。
        try { // 区分命令执行失败与无效 JSON。
          if (error) throw error; // 将 CLI 失败转入统一提示。
          const raw = JSON.parse(stdout); // 解析客户端快照。
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('无效快照'); // 拒绝非对象输出。
          cached = normalizeStatus(raw); // 清理后再缓存，避免暴露额外客户端字段。
          if (!cached.available) cached.message = '本机客户端尚未提供节点信息，请检查是否已登录。'; // 为未登录状态提供下一步提示。
        } catch { // 不向浏览器输出本地路径或原始命令日志。
          cached = { ok: true, available: false, mock: false, observedAt: new Date().toISOString(), backendState: 'Unavailable', peers: [], self: null, health: [], message: '无法读取本机 Tailscale。请确认已安装客户端、服务正在运行并已登录。' }; // 提供可恢复的缺失状态。
        } // 结束采集错误处理。
        collectedAt = Date.now(); // 记录缓存生成时间。
        resolve(cached); // 返回当前采集结果。
      }); // 结束只读 CLI 调用。
    }).finally(() => { pending = null; }); // 无论成功失败都释放并发锁。
    return pending; // 等待本次实际采集。
  }; // 返回完整采集器。
} // 结束采集器工厂。
