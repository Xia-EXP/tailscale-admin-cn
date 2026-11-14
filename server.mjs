#!/usr/bin/env node
import { createFleetManager } from './fleet-manager.mjs'; // 多设备免密配对、批量任务与部署管理。
/**
 * Tailscale 中文管理台 — 本地服务器（零依赖 Node.js）
 * 功能：管理凭证仅存服务端；默认监听回环地址，局域网部署必须先配置访问密码；--mock 演示模式无需 Key。 */

import { createCredentialManager, isDeviceRegistrationKey } from './credential-manager.mjs'; // 接入凭证事务并区分注册密钥与 OAuth 客户端。
import { createRemoteManager, tailAddress } from './remote-manager.mjs'; // 接入固定 SSH 运维动作与节点目标校验。
import { createOAuthProvider } from './oauth-manager.mjs'; // 使用官方客户端凭证模式自动续期短期管理令牌。
import { keyDescription } from './public/key-description.js'; // 服务端也校验直接 API 和旧前端发来的密钥备注。
import { parsePolicy, enrollmentOptions, initializePolicy, keyCreationError, MANAGED_TAG } from './enrollment-manager.mjs'; // 在创建密钥前核对 OAuth 标签与最小初始化条件。
import { createAccessControl } from './access-control.mjs'; // 在域名和局域网部署时保护页面及全部管理接口。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { createNodeStatusReader, mockStatus } from './node-monitor.mjs'; // 引入独立的只读节点采集器与演示数据。
import { createRelayReader, mockRelays } from './relay-status.mjs'; // 将自建中继识别与延迟检测分开采集。
import { discoverConsoles } from './runtime-discovery.mjs'; // 让演示页面指向实际运行的新版真实服务。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const API_BASE = 'https://api.tailscale.com/api/v2';
const VERSION = '1.17.0'; // 标记官方布局中文版与自建中继可见性修复。

const argv = process.argv.slice(2);
const MOCK = argv.includes('--mock') || process.env.TSADMIN_MOCK === '1';
const AUTO_OPEN = !argv.includes('--no-open') && process.env.TSADMIN_NO_OPEN !== '1';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const authorizeAccess = createAccessControl({ file: path.join(DATA_DIR, 'access.json'), host: HOST, allowedHosts: (process.env.TSADMIN_ALLOWED_HOSTS || '').split(',').filter(Boolean) }); // 网络监听必须先配置密码和允许的域名。

const config = { token: '', tailnet: '-' };

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* ── 基础配置 ─────────────────────────────────────────────── */
/* ------------------------------------------------------------------ */

function loadConfig() {
  if (MOCK) { config.tailnet = 'demo-tailnet.ts.net'; return; } // 演示模式不读取真实凭证与网络配置。
  try {
    if (!fs.existsSync(CONFIG_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (typeof raw.credentialsUpdatedAt === 'string') config.credentialsUpdatedAt = raw.credentialsUpdatedAt; // 恢复最近一次实际替换时间。
    if (typeof raw.token === 'string') config.token = raw.token.trim();
    config.authMode = raw.authMode === 'oauth' ? 'oauth' : 'token'; // 兼容已有管理令牌配置，默认不改变认证方式。
    if (typeof raw.clientId === 'string') config.clientId = raw.clientId.trim(); // 读取用户主动保存的 OAuth 客户端标识。
    if (typeof raw.clientSecret === 'string') config.clientSecret = raw.clientSecret.trim(); // 客户端秘密仅保存在本机服务端配置。
    if (typeof raw.tailnet === 'string' && raw.tailnet.trim()) config.tailnet = raw.tailnet.trim();
    if (typeof raw.exitAutoFallback === 'boolean') config.exitAutoFallback = raw.exitAutoFallback;
  } catch (err) {
    console.warn('[warn] 读取配置失败，将使用空配置:', err.message);
  }
}

function persistConfiguration(next) { // 原子写入成功后才切换运行中的配置。
  if (!MOCK) { // 演示凭证替换始终只保存在内存。
    fs.mkdirSync(DATA_DIR, { recursive: true }); // 确保配置目录存在。
    const temporary = path.join(DATA_DIR, 'config-' + randomUUID() + '.tmp'); // 使用同目录独立临时文件准备提交。
    try { fs.writeFileSync(temporary, JSON.stringify({ token: next.token, authMode: next.authMode || 'token', clientId: next.clientId || '', clientSecret: next.clientSecret || '', tailnet: next.tailnet, exitAutoFallback: next.exitAutoFallback !== false, credentialsUpdatedAt: next.credentialsUpdatedAt || null }, null, 2), { mode: 0o600 }); fs.renameSync(temporary, CONFIG_FILE); } // 原子保存长期凭证，OAuth 短期访问令牌始终只缓存在内存。
    finally { if (fs.existsSync(temporary)) fs.rmSync(temporary); } // 清理失败提交留下的固定临时文件。
  } // 结束磁盘提交。
  Object.assign(config, next); // 写入成功后再让后续 API 请求使用新凭证。
} // 结束配置提交。

function tailnetPath() {
  return encodeURIComponent(config.tailnet || '-');
}

/* ------------------------------------------------------------------ */
/* Tailscale API 封装 ─────────────────────────────────────── */
/* ------------------------------------------------------------------ */

function mapUpstreamError(status, message) {
  switch (status) {
    case 401:
      return '管理凭证未通过验证，请在设置中检查 API 令牌或 OAuth 客户端授权'; // 同时覆盖两种身份而不误导 OAuth 用户更换 API Key。
    case 403:
      return '当前管理身份权限不足，请检查该操作所需的授权范围及标签权限'; // 权限不足不一定由用户角色造成。
    case 404:
      return '请求的资源或接口不存在，请刷新数据并核对目标'; // 不把所有资源不存在误报为付费限制。
    case 429:
      return '请求过于频繁，请稍后重试'; // 官方限流应当明确提示等待。
    default:
      if (status >= 500) return `Tailscale 服务端异常（HTTP ${status}），请稍后重试`;
      return message || `请求失败（HTTP ${status}）`;
  }
}

const tsAgent = new https.Agent({ keepAlive: true, maxVersion: 'TLSv1.2' });

// api.tailscale.com 的 192.200.0.0/24 边缘对 Node 24 的 TLS1.3/PQ ClientHello 会挂起，这里固定 TLS1.2。
function tsRequest(url, { method = 'GET', headers = {}, body, timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers,
      agent: tsAgent,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: res.headers, text });
      });
    });
    req.setTimeout(timeout, () => {
      const e = new Error('timeout');
      e.code = 'ETIMEDOUT';
      req.destroy(e);
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const oauthTokens = createOAuthProvider({ requestToken: async (candidate) => { // 使用官方 OAuth 端点交换短期访问令牌。
  if (MOCK) return { access_token: 'mock-oauth-access', token_type: 'Bearer', expires_in: 3600, scope: 'all' }; // 演示支持完整的内存管理流程，所有令牌与写入仍为合成数据。
  const response = await tsRequest(API_BASE + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: candidate.clientId, client_secret: candidate.clientSecret }).toString(), timeout: 15000 }); // 不指定额外 scope，使用官方客户端已授予的权限。
  if (!response.ok) throw new ApiError(response.status, 'OAuth 客户端凭证交换失败'); try { return JSON.parse(response.text); } catch { throw new ApiError(502, 'OAuth 响应不是合法 JSON'); } // 错误中不回传官方响应或客户端秘密。
} }); // 创建带并发合并及提前续期能力的访问令牌缓存。
async function tsApi(apiPath, { method = 'GET', body, rawBody, headers = {}, timeout = 20000, withMeta = false, token } = {}) { // 显式候选令牌优先，否则使用当前配置自动获取凭证。
  if (MOCK) return mockApi(apiPath, method, body);
  if (token === undefined) token = config.authMode === 'oauth' ? await oauthTokens.get(config) : config.token; // OAuth 到期前自动获取新的访问令牌，普通 API 令牌保持现有行为。
  if (!token) throw new ApiError(401, '尚未配置 API Key，请先进入「设置」填写');
  const url = `${API_BASE}${apiPath}`;
  let resp;
  try {
    resp = await tsRequest(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': `tailscale-admin-cn/${VERSION}`,
        ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
      timeout,
    });
  } catch (err) {
    const reason = err && err.code === 'ETIMEDOUT' ? '请求超时' : '网络错误';
    throw new ApiError(502, '无法连接 api.tailscale.com（' + reason + '）。请检查网络、代理或出口节点设置');
  }

  const text = resp.text;
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!resp.ok) {
    const upstream = (data && (data.message || data.error)) || '';
    throw new ApiError(resp.status, method === 'POST' && /\/keys$/.test(apiPath) ? keyCreationError(resp.status, upstream) : mapUpstreamError(resp.status, upstream)); // 保留密钥标签错误的具体修复方式，同时隐藏敏感内容。
  }
  if (withMeta) return { data, etag: resp.headers && resp.headers.etag };
  return data;

  return data;
}

async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 数据归一化 ─────────────────────────────────────────────── */
/* ------------------------------------------------------------------ */

function normalizeDevice(d) {
  const addresses = Array.isArray(d.addresses) ? d.addresses.filter(Boolean) : [];
  // 官方 devices API 有时不返回 online 字段，先标记为未知（null），再由本地状态兜底合并
  // 未知与明确的 false 区分开，避免把在线设备误判为离线（本地状态合并见 applyLocalOnline）
  const onlineKnown = typeof d.online === 'boolean' ? d.online : null;
  return {
    id: d.id || '',
    hostname: d.hostname || d.name || '未命名设备',
    name: d.name || '',
    os: d.os || '',
    clientVersion: d.clientVersion || '',
    sshEnabled: typeof d.sshEnabled === 'boolean' ? d.sshEnabled : null, // 区分官方明确开启、关闭和未返回的 Tailscale SSH 能力。
    ipv4: addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)) || '',
    ipv6: addresses.find((a) => a.includes(':')) || '',
    addresses,
    tags: Array.isArray(d.tags) ? d.tags.filter(Boolean) : [],
    online: onlineKnown === true,
    onlineKnown,
    onlineSource: onlineKnown === null ? 'unknown' : 'api',
    lastSeen: d.lastSeen && d.lastSeen !== '0001-01-01T00:00:00Z' ? d.lastSeen : null,
    created: d.created || null,
    expires: d.expires || null,
    authorized: d.authorized !== false,
    admin: d.admin === true,
    keyExpiryDisabled: d.keyExpiryDisabled === true,
    updateAvailable: d.updateAvailable === true,
    blocksIncomingConnections: d.blocksIncomingConnections === true,
    user: d.user || '',
  };
}

function normalizeUser(u) {
  return {
    id: u.id || '',
    loginName: u.loginName || '',
    displayName: u.displayName || u.loginName || '未命名用户',
    role: u.role || 'member',
    status: u.status || 'active',
    created: u.created || null,
    deviceCount: typeof u.deviceCount === 'number' ? u.deviceCount : null,
    type: u.type || 'member',
  };
}

function normalizeKey(k) {
  const caps = k.capabilities || {};
  const create = (caps.devices && caps.devices.create) || {};
  return {
    id: k.id || '',
    description: k.description || '',
    created: k.created || null,
    expires: k.expires || null,
    revoked: Boolean(k.revoked), // 官方吊销时间字符串与演示布尔值都视为已经吊销。
    reusable: (create.reusable ?? k.reusable) === true, // 兼容已标准化的演示密钥字段。
    ephemeral: (create.ephemeral ?? k.ephemeral) === true, // 保留临时节点属性。
    preauthorized: (create.preauthorized ?? k.preauthorized) === true, // 保留预授权属性。
    tags: Array.isArray(create.tags) ? create.tags : Array.isArray(k.tags) ? k.tags : [], // 兼容真实和演示来源的标签。
  };
}

function sortDevices(list) {
  const rank = (d) => (d.online === true ? 0 : d.onlineKnown === null ? 1 : 2);
  return list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return String(a.hostname).localeCompare(String(b.hostname), 'zh-CN');
  });
}

/**
 * 用本地 `tailscale status --json` 的 peer 信息兜底在线状态：Admin API 的 devices 列表有时缺 online 字段（或恒为 false），
 * 而本机 tailscale 能看到同一 tailnet 的大量 peer 及其 Online 字段；两者按 IP/hostname 合并。 */
function applyLocalOnline(list, local) {
  if (!local || !Array.isArray(local.peerInfo) || !local.peerInfo.length) return list;
  const byIp = new Map();
  const byHost = new Map();
  for (const p of local.peerInfo) {
    (p.ips || []).forEach((ip) => {
      if (ip) byIp.set(ip, p);
    });
    if (p.hostname) byHost.set(String(p.hostname).toLowerCase(), p);
  }
  const selfIp = local.ip || '';
  return list.map((d) => {
    const peer =
      (d.ipv4 && byIp.get(d.ipv4)) ||
      (d.ipv6 && byIp.get(d.ipv6)) ||
      byHost.get(String(d.hostname || '').toLowerCase());
    if (peer) {
      return {
        ...d,
        online: peer.online === true,
        onlineKnown: true,
        onlineSource: 'local',
        lastSeen: d.lastSeen || peer.lastSeen || null,
      };
    }
    if (selfIp && (d.ipv4 === selfIp || d.ipv6 === selfIp || (d.addresses || []).includes(selfIp))) {
      return { ...d, online: local.online !== false, onlineKnown: true, onlineSource: 'local' };
    }
    return d;
  });
}

/* ------------------------------------------------------------------ */
/* ── 调用本机 tailscale CLI ───────────────────────────────── */
/* ------------------------------------------------------------------ */

let localCache = { at: 0, value: null };

function execJson(cmd, args, timeout = 1600) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return done(null);
        try {
          done(JSON.parse(stdout));
        } catch {
          done(null);
        }
      }).on('error', () => done(null));
    } catch {
      done(null);
    }
  });
}

async function localTailscale() {
  if (MOCK) { const demo = mockStatus(); return { hostname: demo.self.hostname, ip: demo.self.ips[0], online: true, peers: demo.peers.length, backendState: demo.backendState, version: demo.version, peerInfo: [] }; } // 演示模式只返回模拟身份，避免混入真实本机信息。
  if (Date.now() - localCache.at < 10000) return localCache.value;
  const json = (await execJson('tailscale', ['status', '--json'])) || (await execJson('tailscale.exe', ['status', '--json']));
  let value = null;
  if (json && json.Self) {
    const self = json.Self;
    const peerList = json.Peer ? Object.values(json.Peer) : [];
    value = {
      hostname: self.HostName || '',
      dnsName: self.DNSName || '',
      ip: (self.TailscaleIPs || [])[0] || '',
      online: self.Online !== false,
      os: self.OS || '',
      peers: peerList.length,
      backendState: json.BackendState || '',
      version: json.Version || '',
      magicDNSEnabled: !!(json.CurrentTailnet && json.CurrentTailnet.MagicDNSEnabled),
      peerInfo: peerList.map((p) => ({
        hostname: p.HostName || '',
        dnsName: p.DNSName || '',
        ips: Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs : [],
        online: p.Online === true,
        os: p.OS || '',
        lastSeen: p.LastSeen || null,
      })),
    };
  }
  localCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------------ */
/* Mock 演示数据 ──────────────────────────────────────────── */
/* ------------------------------------------------------------------ */

const mockDb = (() => {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  return {
    tailnet: { name: 'demo-tailnet.ts.net', displayName: '演示网络' },
    settings: {
      devicesApprovalOn: false,
      usersApprovalOn: false,
      devicesAutoUpdatesOn: true,
      devicesKeyDurationDays: 180,
      networkFlowLoggingOn: false,
      regionalRoutingOn: false,
      postureIdentityCollectionOn: false,
    },
    devices: [
      { id: 'nDemo005WIN', name: 'studio-windows.demo-tailnet.ts.net', hostname: 'studio-windows', os: 'windows', clientVersion: '1.90.2', addresses: ['100.101.1.40'], tags: ['tag:work'], online: true, lastSeen: iso(1000), created: iso(10 * 864e5), expires: iso(-150 * 864e5), authorized: true, keyExpiryDisabled: false, user: 'owner@example.com' }, // 为远程桌面和 Windows 升级提供独立演示设备。
      {
        id: 'nDemo001MAC',
        name: 'macbook-pro.demo-tailnet.ts.net',
        hostname: 'macbook-pro',
        os: 'macOS',
        clientVersion: '1.80.2-t7c1d8f1',
        addresses: ['100.101.1.11', 'fd7a:115c:a1e0::11'],
        tags: ['tag:work'],
        online: true,
        lastSeen: iso(25 * 1000),
        created: iso(320 * 864e5),
        expires: iso(-150 * 864e5),
        authorized: true,
        admin: true,
        keyExpiryDisabled: false,
        updateAvailable: false,
        user: 'owner@example.com',
      },
      {
        id: 'nDemo002IPH',
        name: 'iphone-15.demo-tailnet.ts.net',
        hostname: 'iphone-15',
        os: 'iOS',
        clientVersion: '1.80.0',
        addresses: ['100.101.1.12', 'fd7a:115c:a1e0::12'],
        tags: [],
        online: true,
        lastSeen: iso(40 * 1000),
        created: iso(120 * 864e5),
        expires: iso(-10 * 864e5),
        authorized: true,
        admin: false,
        keyExpiryDisabled: false,
        updateAvailable: false,
        user: 'owner@example.com',
      },
      {
        id: 'nDemo003NAS',
        name: 'synology-nas.demo-tailnet.ts.net',
        hostname: 'synology-nas',
        os: 'Synology DSM',
        clientVersion: '1.78.3-t5a2b9c0',
        addresses: ['100.101.1.20', 'fd7a:115c:a1e0::20'],
        tags: ['tag:server', 'tag:home'],
        online: false,
        lastSeen: iso(3 * 3600e3),
        created: iso(540 * 864e5),
        expires: iso(-300 * 864e5),
        authorized: true,
        admin: false,
        keyExpiryDisabled: true,
        updateAvailable: true,
        user: 'dev@example.com',
      },
      {
        id: 'nDemo004SRV',
        name: 'ubuntu-vps.demo-tailnet.ts.net',
        hostname: 'ubuntu-vps',
        os: 'Linux',
        clientVersion: '1.79.2-t11f0e3a',
        addresses: ['100.101.1.30', 'fd7a:115c:a1e0::30'],
        tags: ['tag:server'],
        online: false,
        lastSeen: iso(26 * 864e5),
        created: iso(90 * 864e5),
        expires: iso(-2 * 864e5),
        authorized: false,
        admin: false,
        keyExpiryDisabled: false,
        updateAvailable: false,
        user: 'dev@example.com',
      },
    ],
    routes: {
      nDemo005WIN: { advertisedRoutes: [], enabledRoutes: [] }, // Windows 演示设备不公布出口或子网路由。
      nDemo001MAC: { advertisedRoutes: ['10.0.0.0/24'], enabledRoutes: ['10.0.0.0/24'] },
      nDemo002IPH: { advertisedRoutes: [], enabledRoutes: [] },
      nDemo003NAS: { advertisedRoutes: ['192.168.1.0/24', '0.0.0.0/0', '::/0'], enabledRoutes: ['192.168.1.0/24'] },
      nDemo004SRV: { advertisedRoutes: [], enabledRoutes: [] },
    },
    users: [
      { id: 'uDemo001', loginName: 'owner@example.com', displayName: '示例所有者', role: 'owner', status: 'active', created: iso(700 * 864e5), deviceCount: 2, type: 'member' },
      { id: 'uDemo002', loginName: 'dev@example.com', displayName: '示例成员', role: 'member', status: 'active', created: iso(200 * 864e5), deviceCount: 2, type: 'member' },
    ],
    keys: [
      {
        id: 'kDemo001',
        description: 'NAS 备份脚本（演示）',
        created: iso(20 * 864e5),
        expires: iso(-70 * 864e5),
        revoked: false,
        reusable: true,
        ephemeral: false,
        preauthorized: true,
        tags: ['tag:server'],
      },
      {
        id: 'kDemo002',
        description: '示例 CI 密钥',
        created: iso(3 * 864e5),
        expires: iso(-5 * 864e5),
        revoked: true,
        reusable: false,
        ephemeral: true,
        preauthorized: false,
        tags: [],
      },
    ],
  };
})();

const mockDelay = () => new Promise((r) => setTimeout(r, 45));

async function mockApi(apiPath, method, body) {
  await mockDelay();
  const u = new URL('http://mock.local' + apiPath);
  const p = u.pathname;
  const db = mockDb;

  const deviceMatch = p.match(/^\/device\/([^/]+)(\/[a-z]+)?$/);
  if (deviceMatch) {
    const id = decodeURIComponent(deviceMatch[1]);
    const sub = deviceMatch[2] || '';
    const dev = db.devices.find((d) => d.id === id);
    if (!dev) throw new ApiError(404, 'Mock: 设备不存在');
    if (!sub) {
      if (method === 'GET') return { ...dev };
      if (method === 'DELETE') {
        db.devices = db.devices.filter((d) => d.id !== id);
        delete db.routes[id];
        return null;
      }
      throw new ApiError(405, 'Mock: 不支持的设备操作');
    }
    if (sub === '/authorized' && method === 'POST') {
      dev.authorized = !!(body && body.authorized);
      return { ...dev };
    }
    if (sub === '/expire' && method === 'POST') {
      dev.online = false;
      dev.expires = new Date(Date.now() - 60e3).toISOString();
      return { ...dev };
    }
    if ((sub === '/rename' || sub === '/name') && method === 'POST') {
      const name = String((body && body.name) || '').trim();
      if (!name) throw new ApiError(400, '设备名称不能为空');
      dev.hostname = name;
      dev.name = `${name}.demo-tailnet.ts.net`;
      return { ...dev };
    }
    if (sub === '/tags' && method === 'POST') {
      dev.tags = Array.isArray(body && body.tags) ? body.tags : [];
      return { ...dev };
    }
    if (sub === '/key' && method === 'POST') {
      dev.keyExpiryDisabled = !!(body && body.keyExpiryDisabled);
      return { ...dev };
    }
    if (sub === '/routes') {
      const r = db.routes[id] || (db.routes[id] = { advertisedRoutes: [], enabledRoutes: [] });
      if (method === 'GET') return { ...r };
      if (method === 'POST') {
        r.enabledRoutes = Array.isArray(body && body.routes) ? body.routes : [];
        return { ...r };
      }
      if (method === 'DELETE') {
        const del = new Set((body && body.routes) || []);
        r.enabledRoutes = r.enabledRoutes.filter((x) => !del.has(x));
        return { ...r };
      }
    }
    throw new ApiError(404, 'Mock: 路由记录不存在');
  }

  const keyMatch = p.match(/^\/tailnet\/[^/]+\/keys(?:\/([^/]+))?$/);
  if (keyMatch) {
    if (!keyMatch[1] && method === 'GET') return { keys: db.keys.map((k) => ({ ...k, capabilities: { devices: { create: { reusable: k.reusable, ephemeral: k.ephemeral, preauthorized: k.preauthorized, tags: k.tags } } } })) };
    if (!keyMatch[1] && method === 'POST') {
      const create = (body && body.capabilities && body.capabilities.devices && body.capabilities.devices.create) || {};
      const key = {
        id: 'k' + randomUUID().slice(0, 8),
        description: String((body && body.description) || '未命名密钥'),
        created: new Date().toISOString(),
        expires: new Date(Date.now() + (Number(body && body.expirySeconds) || 90 * 86400) * 1000).toISOString(),
        revoked: false,
        reusable: !!create.reusable,
        ephemeral: !!create.ephemeral,
        preauthorized: !!create.preauthorized,
        tags: Array.isArray(create.tags) ? create.tags : [],
      };
      db.keys.unshift(key);
      return { ...key, key: 'tskey-auth-' + randomBytes(18).toString('base64url') };
    }
    if (keyMatch[1] && method === 'DELETE') {
      const id = decodeURIComponent(keyMatch[1]);
      const k = db.keys.find((x) => x.id === id);
      if (!k) throw new ApiError(404, 'Mock: 密钥不存在');
      k.revoked = true;
      return { ...k };
    }
    throw new ApiError(405, 'Mock: 不支持的密钥操作');
  }

  if (/^\/tailnet\/[^/]+\/devices$/.test(p) && method === 'GET') {
    return { devices: db.devices.map((d) => ({ ...d })) };
  }
  if (/^\/tailnet\/[^/]+\/users$/.test(p) && method === 'GET') {
    return { users: db.users.map((u2) => ({ ...u2 })) };
  }
  if (/^\/tailnet\/[^/]+\/settings$/.test(p) && method === 'GET') {
    return { ...db.settings };
  }
  if (/^\/tailnet\/[^/]+\/?$/.test(p) && method === 'GET') {
    return { ...db.tailnet };
  }
  throw new ApiError(404, `Mock: 未实现的接口 ${method} ${apiPath}`);
}

/* ------------------------------------------------------------------ */
/* API：概览 / 设备 / 密钥 ─────────────────────────────────── */
/* ------------------------------------------------------------------ */

async function apiStatus(res) {
  const local = await localTailscale();
  sendJson(res, 200, {
    ok: true,
    version: VERSION,
    mock: MOCK,
    connected: MOCK || credentials.info().hasToken,
    hasToken: credentials.info().hasToken, authMode: config.authMode || 'token', oauth: config.authMode === 'oauth' ? oauthTokens.info(config) : null, // 用实际认证模式判断是否配置，且只返回脱敏续期信息。
    tailnet: config.tailnet,
    local,
    serverTime: new Date().toISOString(),
  });
}

async function apiOverview(res) {
  let devicesRes;
  try {
    devicesRes = await tsApi(`/tailnet/${tailnetPath()}/devices`);
  } catch (err) {
    throw err instanceof ApiError ? err : new ApiError(500, '内部错误：' + err.message);
  }
  const [usersRes, keysRes, settingsRes, tailnetRes, local] = await Promise.all([
    safe(() => tsApi(`/tailnet/${tailnetPath()}/users`)),
    safe(() => tsApi(`/tailnet/${tailnetPath()}/keys?all=true`)), // OAuth 默认仅列出客户端，显式读取全部类型后再按用途筛选。
    safe(() => tsApi(`/tailnet/${tailnetPath()}/settings`)),
    safe(() => tsApi(`/tailnet/${tailnetPath()}`)),
    localTailscale(),
  ]);

  const baseDevices = (devicesRes.devices || []).map(normalizeDevice);
  const devices = sortDevices(MOCK ? baseDevices : applyLocalOnline(baseDevices, local));
  const users = (usersRes && usersRes.users ? usersRes.users : []).map(normalizeUser);
  const keys = (keysRes && keysRes.keys ? keysRes.keys : []).filter(isDeviceRegistrationKey).map(normalizeKey); // 不将用于自动续期的 OAuth 客户端放进注册密钥表。
  const now = Date.now();
  const activeKeys = keys.filter((k) => !k.revoked && !(k.expires && Date.parse(k.expires) < now));
  const expiringKeys = activeKeys.filter((k) => k.expires && Date.parse(k.expires) - now < 7 * 864e5);

  sendJson(res, 200, {
    ok: true,
    mock: MOCK,
    updatedAt: new Date().toISOString(),
    tailnet: {
      name: (tailnetRes && (tailnetRes.name || tailnetRes.dnsName)) || (config.tailnet === '-' ? '默认网络' : config.tailnet),
    },
    stats: {
      devices: devices.length,
      online: devices.filter((d) => d.online === true).length,
      offline: devices.filter((d) => d.onlineKnown !== null && d.online === false).length,
      unknown: devices.filter((d) => d.onlineKnown === null).length,
      keys: activeKeys.length,
      users: users.length,
      expiringKeys: expiringKeys.length,
    },
    devices,
    keys,
    users,
    settings: settingsRes || null,
    local,
  });
}

async function apiDevices(res) {
  const [data, local] = await Promise.all([tsApi(`/tailnet/${tailnetPath()}/devices`), localTailscale()]);
  const base = (data.devices || []).map(normalizeDevice);
  sendJson(res, 200, {
    ok: true,
    devices: sortDevices(MOCK ? base : applyLocalOnline(base, local)),
    local: local ? { hostname: local.hostname, ip: local.ip, online: local.online } : null,
  });
}

function requireId(raw) {
  const id = String(raw || '').trim();
  if (!id) throw new ApiError(400, '缺少设备 ID');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ApiError(400, '设备 ID 格式不正确');
  return id;
}

async function getDeviceRaw(id) {
  try {
    return await tsApi(`/device/${id}?fields=all`); // 获取真实 SSH 能力等扩展字段，标准化后仍只回传白名单。
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      const list = await tsApi(`/tailnet/${tailnetPath()}/devices`);
      const found = (list.devices || []).find((d) => d.id === id);
      if (found) return found;
      throw new ApiError(404, '设备不存在或未授权');
    }
    throw err;
  }
}

async function apiDevice(res, url) {
  const id = requireId(url.searchParams.get('id'));
  const [raw, local] = await Promise.all([getDeviceRaw(id), localTailscale()]);
  const base = normalizeDevice(raw);
  const [device] = MOCK ? [base] : applyLocalOnline([base], local);
  sendJson(res, 200, { ok: true, device });
}

const remoteFile = path.join(DATA_DIR, 'remote-profiles.json'); // SSH 配置独立于管理令牌，避免互相覆盖。
const remoteManager = createRemoteManager({ // 每项 SSH 操作通过统一的任务管理器执行。
  mock: MOCK, binary: process.env.TSADMIN_SSH_BIN || (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe') : 'ssh'), // 明确使用系统 OpenSSH 路径并允许部署时指定程序。
  load: () => { if (MOCK) return {}; try { return JSON.parse(fs.readFileSync(remoteFile, 'utf8')); } catch { return {}; } }, // 演示模式不读取真实 SSH 连接配置。
  persist: (next) => { if (MOCK) return; fs.mkdirSync(DATA_DIR, { recursive: true }); const temporary = remoteFile + '.' + randomUUID() + '.tmp'; try { fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 }); fs.renameSync(temporary, remoteFile); } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary); } }, // 使用独立临时文件原子保存非密码连接参数。
  resolveTarget: async (id) => { // 目标地址仅从管理 API 或本机可见节点解析。
    requireId(id); const snapshot = MOCK ? mockStatus() : await readNodeStatus(), node = [snapshot.self, ...(snapshot.peers || [])].find((item) => item?.id === id); // 无管理凭证时仍可对可见设备配置 SSH。
    if (node) return { id, hostname: node.hostname, os: node.os, address: node.ips.find(ip=>tailAddress(ip)&&!ip.includes(':')) || node.ips.find(tailAddress) || '' }; // 优先使用客户端当前公布的真实地址。
    const raw = await getDeviceRaw(id), device = normalizeDevice(raw); return { id, hostname: device.hostname, os: device.os, sshEnabled: device.sshEnabled, address: [device.ipv4,device.ipv6].find(tailAddress) || (device.addresses || []).find(tailAddress) || '' }; // API 设备保留真实 SSH 能力，且必须具有覆盖网络地址。
  }, // 结束可信目标解析。
}); // 结束远程管理器接入。
async function apiRemote(req, res, url) { // 将远程模块的可预期错误转成中文 API 响应。
  try { const id = url.searchParams.get('id'); if (req.method === 'GET') return sendJson(res, 200, url.pathname.endsWith('/job') ? remoteManager.job(id) : await remoteManager.info(id)); const body = await readBody(req); return sendJson(res, 200, url.pathname.endsWith('/profile') ? await remoteManager.save(requireId(id), body) : await remoteManager.start(requireId(id), body)); } // 将配置提交和任务创建限制在各自的明确入口。
  catch (error) { throw new ApiError(error.status || 500, error.status ? error.message : '远程运维处理失败，请检查本机 SSH 配置与数据目录权限'); } // 不把本机文件错误或认证内容写入响应。
} // 结束远程 HTTP 适配。

const fleetManager=createFleetManager({directory:path.join(DATA_DIR,'fleet'),remote:remoteManager,mock:MOCK}); // 私钥与配对状态仅保存在本机 data 中。
async function apiFleet(req,res,url){try{if(req.method==='GET')return sendJson(res,200,url.pathname.endsWith('/batch')?fleetManager.batch(url.searchParams.get('id')):await fleetManager.info());const body=await readBody(req);const action=url.pathname.split('/').at(-1),result=action==='initialize'?await fleetManager.initialize():action==='setup'?await fleetManager.plans(body):action==='import'?await fleetManager.importReceipts(body):action==='preview'?await fleetManager.preview(body):action==='batch'?await fleetManager.start(body):fleetManager.cancel(body.id);return sendJson(res,200,result);}catch(error){throw new ApiError(error.status||500,error.status?error.message:'终端管理处理失败，请检查本机 OpenSSH 和数据目录权限');}} // 所有修改仍受统一认证、同源和写入头保护。

async function apiDeviceRoutes(res, url) {
  const id = requireId(url.searchParams.get('id'));
  const data = await tsApi(`/device/${id}/routes`);
  const advertised = Array.isArray(data && data.advertisedRoutes) ? data.advertisedRoutes : [];
  const enabled = Array.isArray(data && data.enabledRoutes) ? data.enabledRoutes : [];
  sendJson(res, 200, {
    ok: true,
    advertisedRoutes: advertised,
    enabledRoutes: enabled,
    exitNodeEnabled: enabled.includes('0.0.0.0/0') && enabled.includes('::/0'),
  });
}

function normalizeRouteList(input) {
  if (!Array.isArray(input)) throw new ApiError(400, 'routes 必须是数组');
  const out = [];
  for (const item of input) {
    const r = String(item || '').trim();
    if (!r) continue;
    if (!/^(\d{1,3}(\.\d{1,3}){3}\/\d{1,2}|[0-9a-fA-F:]+\/\d{1,3})$/.test(r)) {
      throw new ApiError(400, `路由格式不正确：${r}（示例 192.168.1.0/24 或 fd00::/64）`);
    }
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

async function apiDeviceRoutesSet(req, res) {
  const body = await readBody(req);
  const id = requireId(body.id);
  const routes = normalizeRouteList(body.routes);
  await tsApi(`/device/${id}/routes`, { method: 'POST', body: { routes } });
  const data = await tsApi(`/device/${id}/routes`);
  const enabled = Array.isArray(data && data.enabledRoutes) ? data.enabledRoutes : routes;
  sendJson(res, 200, { ok: true, enabledRoutes: enabled, advertisedRoutes: Array.isArray(data && data.advertisedRoutes) ? data.advertisedRoutes : [] });
}

async function expireDeviceKey(id) {
  const attempts = [`/device/${id}/expire`, `/device/${id}/key`];
  let lastErr = null;
  for (const p of attempts) {
    try {
      await tsApi(p, { method: 'POST', body: {} });
      return;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 405)) throw err;
    }
  }
  if (lastErr && lastErr instanceof ApiError && lastErr.status === 404) {
    throw new ApiError(404, '未找到该设备，或该操作不被官方 API 支持');
  }
  throw lastErr || new ApiError(500, '操作失败');
}

async function renameDevice(id, name) {
  const attempts = [`/device/${id}/rename`, `/device/${id}/name`];
  let lastErr = null;
  for (const p of attempts) {
    try {
      await tsApi(p, { method: 'POST', body: { name } });
      return;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 405)) throw err;
    }
  }
  throw new ApiError(404, '该设备不支持此操作或已被移除' + (lastErr ? '（' + lastErr.message + '）' : ''));
}

function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[,\s\u3000]+/);
  const out = [];
  for (const item of list) {
    let t = String(item || '').trim().toLowerCase();
    if (!t) continue;
    if (!t.startsWith('tag:')) t = 'tag:' + t;
    if (!/^tag:[a-z][a-z0-9-]{0,62}$/.test(t)) throw new ApiError(400, '标签格式不正确：使用 tag: 加英文字母、数字或连字符，例如 tag:server'); // 接受合法的单字母标签，并拒绝静默改写无效输入。
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

async function apiDeviceAction(req, res) {
  const body = await readBody(req);
  const id = requireId(body.id);
  const action = String(body.action || '');

  switch (action) {
    case 'authorize':
      await tsApi(`/device/${id}/authorized`, { method: 'POST', body: { authorized: !!body.authorized } });
      break;
    case 'expire':
      await expireDeviceKey(id);
      break;
    case 'rename': {
      const name = String(body.name || '').trim();
      if (!name) throw new ApiError(400, '设备名称不能为空');
      if (name.length > 253) throw new ApiError(400, '设备名称过长');
      await renameDevice(id, name);
      break;
    }
    case 'tags': {
      const tags = normalizeTags(body.tags);
      await tsApi(`/device/${id}/tags`, { method: 'POST', body: { tags } });
      break;
    }
    case 'delete':
      await tsApi(`/device/${id}`, { method: 'DELETE' });
      break;
    default:
      throw new ApiError(400, '不支持的操作：' + action);
  }
  sendJson(res, 200, { ok: true });
}

async function apiKeys(res) {
  const data = await tsApi(`/tailnet/${tailnetPath()}/keys?all=true`); // 显式请求网络全部密钥类型以适配 OAuth 身份。
  sendJson(res, 200, { ok: true, keys: (data.keys || []).filter(isDeviceRegistrationKey).map(normalizeKey) }); // 仅回传设备注册密钥的非敏感元信息。
}

async function readEnrollmentPolicy() { // 独立读取用于标签选择的当前网络策略与并发标识。
  if (MOCK) return { policy: parsePolicy(mockAcl), etag: '"' + Buffer.from(mockAcl).toString('base64url') + '"' }; // 演示策略版本随内容变化，便于验证并发保护。
  const { data, etag } = await tsApi(`/tailnet/${tailnetPath()}/acl`, { headers: { Accept: 'application/json' }, withMeta: true }); return { policy: typeof data === 'string' ? parsePolicy(data) : data, etag: etag || '' }; // 优先读取官方 JSON 表示以保留全部规则语义。
} // 结束标签策略读取。
async function getEnrollmentOptions() { // 在页面展示前检查真实标签和授权范围。
  let snapshot = {}, policyError = null; try { snapshot = await readEnrollmentPolicy(); } catch (error) { policyError = '无法读取标签列表：' + error.message; } // 读取失败仍允许用户手动填写已知标签，不擅自初始化策略。
  return enrollmentOptions({ ...snapshot, policyError, authMode: config.authMode || 'token', scopes: oauthTokens.info(config)?.scopes || '', configured: MOCK || credentials.info().hasToken }); // 返回不含长期凭证的创建条件。
} // 结束添加设备条件获取。
async function apiEnrollmentPrepare(req, res) { // 仅在用户明确确认后添加一个首次设备标签。
  const body = await readBody(req); if (body.confirmed !== true || body.tag !== MANAGED_TAG || typeof body.revision !== 'string') throw new ApiError(400, '请先查看并确认新增管理员持有的节点标签。'); // 不能通过普通打开页面触发策略写入。
  const snapshot = await readEnrollmentPolicy(), options = enrollmentOptions({ ...snapshot, authMode: config.authMode || 'token', scopes: oauthTokens.info(config)?.scopes || '', configured: MOCK || credentials.info().hasToken }); // 提交时重新检查当前状态与真实授权。
  if (!options.initialization) throw new ApiError(409, '现在不能初始化标签，请刷新创建条件或到访问控制检查现有标签。'); // 不覆盖已有标签或使用缺失的并发标识。
  let next; try { next = initializePolicy(snapshot.policy, body.revision); } catch (error) { throw new ApiError(error.status || 400, error.message); } // 将过期表单转换为可恢复的冲突提示。
  if (MOCK) mockAcl = JSON.stringify(next, null, 2); else { try { await tsApi(`/tailnet/${tailnetPath()}/acl`, { method: 'POST', rawBody: JSON.stringify(next, null, 2), headers: { 'Content-Type': 'application/json', 'If-Match': snapshot.etag } }); } catch (error) { if (error.status === 412) throw new ApiError(409, '网络策略已被其他人修改，请刷新后重试。'); throw error; } } // 使用官方 If-Match 避免覆盖其他管理员的并发修改。
  sendJson(res, 200, { ok: true, tag: MANAGED_TAG, options: await getEnrollmentOptions() }); // 成功后重新读取标签，不伪造可用状态。
} // 结束首次标签初始化。

const KEY_EXPIRY_PRESETS = {
  '1d': 86400,
  '7d': 604800,
  '30d': 2592000,
  '90d': 7776000,
};

async function apiKeysCreate(req, res) {
  const body = await readBody(req);
  let description; try { description = keyDescription(body.description); } catch (error) { throw new ApiError(400, error.message); } // 将备注校验转换成输入错误，在请求上游前返回。
  let expirySeconds = Number(body.expirySeconds);
  if (!Number.isFinite(expirySeconds) || expirySeconds <= 0) {
    expirySeconds = body.expiry === 'never' ? undefined : KEY_EXPIRY_PRESETS[body.expiry] || 7776000;
  }
  if (expirySeconds !== undefined) {
    if (expirySeconds < 3600 || expirySeconds > 7776000) throw new ApiError(400, '有效期需在 1 小时到 90 天之间');
    expirySeconds = Math.round(expirySeconds / 3600) * 3600;
  }
  const create = {
    reusable: !!body.reusable,
    ephemeral: !!body.ephemeral,
    preauthorized: !!body.preauthorized,
  };
  const tags = normalizeTags(body.tags);
  if (config.authMode === 'oauth' && !tags.length) { const options = await getEnrollmentOptions(); if (options.defaultTag) tags.push(options.defaultTag); else throw new ApiError(400, options.scopeError || 'OAuth 创建设备密钥需要标签。请使用「添加设备」，选择已有标签或确认首次标签初始化。'); } // 为原创建入口补齐唯一可确定的标签，无法确定时给出操作入口。
  if (tags.length) create.tags = tags;

  const payload = { description, capabilities: { devices: { create } } }; // 将用途描述一起提交，避免创建后丢失。
  if (expirySeconds !== undefined) payload.expirySeconds = expirySeconds;

  const created = await tsApi(`/tailnet/${tailnetPath()}/keys`, { method: 'POST', body: payload });
  if (typeof created?.key !== 'string' || !created.key.startsWith('tskey-auth-')) throw new ApiError(502, '上游未返回设备注册密钥，请核对密钥列表后重试'); // 不把返回对象误当成明文。
  sendJson(res, 200, { ok: true, secret: created.key, key: normalizeKey({ ...created, description: created.description || description }) }); // 仅创建响应包含一次性明文，列表始终不含明文。
}

async function apiKeysRevoke(res, id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ApiError(400, '密钥 ID 格式不正确'); // 保留准确的接口错误说明。
  const listed = await tsApi(`/tailnet/${tailnetPath()}/keys?all=true`), target = (listed.keys || []).find((key) => key.id === id); if (!target) throw new ApiError(404, '设备注册密钥不存在或已被吊销'); if (!isDeviceRegistrationKey(target)) throw new ApiError(400, '此入口只能吊销设备注册密钥，不能吊销 OAuth 客户端或 API 管理令牌'); // 在后端阻止误吊销当前后台的管理身份。
  await tsApi(`/tailnet/${tailnetPath()}/keys/${id}`, { method: 'DELETE' });
  sendJson(res, 200, { ok: true });
}

async function apiUsers(res) {
  const data = await tsApi(`/tailnet/${tailnetPath()}/users`);
  sendJson(res, 200, { ok: true, users: (data.users || []).map(normalizeUser) });
}


/* v1.4：用户角色 / Webhook / ACL 预览 ─────────────────────── */

async function apiUserRole(req, res) {
  const body = await readBody(req);
  const id = String((body && body.id) || '').trim();
  const role = String((body && body.role) || '').trim();
  if (!id) throw new ApiError(400, '缺少用户 ID');
  if (!['owner', 'admin', 'member'].includes(role)) throw new ApiError(400, '角色只能是 owner / admin / member');
  if (MOCK) {
    const u = mockDb.users.find((x) => x.id === id);
    if (!u) throw new ApiError(404, 'Mock: 用户不存在');
    u.role = role;
    return sendJson(res, 200, { ok: true, user: normalizeUser(u) });
  }
  const data = await tsApi(`/users/${encodeURIComponent(id)}/role`, { method: 'POST', body: { role } });
  sendJson(res, 200, { ok: true, user: data });
}

async function apiUserDelete(res, id) {
  if (MOCK) {
    mockDb.users = mockDb.users.filter((u) => u.id !== id);
    return sendJson(res, 200, { ok: true });
  }
  await tsApi(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
  sendJson(res, 200, { ok: true });
}

async function apiWebhooks(res) {
  if (MOCK) return sendJson(res, 200, { ok: true, webhooks: [] });
  const data = await tsApi(`/tailnet/${tailnetPath()}/webhooks`);
  sendJson(res, 200, { ok: true, webhooks: data.webhooks || [] });
}

async function apiWebhookCreate(req, res) {
  const body = await readBody(req);
  const endpointUrl = String((body && body.endpointUrl) || '').trim();
  const providerType = String((body && body.providerType) || 'generic').trim();
  const subscriptions = Array.isArray(body && body.subscriptions) ? body.subscriptions : ['nodeCreated', 'nodeDeleted'];
  if (!/^https?:\/\//i.test(endpointUrl)) throw new ApiError(400, '回调地址需以 http(s):// 开头');
  if (MOCK) return sendJson(res, 200, { ok: true, webhook: { id: 'mockhook', endpointUrl, providerType, subscriptions } });
  const data = await tsApi(`/tailnet/${tailnetPath()}/webhooks`, { method: 'POST', body: { endpointUrl, providerType, subscriptions } });
  sendJson(res, 200, { ok: true, webhook: data });
}

async function apiWebhookDelete(res, id) {
  if (MOCK) return sendJson(res, 200, { ok: true });
  try {
    await tsApi(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    await tsApi(`/tailnet/${tailnetPath()}/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  sendJson(res, 200, { ok: true });
}

async function apiAclPreview(req, res) {
  const body = await readBody(req);
  const type = String((body && body.type) || 'user').trim();
  const previewFor = String((body && body.previewFor) || '').trim();
  const acl = String((body && body.acl) || '');
  if (!['user', 'ipport'].includes(type)) throw new ApiError(400, 'type 只能是 user 或 ipport');
  if (!previewFor) throw new ApiError(400, '缺少预览对象（邮箱或 IP:端口）');
  if (!acl.trim()) throw new ApiError(400, 'ACL 内容不能为空');
  if (MOCK) return sendJson(res, 200, { ok: true, matches: [{ users: ['*'], ports: ['*:*'], lineNumber: 1 }] });
  const data = await tsApi(
    `/tailnet/${tailnetPath()}/acl/preview?type=${encodeURIComponent(type)}&previewFor=${encodeURIComponent(previewFor)}`,
    { method: 'POST', rawBody: acl }
  );
  sendJson(res, 200, { ok: true, matches: Array.isArray(data) ? data : data.matches || [] });
}

const credentials = createCredentialManager({ current: () => config, mock: MOCK, persist: persistConfiguration, verify: async (candidate) => { // 候选验证直接调用官方只读设备接口。
  const token = candidate.authMode === 'oauth' ? await oauthTokens.get(candidate) : candidate.token; // 独立验证候选 OAuth 客户端，不提前切换当前配置。
  const data = await tsApi('/tailnet/' + encodeURIComponent(candidate.tailnet || '-') + '/devices?limit=1', { token, timeout: 15000 }); // 请求期间保持当前全局凭证不变。
  return { ok: true, message: MOCK ? '演示模式验证通过' : '管理 API 连接验证通过', deviceSample: (data?.devices || []).length }; // 返回验证结论而非敏感响应。
} }); // 创建单个串行提交管理器。
async function credentialRequest(req, res, save) { // 统一处理候选验证与验证后替换。
  const body = await readBody(req); // 请求体不写入审计日志。
  try { const result = await (save ? credentials.save(body) : credentials.test(body)); sendJson(res, 200, { ...result, oauth: config.authMode === 'oauth' ? oauthTokens.info(config) : null }); } catch (error) { throw new ApiError(error.status || 500, error.status ? error.message : '配置提交失败，旧凭证已保留'); } // 仅返回当前已提交配置的脱敏续期状态。
} // 结束凭证请求处理。
async function apiSettingsGet(res) { // 兼容原有设置页并只返回凭证元信息。
  const settings = await safe(() => tsApi('/tailnet/' + tailnetPath() + '/settings')); // 策略权限失败不影响本地配置入口。
  sendJson(res, 200, { ...credentials.info(), settings: settings || null, exitAutoFallback: config.exitAutoFallback !== false, exitWatchRunning: Boolean(exitWatchTimer) }); // 同时返回监测实际是否运行，避免将部署禁用的任务显示为已开启。
} // 结束设置读取。
async function apiSettingsPost(req, res) { return credentialRequest(req, res, true); } // 旧设置保存入口同样遵循先验证后替换。

/* ------------------------------------------------------------------ */
/* v1.2：DNS / ACL ──────────────────────────────────────────── */
/* ------------------------------------------------------------------ */

const mockDns = { nameservers: ['1.1.1.1', '8.8.8.8'], magicDNS: true, searchPaths: ['corp.internal'] };
let mockAcl = JSON.stringify(
  {
    groups: { 'group:admin': ['wws@example.com'] },
    acls: [{ action: 'accept', src: ['*'], dst: ['*:*'] }],
  },
  null,
  2
);

async function apiDeviceKeySet(req, res) {
  const body = await readBody(req);
  const id = String(body.id || '').trim();
  if (!id) throw new ApiError(400, '缺少密钥 id');
  const disabled = !!body.keyExpiryDisabled;
  const data = await tsApi(`/device/${encodeURIComponent(id)}/key`, { method: 'POST', body: { keyExpiryDisabled: disabled } });
  sendJson(res, 200, { ok: true, keyExpiryDisabled: !!(data && data.keyExpiryDisabled) });
}

async function apiDns(res) {
  if (MOCK) {
    return sendJson(res, 200, {
      ok: true,
      mock: true,
      nameservers: mockDns.nameservers,
      magicDNS: mockDns.magicDNS,
      searchPaths: mockDns.searchPaths,
      tailnet: config.tailnet,
    });
  }
  const t = tailnetPath();
  const [ns, pref, sp] = await Promise.all([
    tsApi(`/tailnet/${t}/dns/nameservers`),
    tsApi(`/tailnet/${t}/dns/preferences`),
    tsApi(`/tailnet/${t}/dns/searchpaths`),
  ]);
  sendJson(res, 200, {
    ok: true,
    nameservers: (ns && ns.dns) || [],
    magicDNS: !!(pref && pref.magicDNS),
    searchPaths: (sp && sp.searchPaths) || [],
    tailnet: config.tailnet,
  });
}

function normalizeStringList(value, what) {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  const list = arr.map((s) => String(s || '').trim()).filter(Boolean);
  for (const item of list) {
    if (item.length > 255 || /[\s\u3000]/.test(item)) throw new ApiError(400, `${what}不能包含空格且长度不能超过 255：${item}`);
  }
  return list;
}

async function apiDnsNameserversSet(req, res) {
  const body = await readBody(req);
  const list = normalizeStringList(body.nameservers !== undefined ? body.nameservers : body.dns, 'DNS 服务器');
  if (MOCK) {
    mockDns.nameservers = list;
    return sendJson(res, 200, { ok: true, mock: true, nameservers: list, magicDNS: mockDns.magicDNS });
  }
  const data = await tsApi(`/tailnet/${tailnetPath()}/dns/nameservers`, { method: 'POST', body: { dns: list } });
  sendJson(res, 200, { ok: true, nameservers: (data && data.dns) || list, magicDNS: !!(data && data.magicDNS) });
}

async function apiDnsPreferencesSet(req, res) {
  const body = await readBody(req);
  if (typeof body.magicDNS !== 'boolean') throw new ApiError(400, 'magicDNS 必须是 true 或 false');
  if (MOCK) {
    mockDns.magicDNS = body.magicDNS;
    return sendJson(res, 200, { ok: true, mock: true, magicDNS: body.magicDNS });
  }
  const data = await tsApi(`/tailnet/${tailnetPath()}/dns/preferences`, { method: 'POST', body: { magicDNS: body.magicDNS } });
  sendJson(res, 200, { ok: true, magicDNS: !!(data && data.magicDNS) });
}

async function apiDnsSearchpathsSet(req, res) {
  const body = await readBody(req);
  const list = normalizeStringList(body.searchPaths, '搜索域');
  if (MOCK) {
    mockDns.searchPaths = list;
    return sendJson(res, 200, { ok: true, mock: true, searchPaths: list });
  }
  const data = await tsApi(`/tailnet/${tailnetPath()}/dns/searchpaths`, { method: 'POST', body: { searchPaths: list } });
  sendJson(res, 200, { ok: true, searchPaths: (data && data.searchPaths) || list });
}

function parseHuJson(text) {
  return parsePolicy(text); // 使用识别字符串边界的 HuJSON 解析，避免损坏网址或字符串中的逗号。
}

async function apiAclGet(res) {
  if (MOCK) return sendJson(res, 200, { ok: true, mock: true, acl: mockAcl, etag: '"mock-etag"' });
  const { data, etag } = await tsApi(`/tailnet/${tailnetPath()}/acl`, { headers: { Accept: 'application/json' }, withMeta: true });
  const acl = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  sendJson(res, 200, { ok: true, acl, etag: etag || '' });
}

async function apiAclSave(req, res) {
  const body = await readBody(req);
  const text = String(body.acl || '').trim();
  if (!text) throw new ApiError(400, 'ACL 内容不能为空');
  let parsed;
  try {
    parsed = parseHuJson(text);
  } catch (e) {
    throw new ApiError(400, `ACL 不是合法的 JSON：${e.message}`);
  }
  const pretty = JSON.stringify(parsed, null, 2);
  if (MOCK) {
    mockAcl = pretty;
    return sendJson(res, 200, { ok: true, mock: true, acl: pretty, etag: '"mock-etag"' });
  }
  let etag = String(body.etag || '');
  if (!etag) {
    const cur = await tsApi(`/tailnet/${tailnetPath()}/acl`, { headers: { Accept: 'application/json' }, withMeta: true });
    etag = cur.etag || '';
  }
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (etag) headers['If-Match'] = etag;
  let result;
  try {
    result = await tsApi(`/tailnet/${tailnetPath()}/acl`, {
      method: 'POST',
      rawBody: pretty,
      headers,
      withMeta: true,
    });
  } catch (e) {
    if (e && e.status === 412) {
      throw new ApiError(409, 'ACL 已被其他人修改（etag 过期）：请先点「重新拉取」，合并后再保存');
    }
    throw e;
  }
  const { data, etag: next } = result;
  const acl = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  sendJson(res, 200, { ok: true, acl, etag: next || etag });
}

async function apiAclValidate(req, res) {
  const body = await readBody(req);
  const text = String(body.acl || '').trim();
  if (!text) throw new ApiError(400, 'ACL 内容不能为空');
  let parsed;
  try {
    parsed = parseHuJson(text);
  } catch (e) {
    throw new ApiError(400, `ACL 不是合法的 JSON：${e.message}`);
  }
  if (MOCK) return sendJson(res, 200, { ok: true, mock: true, message: '演示模式：ACL 语法校验通过' });
  const data = await tsApi(`/tailnet/${tailnetPath()}/acl/validate`, { method: 'POST', body: parsed });
  if (data && data.message) return sendJson(res, 400, { ok: false, error: String(data.message), data });
  sendJson(res, 200, { ok: true, message: 'ACL 语法校验通过' });
}

/* ------------------------------------------------------------------ */
/* 请求体 / HTTP 工具 ──────────────────────────────────────── */
/* ------------------------------------------------------------------ */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, '请求体格式错误，需要合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: '仅支持 GET/HEAD' });
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { ok: false, error: '请求路径不合法' });
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { ok: false, error: '来源不被允许（跨站请求已拦截）' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 未找到');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* 出口节点 ────────────────────────────────────────────────── */
/* ------------------------------------------------------------------ */

function checkSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host;
  } catch {
    return false;
  }
}

/* ── 测速 / 网络诊断 ──────────────────────────────────────── */

const TS_BIN =
  process.env.TAILSCALE_BIN ||
  (process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale');
const SPEED_DEFAULT_URL =
  'https://mirrors.aliyun.com/ubuntu/ls-lR.gz';
const readNodeStatus = createNodeStatusReader(TS_BIN); // 复用配置的客户端路径并合并并发采集。
const readRelays = createRelayReader(TS_BIN, async () => { if (!credentials.info().hasToken) throw new ApiError(400, '核对网络策略需要配置管理凭证'); const { data } = await tsApi(`/tailnet/${tailnetPath()}/acl`, { headers: { Accept: 'application/json' }, withMeta: true }); const policy = typeof data === 'string' ? parseHuJson(data) : data; return policy?.derpMap || { Regions: {} }; }); // 用户主动核对时只读获取策略，不保存或修改中继配置。

function execFileP(file, args, timeout = 9000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(err.message || err) : null });
    });
  });
}

function parsePingSample(line) {
  const m = /in ([\d.]+)\s*ms(?:\s+via\s+DERP\(([^)]+)\))?/i.exec(line);
  if (!m) return null;
  return { ms: Number(m[1]), relay: m[2] || null };
}

function firstIPv4(ips) {
  for (const raw of ips || []) {
    const ip = String(raw).split('/')[0];
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  }
  return null;
}

async function tailscalePing(ip) {
  const r = await execFileP(TS_BIN, ['ping', '-c', '3', '--timeout', '2s', ip], 10000);
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter(Boolean);
  const samples = lines.map(parsePingSample).filter(Boolean);
  if (!samples.length) {
    return { ip, ok: false, error: '没有收到 pong（设备离线或 ACL 禁止访问）' };
  }
  const avg = Math.round((samples.reduce((s, x) => s + x.ms, 0) / samples.length) * 10) / 10;
  const relay = samples.find((x) => x.relay);
  return { ip, ok: true, ms: avg, relay: relay ? relay.relay : null, samples: samples.length };
}

const TAILNET_SETTING_FIELDS = ['devicesApprovalOn', 'devicesAutoUpdatesOn', 'usersApprovalOn', 'networkFlowLoggingOn'];

async function apiTailnetSettingsPatch(req, res) {
  const body = await readBody(req).catch(() => ({}));
  const patch = {};
  for (const f of TAILNET_SETTING_FIELDS) if (typeof body[f] === 'boolean') patch[f] = body[f];
  if (!Object.keys(patch).length) throw new ApiError(400, '没有可修改的设置字段（只支持审批/自动更新/流量日志开关）');
  const data = await tsApi(`/tailnet/${tailnetPath()}/settings`, { method: 'PATCH', body: patch });
  return sendJson(res, 200, { ok: true, applied: patch, settings: data });
}

async function apiServeStatus(res) {
  let raw = {};
  let error = null;
  try {
    const r = await execFileP(TS_BIN, ['serve', 'status', '--json'], 8000);
    if (r.ok && r.stdout.trim()) raw = JSON.parse(r.stdout);
    else if (!r.ok) error = r.error || r.stderr.trim() || 'tailscale serve status 执行失败';
  } catch (e) {
    error = e.message;
  }
  const handlers = [];
  for (const [addr, val] of Object.entries(raw.Web || {})) {
    handlers.push({ address: addr, paths: Object.keys((val && val.Handlers) || {}) });
  }
  return sendJson(res, 200, { ok: true, configured: handlers.length > 0, funnel: !!(raw.AllowFunnel), handlers, error });
}

async function apiServeSet(req, res) {
  const body = await readBody(req).catch(() => ({}));
  const action = String(body.action || '').toLowerCase();
  if (action === 'off' || action === 'reset') {
    const r = await execFileP(TS_BIN, ['serve', 'reset'], 15000);
    if (!r.ok) throw new ApiError(500, r.error || r.stderr.trim() || 'tailscale serve reset 失败');
    return sendJson(res, 200, { ok: true, action: 'off' });
  }
  if (action !== 'on') throw new ApiError(400, 'action 只能是 on 或 off');
  const target = String(body.target || '').trim();
  if (!target || !/^(https?:\/\/)?[A-Za-z0-9_.:\-\[\]\/]+$/.test(target)) throw new ApiError(400, 'target 格式不对，例如 http://127.0.0.1:8000');
  const r = await execFileP(TS_BIN, ['serve', '--bg', target], 20000);
  if (!r.ok) throw new ApiError(500, r.error || r.stderr.trim() || 'tailscale serve 启动失败（可能需要在官方后台开启 HTTPS）');
  return sendJson(res, 200, { ok: true, action: 'on', target, output: String(r.stdout || '').trim().slice(-400) });
}

async function apiNetcheck(res) {
  const started = Date.now();
  let text = '';
  try {
    const out = await execFileP(TS_BIN, ['netcheck'], 60000);
    text = String(out.stdout || '');
  } catch (e) {
    text = String((e && e.stdout) || '');
  }
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  const derp = [...text.matchAll(/-[ \t]+(\w+):\s*([\d.]+)ms\s*\(([^)]+)\)/g)].map((m) => ({ code: m[1], ms: Number(m[2]), name: m[3] }));
  derp.sort((a, b) => a.ms - b.ms);
  const report = {
    time: pick(/\* Time:\s*(.+)/),
    udp: pick(/\* UDP:\s*(\w+)/) === 'true',
    ipv4: pick(/\* IPv4:\s*(.+)/),
    ipv6: pick(/\* IPv6:\s*(.+)/),
    mappingVariesByDestIP: pick(/\* MappingVariesByDestIP:\s*(.+)/),
    portMapping: pick(/\* PortMapping:[ \t]*(.*)/),
    captivePortal: pick(/\* CaptivePortal:\s*(\w+)/) === 'true',
    nearestDERP: pick(/\* Nearest DERP:\s*(.+)/),
    derp,
    elapsedMs: Date.now() - started,
  };
  sendJson(res, 200, { ok: true, report });
}

async function apiNodes(res, url) { // 根据页面操作返回快速映射或完整延迟检测。
  const result = MOCK ? mockRelays() : await readRelays({ probe: url.searchParams.get('probe') === '1', policy: url.searchParams.get('policy') === '1' }); // 演示与真实采集严格分开。
  sendJson(res, 200, result); // 始终明确返回来源、采集时间与警告。
} // 结束中继只读接口。

async function apiSpeedPeers(res) {
  const local = await localTailscale().catch(() => null);
  const peers = (local && local.peerInfo) || [];
  const targets = peers.filter((p) => p.online).map((p) => ({
    hostname: p.hostname || p.dnsName || '',
    ip: firstIPv4(p.ips) || firstIPv4(p.ips2) || null,
    ipv6: (p.ips || []).find((x) => String(x).includes(':')) || null,
  })).filter((p) => p.ip);
  if (!targets.length) {
    return sendJson(res, 200, {
      ok: true,
      polls: [],
      note: '手动开启出口节点（经面板）',
      mock: false,
    });
  }
  const results = [];
  for (const t of targets) {
    const r = await tailscalePing(t.ip);
    results.push({ hostname: t.hostname, ip: t.ip, ...r });
  }
  results.sort((a, b) => (a.ok ? a.ms : 1e9) - (b.ok ? b.ms : 1e9));
  sendJson(res, 200, { ok: true, polls: results, mock: false });
}

async function exitNodeLabel() {
  try {
    const j = (await execJson('tailscale', ['status', '--json'])) || (await execJson('tailscale.exe', ['status', '--json']));
    if (!j || !j.ExitNodeStatus) return null;
    const ip = firstIPv4(j.ExitNodeStatus.TailscaleIPs);
    if (!ip) return '尚未启用出口';
    const peers = j.Peer ? Object.values(j.Peer) : [];
    for (const p of peers) {
      const ips = [p.TailscaleIPs && p.TailscaleIPs[0], p.TailscaleIPs && p.TailscaleIPs[1]];
      if (ips.some((x) => x && String(x).startsWith(ip))) return p.HostName || '出口节点';
    }
    return '出口节点';
  } catch {
    return null;
  }
}

async function apiSpeedDownload(res, rawUrl) {
  if (MOCK) {
    return sendJson(res, 200, {
      ok: true,
      url: SPEED_DEFAULT_URL,
      bytes: 8 * 1024 * 1024,
      seconds: 1.36,
      mbps: 49.4,
      mock: true,
      note: '自动关闭出口节点（回退保护）',
    });
  }
  const url = String(rawUrl || '').trim() || SPEED_DEFAULT_URL;
  if (!/^https?:\/\//i.test(url)) {
    return sendJson(res, 400, { ok: false, error: '需要 http(s) 形式的测速地址', status: 400 });
  }
  const limit = 2 * 1024 * 1024;
  const started = Date.now();
  let bytes = 0;
  let timedOut = false;
  const ac = new AbortController();
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, 35000);
  try {
    const tmpFile = path.join(os.tmpdir(), `ts-speed-${Date.now()}.bin`);
    const r = await execFileP('curl.exe', [
      '-sS', '-L', '-4', '--max-time', '35',
      '-r', `0-${limit - 1}`,
      '-o', tmpFile,
      '-w', '%{http_code} %{size_download} %{time_total}',
      url,
    ], 40000);
    if (!r.ok) throw new Error((r.stderr || r.error || 'curl 执行失败').trim().slice(0, 160));
    const parts = r.stdout.trim().split(/\s+/);
    const code = Number(parts[0]);
    if (code !== 200 && code !== 206) throw new Error(`HTTP ${code || '-'}`);
    bytes = Number(parts[1]) || 0;
    if (fs.existsSync(tmpFile)) {
      const st = fs.statSync(tmpFile);
      bytes = st.size || bytes;
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    if (!bytes) throw new Error('下载数据为空');
    const seconds = Math.max(0.05, (Date.now() - started) / 1000);
    const mbps = Math.round(((bytes * 8) / 1e6 / seconds) * 10) / 10;
    sendJson(res, 200, {
      ok: true,
      url,
      bytes,
      seconds: Math.round(seconds * 100) / 100,
      mbps,
      via: (await exitNodeLabel()) || '本机直连',
      mock: false,
    });
  } catch (err) {
    sendJson(res, 502, {
      ok: false,
      error: `测速失败：${err.message || err}（可尝试关闭出口节点或检查 DNS 解析）`,
      status: 502,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readExitState() {
  const r = await execFileP(TS_BIN, ['status', '--json'], 8000);
  if (!r.ok) throw new ApiError(500, '无法执行 Tailscale 命令：' + (r.stderr || r.error || '未知错误'));
  const j = JSON.parse(r.stdout);
  const candidates = [];
  for (const [id, p] of Object.entries(j.Peer || {})) {
    if (!p.ExitNodeOption) continue;
    candidates.push({
      id,
      hostname: p.HostName || '',
      ip: firstIPv4(p.TailscaleIPs),
      online: !!p.Online,
      rxMB: Math.round((p.RxBytes || 0) / 1048576),
      txMB: Math.round((p.TxBytes || 0) / 1048576),
    });
  }
  return {
    active: j.ExitNodeStatus
      ? {
          ip: firstIPv4(j.ExitNodeStatus.TailscaleIPs),
          online: !!j.ExitNodeStatus.Online,
          id: j.ExitNodeStatus.ID || '',
        }
      : null,
    candidates,
    self: {
      hostname: (j.Self && j.Self.HostName) || '',
      online: !!(j.Self && j.Self.Online),
      acceptRoutes: j.Self ? undefined : undefined,
    },
  };
}

async function exitNodeName() {
  const st = await readExitState().catch(() => null);
  if (!st || !st.active) return null;
  const hit = st.candidates.find((c) => c.ip === st.active.ip);
  return hit ? hit.hostname : st.active.ip;
}


/* ------------------------------------------------------------------ */
/* v1.5：操作审计 + 出口自动回落 ──────────────────────────── */
/* ------------------------------------------------------------------ */

const AUDIT_FILE = path.join(DATA_DIR, 'audit.log');
let auditQueue = Promise.resolve();

function appendAudit(entry) {
  auditQueue = auditQueue.then(async () => {
    try {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      await fs.promises.appendFile(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
  });
  return auditQueue;
}

async function readAudit(limit = 200) {
  try {
    const txt = await fs.promises.readFile(AUDIT_FILE, 'utf8');
    const lines = txt.split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

let exitWatch = { intervalMs: 25000, failStreak: 0, autoDisabled: null, lastCheckAt: null, lastError: null };
let exitWatchTimer = null;

async function tailscaleSetExit(ip) {
  const args = ['set', '--exit-node=' + (ip || '')];
  const bin = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  let r = await execFileP(bin, args, 15000);
  if (!r.ok && /ENOENT/i.test(r.error || '')) r = await execFileP('tailscale', args, 15000);
  return r;
}

async function apiExitSet(req, res) {
  const body = await readBody(req);
  if (MOCK) return sendJson(res, 200, { ok: true, mock: true });
  const wantOn = !!(body && body.enabled);
  let ip = body && body.ip != null ? String(body.ip).trim() : '';
  if (!ip && wantOn) {
    const j = (await execJson('tailscale', ['status', '--json'], 6000)) || (await execJson('tailscale.exe', ['status', '--json'], 6000));
    const cands = Object.values((j && j.Peer) || {}).filter((p) => p && p.ExitNodeOption && p.Online);
    const c = cands[0];
    ip = c ? firstIPv4(c.TailscaleIPs || []) : '';
    if (!ip) throw new ApiError(400, '没有可用的出口节点候选（需其他设备开启 exit node 并批准路由）');
  }
  const r = await tailscaleSetExit(ip);
  if (!r.ok) {
    throw new ApiError(500, '开启出口节点失败：' + String(r.stderr || r.error || '未知错误').slice(0, 300));
  }
  if (!ip) exitWatch.autoDisabled = null;
  sendJson(res, 200, { ok: true, exitNode: ip || null });
}

async function exitWatchTick() {
  exitWatch.lastCheckAt = Date.now();
  try {
    const j = (await execJson('tailscale', ['status', '--json'], 5000)) || (await execJson('tailscale.exe', ['status', '--json'], 5000));
    if (!j || !j.ExitNodeStatus) {
      exitWatch.failStreak = 0;
      return;
    }
    const ip = firstIPv4(j.ExitNodeStatus.TailscaleIPs || []);
    let ok = !!j.ExitNodeStatus.Online && !!ip;
    if (ok) {
      const ping = await tailscalePing(ip);
      ok = !!ping.ok;
      exitWatch.lastError = ping.ok ? null : ping.error || '出口节点不可达';
    } else {
      exitWatch.lastError = '出口节点检测异常';
    }
    if (!ok) {
      exitWatch.failStreak += 1;
      if (exitWatch.failStreak >= 2 && config.exitAutoFallback !== false) {
        exitWatch.failStreak = 0;
        await tailscaleSetExit('');
        exitWatch.autoDisabled = { at: new Date().toISOString(), ip: ip || '', error: exitWatch.lastError || '' };
        appendAudit({ t: exitWatch.autoDisabled.at, m: 'AUTO', p: '/exit-fallback', s: 200, note: '出口节点连续不可达，已自动关闭出口：' + (ip || '') + '，恢复本机网络' });
      }
    } else {
      exitWatch.failStreak = 0;
    }
  } catch (err) {
    exitWatch.lastError = String(err.message || err);
  }
}

function startExitWatch() {
  if (exitWatchTimer) clearInterval(exitWatchTimer);
  exitWatchTimer = setInterval(() => { exitWatchTick().catch(() => {}); }, exitWatch.intervalMs);
  if (exitWatchTimer.unref) exitWatchTimer.unref();
}

async function apiAuditList(res, url) {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));
  sendJson(res, 200, { ok: true, entries: await readAudit(limit) });
}

async function apiExitStatus(res) {
  if (MOCK) {
    return sendJson(res, 200, { ok: true, mock: true, active: null, candidates: [] });
  }
  try {
    sendJson(res, 200, {
      ok: true,
      mock: false,
      ...(await readExitState()),
      watch: {
        autoFallback: config.exitAutoFallback !== false,
        lastCheckAt: exitWatch.lastCheckAt,
        lastError: exitWatch.lastError,
        autoDisabled: exitWatch.autoDisabled,
      },
    });
  } catch (err) {
    sendJson(res, err.status || 500, { ok: false, error: err.message, status: err.status || 500 });
  }
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.on('finish', () => appendAudit({ t: new Date().toISOString(), m: method, p, s: res.statusCode || 0 }));
  }

  if (!checkSameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: '来源不被允许（跨站请求已拦截）' });
  }
  if (method !== 'GET' && method !== 'HEAD' && req.headers['x-requested-with'] !== 'TailscaleAdminCN') {
    return sendJson(res, 403, { ok: false, error: '缺少 X-Requested-With 头（跨站请求已拦截）' });
  }

  try {
    if (method === 'GET' && p === '/api/status') return await apiStatus(res);
    if (method === 'GET' && p === '/api/node-status') return sendJson(res, 200, MOCK ? mockStatus() : await readNodeStatus()); // 无需管理密钥即可只读查看本机可见节点。
    if (method === 'GET' && p === '/api/overview') return await apiOverview(res);
    if (method === 'GET' && p === '/api/devices') return await apiDevices(res);
    if (method === 'GET' && p === '/api/device') return await apiDevice(res, url);
    if ((method==='GET'&&['/api/fleet','/api/fleet/batch'].includes(p))||(method==='POST'&&['/api/fleet/initialize','/api/fleet/setup','/api/fleet/preview','/api/fleet/import','/api/fleet/batch','/api/fleet/cancel'].includes(p))) return await apiFleet(req,res,url); // 路由仅开放明确定义的终端动作。
    if (method === 'GET' && ['/api/remote', '/api/remote/job'].includes(p)) return await apiRemote(req, res, url); // 只读获取 SSH 配置与远程任务状态。
    if (method === 'POST' && ['/api/remote/profile', '/api/remote/action'].includes(p)) return await apiRemote(req, res, url); // 同源检查通过后才允许保存配置或执行固定动作。
    if (method === 'GET' && p === '/api/device/routes') return await apiDeviceRoutes(res, url);
    if (method === 'POST' && p === '/api/device/routes') return await apiDeviceRoutesSet(req, res);
    if (method === 'POST' && p === '/api/device/action') return await apiDeviceAction(req, res);
    if (method === 'GET' && p === '/api/keys') return await apiKeys(res);
    if (method === 'GET' && p === '/api/enrollment/options') return sendJson(res, 200, await getEnrollmentOptions()); // 为新设备向导和传统密钥表单提供实际创建条件。
    if (method === 'POST' && p === '/api/enrollment/prepare') return await apiEnrollmentPrepare(req, res); // 首次标签初始化必须经过同源、写入头和显式确认。
    if (method === 'POST' && p === '/api/keys') return await apiKeysCreate(req, res);
    const keyRevoke = p.match(/^\/api\/keys\/([^/]+)$/);
    if (method === 'DELETE' && keyRevoke) return await apiKeysRevoke(res, decodeURIComponent(keyRevoke[1]));
    if (method === 'GET' && p === '/api/users') return await apiUsers(res);
    if (method === 'POST' && p === '/api/users/role') return await apiUserRole(req, res);
    const userDel = p.match(/^\/api\/users\/([^/]+)$/);
    if (method === 'DELETE' && userDel) return await apiUserDelete(res, decodeURIComponent(userDel[1]));
    if (method === 'GET' && p === '/api/webhooks') return await apiWebhooks(res);
    if (method === 'POST' && p === '/api/webhooks') return await apiWebhookCreate(req, res);
    const hookDel = p.match(/^\/api\/webhooks\/([^/]+)$/);
    if (method === 'DELETE' && hookDel) return await apiWebhookDelete(res, decodeURIComponent(hookDel[1]));
    if (method === 'POST' && p === '/api/acl/preview') return await apiAclPreview(req, res);
    if (method === 'GET' && p === '/api/credentials') return sendJson(res, 200, { ...credentials.info(), oauth: config.authMode === 'oauth' ? oauthTokens.info(config) : null }); // 独立读取管理凭证指纹和 OAuth 续期状态。
    if (method === 'POST' && p === '/api/credentials/test') return await credentialRequest(req, res, false); // 只验证候选，不写配置。
    if (method === 'POST' && p === '/api/credentials') return await credentialRequest(req, res, true); // 验证成功后提交替换。
    if (method === 'GET' && p === '/api/settings') return await apiSettingsGet(res);
    if (method === 'POST' && p === '/api/tailnet-settings') return await apiTailnetSettingsPatch(req, res);
    if (method === 'POST' && p === '/api/settings') return await apiSettingsPost(req, res);
    if (method === 'POST' && p === '/api/device/key') return await apiDeviceKeySet(req, res);
    if (method === 'GET' && p === '/api/dns') return await apiDns(res);
    if (method === 'POST' && p === '/api/dns/nameservers') return await apiDnsNameserversSet(req, res);
    if (method === 'POST' && p === '/api/dns/preferences') return await apiDnsPreferencesSet(req, res);
    if (method === 'POST' && p === '/api/dns/searchpaths') return await apiDnsSearchpathsSet(req, res);
    if (method === 'GET' && p === '/api/acl') return await apiAclGet(res);
    if (method === 'POST' && p === '/api/acl') return await apiAclSave(req, res);
    if (method === 'POST' && p === '/api/acl/validate') return await apiAclValidate(req, res);
    if (method === 'GET' && p === '/api/speed/peers') return await apiSpeedPeers(res);
  if (method === 'GET' && p === '/api/speed/download') return await apiSpeedDownload(res, url.searchParams.get('url'));
  if (method === 'GET' && p === '/api/exit') return await apiExitStatus(res);
  if (method === 'POST' && p === '/api/exit') return await apiExitSet(req, res);
  if (method === 'GET' && p === '/api/netcheck') return await apiNetcheck(res);
  if (method === 'GET' && p === '/api/nodes') return await apiNodes(res, url);
  if (method === 'GET' && p === '/api/serve') return await apiServeStatus(res);
  if (method === 'POST' && p === '/api/serve') return await apiServeSet(req, res);
  if (method === 'GET' && p === '/api/audit') return await apiAuditList(res, url);
  if (p === '/api/health') return sendJson(res, 200, { ok: true, version: VERSION, mock: MOCK });
  if (method === 'GET' && p === '/api/instances') { const instances = await discoverConsoles(); return sendJson(res, 200, { ok: true, realUrl: instances.find((item) => !item.mock && item.version === VERSION)?.url || null }); } // 只返回匹配当前版本的真实管理台地址。
    throw new ApiError(404, '接口不存在');
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    if (status >= 500) console.error('[api]', method, p, '->', err && err.message);
    sendJson(res, status, {
      ok: false,
      error: (err && err.message) || '请求处理失败',
      status,
    });
  }
}

/* ------------------------------------------------------------------ */
/* 路由分发 ────────────────────────────────────────────────── */
/* ------------------------------------------------------------------ */

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('open', [url], () => {});
    } else {
      execFile('xdg-open', [url], () => {});
    }
  } catch {
    /* 请求体解析 */
  }
}

loadConfig();

const server = http.createServer(async (req, res) => { // 异步验证后台访问密码后再进入原有路由。
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
  } catch {
    return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
  }
  try { if (!await authorizeAccess(req, res, url)) return; } catch { return sendJson(res, 503, { ok: false, error: '访问验证暂不可用' }); } // 门禁异常时拒绝请求，避免绕过密码保护。
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url);
  } else {
    serveStatic(req, res, url);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[错误] 端口 ${PORT} 被占用或无法监听，请换一个端口后重试`);
    console.error(`       例如：PORT=${PORT + 1} node server.mjs\n`);
    process.exit(1);
  }
  console.error('[错误]', err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const renewOAuth = () => { if (config.authMode === 'oauth') oauthTokens.get(config).catch(() => {}); }; if (!MOCK) { renewOAuth(); setInterval(renewOAuth, 60000).unref(); } // 真实 OAuth 模式启动时获取令牌，并每分钟检查是否进入到期前五分钟续期窗口。
  if (!argv.includes('--no-exit-watch')) startExitWatch(); // 并行预览实例可复用现有服务的出口监测，避免多个进程重复自动修改出口。
  const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`;
  console.log('');
  console.log('  +----------------------------------------------------------+');
  console.log('  |  Tailscale 中文管理台 · 本地控制面板                       |');
  console.log('  +----------------------------------------------------------+');
  console.log(`  访问地址 : ${url}`);
  console.log(`  运行模式 : ${MOCK ? "演示模式（Mock 数据）" : "真实 API"}`);
  console.log(`  配置文件 : ${path.relative(process.cwd(), CONFIG_FILE) || CONFIG_FILE}`);
  if (!MOCK && !config.token) {
    console.log('');
    console.log('  首次使用：打开页面 → 设置 → 填写 API Key 即可开始');
  }
  if (MOCK) {
    console.log('');
    console.log('  提示：直接运行 `node server.mjs` 可只用演示模式（无需 Key）');
  }
  console.log('');
  if (AUTO_OPEN) setTimeout(() => openBrowser(url), 500);
});

process.on('SIGINT', () => {
  console.log('\n已停止');
  process.exit(0);
});
