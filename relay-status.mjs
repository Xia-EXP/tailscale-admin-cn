import { execFile } from 'node:child_process'; // 通过固定参数调用客户端，避免 shell 命令拼接。

export function parseRelayLatencies(text) { // 解析真实 netcheck 输出，兼容带连字符的区域代码。
  return Object.fromEntries([...String(text || '').matchAll(/^\s*-\s+([\w.-]+):\s*([\d.]+)\s*ms\b/gim)].filter((match) => Number.isFinite(Number(match[2]))).map((match) => [match[1], Number(match[2])])); // 没有返回延迟的区域保持未检测，而不是离线。
} // 结束延迟解析。

function regionEntries(map) { // 接受客户端与网络策略中的 DERP 映射。
  const regions = map?.Regions || map?.regions || {}; // 兼容两种字段大小写。
  return Object.entries(regions).filter(([, region]) => region && typeof region === 'object'); // 忽略无效区域记录。
} // 结束映射提取。

export function normalizeRelays({ map, status, policyMap, latencies = {}, latencyAt = null, warnings = [], mock = false }) { // 将映射、实际节点与延迟分开合并。
  const client = new Map(regionEntries(map).map(([key, region]) => [String(region.RegionID ?? key), region])); // 保留客户端实际加载的区域。
  const policy = new Map(regionEntries(policyMap).map(([key, region]) => [String(region.RegionID ?? key), region])); // 保留策略中配置但可能未加载的区域。
  const rawPeers = Object.values(status?.Peer || {}); // 读取本机可见的实际设备。
  const selfRelay = status?.Self?.Relay || null; // 单独记录本机的首选区域。
  const peers = rawPeers.map((peer) => ({ hostname: peer.HostName || peer.DNSName || '未命名设备', online: typeof peer.Online === 'boolean' ? peer.Online : null, relay: peer.Relay || null, activeRelay: peer.Online === true && peer.Active === true && !peer.CurAddr && !peer.PeerRelay ? peer.Relay || null : null })); // 区分首选中继与有活动证据的中继。
  const regions = [...new Set([...client.keys(), ...policy.keys()])].map((key) => { // 合并两个来源，策略单独存在的节点也不会被隐藏。
    const loaded = client.has(key), configured = policy.has(key), region = client.get(key) || policy.get(key); // 客户端实际加载的配置优先展示。
    const id = Number(region.RegionID ?? key), code = String(region.RegionCode || key); // 使用区域实际 ID 与代码。
    const nodes = (region.Nodes || []).map((node) => ({ name: node.Name || '', hostname: node.HostName || '', ipv4: node.IPv4 || null, ipv6: node.IPv6 || null, port: Number(node.DERPPort) || 443, stunPort: node.STUNPort === -1 ? null : Number(node.STUNPort) || 3478, stunOnly: node.STUNOnly === true, certName: node.CertName || null })); // 明确输出主机、端口、地址与 STUN 配置。
    const foreignHost = nodes.some((node) => node.hostname && !/(^|\.)tailscale\.com$/i.test(node.hostname)); // 检查节点是否使用官方域名。
    const custom = id >= 900 || foreignHost; // 结合区域编号与真实域名识别自建中继，不依赖地区名称。
    const usedBy = [...new Set([...(selfRelay === code ? [status?.Self?.HostName || '本机'] : []), ...peers.filter((peer) => peer.relay === code).map((peer) => peer.hostname)])]; // 汇总首选此区域的设备并去重。
    const activeBy = peers.filter((peer) => peer.activeRelay === code).map((peer) => peer.hostname); // 仅统计有活动中继证据的对等连接。
    return { id, code, name: region.RegionName || code, nodes, custom, customReason: custom ? id >= 900 ? '区域编号为 900 或以上' : '节点使用非官方域名' : '官方区域与域名', loaded, configured, source: loaded && configured ? 'both' : loaded ? 'client' : 'policy', home: loaded && selfRelay === code, latencyMs: Object.hasOwn(latencies, code) ? latencies[code] : null, usedBy, activeBy }; // 保留加载、来源、延迟与关联情况。
  }); // 结束区域标准化。
  regions.sort((a, b) => Number(b.custom) - Number(a.custom) || Number(b.home) - Number(a.home) || (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity) || a.id - b.id); // 将自建区域与本机首选区域放在最前面。
  return { ok: true, mock, available: Boolean(map || policyMap), observedAt: new Date().toISOString(), latencyAt, selfRelay, hostname: status?.Self?.HostName || '', backendState: status?.BackendState || 'Unknown', peers, regions, warnings, customCount: regions.filter((region) => region.custom).length, loadedCount: regions.filter((region) => region.loaded).length, policyChecked: Boolean(policyMap) }; // 提供前端需要的可解释采集元信息。
} // 结束区域快照合并。

export function mockRelays() { // 创建不含真实机器或域名的中继演示。
  const make = (id, code, name, hostname, port = 443) => ({ RegionID: id, RegionCode: code, RegionName: name, Nodes: [{ Name: `${id}a`, HostName: hostname, DERPPort: port }] }); // 构造标准 DERP 区域数据。
  return normalizeRelays({ map: { Regions: { 1: make(1, 'nyc', '纽约', 'derp1.tailscale.com'), 901: make(901, 'home', '家庭中继 · 演示', 'home.derp.example.com', 8443), 902: make(902, 'bj', '北京中继 · 演示', 'bj.derp.example.com', 8443) } }, status: { BackendState: 'Running', Self: { HostName: 'studio-desktop', Relay: 'bj' }, Peer: { nas: { HostName: 'home-nas', Online: true, Active: false, Relay: 'bj' }, server: { HostName: 'cloud-singapore', Online: true, Active: true, Relay: 'bj' } } }, latencies: { bj: 28.6, home: 67.3, nyc: 236.1 }, latencyAt: new Date().toISOString(), mock: true }); // 演示两个自建区域及其关联设备。
} // 结束中继演示。

function run(binary, args, timeout = 6000) { // 封装只读 CLI 命令的有界执行。
  return new Promise((resolve) => execFile(binary, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, text: String(stdout || ''), diagnostic: String(stderr || '') }))); // 不把本机命令错误和路径暴露给浏览器。
} // 结束命令封装。

export function createRelayReader(binary, readPolicy) { // 创建独立的映射读取与可选延迟检测器。
  let cached = null, cachedAt = 0, pending = null, probing = null, latencyAt = null, latencies = {}; // 分别管理快速映射和较慢探测的状态。
  async function readClient() { // 一次并发读取映射和节点，确保节点展示不被 netcheck 阻塞。
    if (cached && Date.now() - cachedAt < 4000) return cached; // 短时间重复请求使用同一映射。
    if (pending) return pending; // 合并同时到来的采集请求。
    pending = Promise.all([run(binary, ['debug', 'derp-map']), run(binary, ['status', '--json'])]).then(([mapping, state]) => { // 使用与节点监控相同的客户端路径。
      const parse = (result) => { try { const value = JSON.parse(result.text); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; } }; // 将缺失与无效 JSON 视作不可用。
      cached = { map: parse(mapping), status: parse(state) }; // 仅缓存只读原始数据供白名单标准化。
      cachedAt = Date.now(); // 记录本次真实采集时间。
      return cached; // 返回当前客户端信息。
    }).finally(() => { pending = null; }); // 完成后释放采集锁。
    return pending; // 等待正在进行的采集。
  } // 结束快速映射采集。
  return async ({ probe = false, policy = false } = {}) => { // 按用户动作决定是否额外探测或核对策略。
    const warnings = []; // 保存部分数据读取失败的说明。
    const probeOnce = async () => { // 显式检测时才运行 netcheck。
      if (!probing) probing = run(binary, ['netcheck'], 25000).then((report) => { latencies = parseRelayLatencies(`${report.text}\n${report.diagnostic}`); latencyAt = new Date().toISOString(); return report.ok; }).finally(() => { probing = null; }); // 并发检测共享任务，并解析两个输出流。
      return probing; // 返回探测任务。
    }; // 结束可选探测。
    const policyOnce = async () => { try { return await readPolicy?.(); } catch { warnings.push('无法读取网络策略，当前仍展示本机已加载的真实中继。请检查管理密钥权限。'); return null; } }; // 策略失败不得清空已发现的自建节点。
    const [client, probeOk, policyMap] = await Promise.all([readClient(), probe ? probeOnce() : true, policy ? policyOnce() : null]); // 独立采集任务并行执行。
    if (!client.map) warnings.push('无法读取本机 DERP 映射，请检查客户端是否已安装、运行并登录。'); // 明确客户端不可用而不是显示零个节点。
    if (!client.status?.Self) warnings.push('本机节点状态不可用，首选与活动关联信息可能不完整。'); // 保留可用的区域信息。
    if (!probeOk) warnings.push('延迟检测没有完整结束；未返回的延迟不能据此判断为离线。'); // 防止把探测失败当作中继离线。
    return normalizeRelays({ ...client, policyMap, latencies, latencyAt, warnings }); // 统一清理数据后再发送到浏览器。
  }; // 返回采集接口。
} // 结束中继采集器。
