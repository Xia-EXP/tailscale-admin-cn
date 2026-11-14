import { createFleetView } from './fleet-view.js'; // 集中展示多设备配对、连接、部署和管理。
/* Tailscale 中文管理台 · 前端脚本 v1.17.0：官方式设备表与实际节点信息。 */
'use strict';
import { createThemePreference } from './preferences.js'; // 接入三种明确的主题偏好。
import { openRemoteSetup } from './remote-setup.js'; // 接入无需重新注册设备的远程开启向导。
import { writeClipboard } from './clipboard.js'; // 保证局域网 HTTP 域名下仍能复制节点地址与注册命令。
import { createCredentialsView } from './credentials-view.js'; // 接入管理令牌的测试与替换入口。
import { createRemoteView } from './remote-view.js'; // 在设备详情提供 SSH 运维、升级和远程桌面入口。
import { openAuthGuide } from './auth-guide.js'; // 接入使用设备注册密钥登录 Tailscale 的中文说明。
import { createEnrollmentView } from './enrollment-view.js'; // 统一添加设备与密钥创建的完整操作流程。
import { collectNotices, buildDiagnosticReport } from './diagnostics.js'; // 接入实际状态提醒和脱敏报告导出。
import { createRelayView } from './relay-view.js'; // 接入自建 DERP 专用视图。
import { localDevices, peerForDevice, renderDeviceRows, renderConnectionSheet } from './devices-table.js'; // 接入官方式设备表与节点详情。
import { createNodeMonitor } from './node-monitor.js'; // 挂载独立的节点监控页面。

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fmtDate = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('zh-CN', { hour12: false }); };
const fmtDay = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString('zh-CN'); };
const timeAgo = (t) => {
  const ts = typeof t === 'number' ? t : Date.parse(t || '');
  if (!ts || Number.isNaN(ts)) return '—';
  const diff = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diff);
  const u = (n, w) => `${n} ${w}${diff < 0 ? '前' : '后'}`;
  if (abs < 60) return '刚刚';
  if (abs < 3600) return u(Math.round(abs / 60), '分钟');
  if (abs < 86400) return u(Math.round(abs / 3600), '小时');
  if (abs < 86400 * 30) return u(Math.round(abs / 86400), '天');
  return fmtDay(ts);
};
const fmtBytes = (n) => { const u = ['B', 'KB', 'MB', 'GB']; let v = Number(n) || 0; let i = 0; while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; } return `${v.toFixed(i ? 1 : 0)} ${u[i]}`; };
const expiryInfo = (v) => {
  if (!v) return { label: '不过期', tone: 'ok', days: null };
  const d = new Date(v); if (isNaN(d)) return { label: String(v), tone: 'ok', days: null };
  const days = Math.round((d - Date.now()) / 864e5);
  if (days < 0) return { label: `已过期 ${Math.abs(days)} 天`, tone: 'danger', days };
  if (days <= 14) return { label: `剩 ${days} 天`, tone: 'warn', days };
  return { label: `剩 ${days} 天`, tone: 'ok', days };
};
const isExpiring = (v) => { const d = new Date(v || 0); return !isNaN(d) && d - Date.now() < 7 * 864e5 && d.getTime() > 0; };
const isSoon = (v) => { const d = new Date(v || 0); return !isNaN(d) && d - Date.now() < 14 * 864e5 && d.getTime() > 0; };

const svg = (body, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  overview: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  devices: svg('<rect x="2" y="4" width="14" height="10" rx="2"/><path d="M6 18h7"/><rect x="17" y="8" width="5" height="9" rx="1.5"/>'),
  key: svg('<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2"/>'),
  users: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z"/>'),
  speed: svg('<path d="M4 17a9 9 0 1 1 16 0"/><path d="M12 14l4-4"/><circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none"/>'),
  server: svg('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  activity: svg('<path d="M3 12h4l2.8-7 4.4 14L17 12h4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1 1-1.1 1.7v.3"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/>'),
  settings: svg('<circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'),
  shield: svg('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),
  route: svg('<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8.4 16.6C12 15 12 9 15.6 7.4"/>'),
  power: svg('<path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/>'),
  trash: svg('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>', 16),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>', 16),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4 19h16"/>', 16),
  arrow: svg('<path d="M9 6l6 6-6 6"/>', 14),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 6.7"/><path d="M20 4v7h-7"/>', 16),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', 16),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".8" fill="currentColor" stroke="none"/>'),
  cloud: svg('<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.7 3.8 3.8 0 0 1 17.5 18H7z"/>', 16),
};

const state = {
  tab: 'devices', status: null, data: null, error: null, loading: true,
  query: '', filter: 'all', keyFilter: 'all', batchMode: false, selected: new Set(),
  drawer: null, speed: null, speedRunning: false, netcheck: null, netcheckRunning: false, nodes: null, nodesRunning: false,
  webhooks: null, dns: null, acl: null, aclDraft: null, audit: null, exit: null, settings: null,
  glossaryQuery: '', modalOnOk: null, theme: 'light', // 首次访问使用浅色工作台，保留用户已有主题。
};
const TABS = {
  overview: { t: '总览', s: '设备、密钥与网络状态一览' }, devices: { t: '设备', s: '全部设备、子网路由与出口节点' },
  terminals: { t: '终端管理', s: '批量 SSH、服务、部署和路由公布' }, // 新增独立多设备工作台。
  monitor: { t: '节点信息', s: '本机可见节点的状态、连接路径与累计流量' }, // 提供独立的只读节点入口。
  keys: { t: '密钥管理', s: 'API 令牌与设备注册密钥' }, users: { t: '用户', s: 'Tailnet 成员与角色' },
  dns: { t: '网络 DNS', s: 'MagicDNS、全局名称服务器与搜索域' }, acl: { t: '访问控制', s: 'tailnet 策略文件（ACL）' },
  webhooks: { t: 'Webhook', s: '设备事件推送到外部服务' }, speed: { t: '联动测速', s: '设备延迟与出口链路下载速度' },
  netcheck: { t: '网络诊断', s: 'UDP/NAT、DERP 与各区域延迟' }, nodes: { t: '中继节点', s: 'DERP 区域与自建节点' }, audit: { t: '操作记录', s: '本机审计日志' },
  help: { t: '术语说明', s: '在线状态、子网路由、出口节点、密钥到期' }, settings: { t: '设置', s: '凭证、审批与自我保护' },
};
const NAV = [
  { g: '工作台', tab: 'overview', l: '总览', i: 'overview' },
  { g: '工作台', tab: 'terminals', l: '终端管理', i: 'server' }, // 将批量终端入口放入导航。
  { g: '工作台', tab: 'monitor', l: '节点监控', i: 'activity' }, // 将日常状态查看放到显眼位置。
  { g: '工作台', tab: 'devices', l: '设备', i: 'devices', badge: 'devices' },
  { g: '工作台', tab: 'keys', l: '密钥管理', i: 'key', badge: 'keys' },
  { g: '工作台', tab: 'users', l: '用户', i: 'users' },
  { g: '网络', tab: 'dns', l: '网络 DNS', i: 'globe' },
  { g: '网络', tab: 'acl', l: '访问控制', i: 'shield' },
  { g: '网络', tab: 'webhooks', l: 'Webhook', i: 'cloud' },
  { g: '工具', tab: 'speed', l: '联动测速', i: 'speed' },
  { g: '工具', tab: 'netcheck', l: '网络诊断', i: 'activity' },
    { g: '工具', tab: 'nodes', l: '中继节点', i: 'server' },
  { g: '工具', tab: 'audit', l: '操作记录', i: 'clock' },
  { g: '帮助', tab: 'help', l: '术语说明', i: 'help' },
  { g: '帮助', tab: 'settings', l: '设置', i: 'settings' },
];

async function api(path, { method = 'GET', body, timeout = 40000 } = {}) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const headers = { 'X-Requested-With': 'TailscaleAdminCN' };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    let data = null; try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw Object.assign(new Error((data && (data.error || data.message)) || `请求失败（HTTP ${res.status}）`), { status: res.status });
    if (data && data.ok === false) throw new Error(data.error || '请求失败');
    return data;
  } finally { clearTimeout(timer); }
}

const nodeMonitor = createNodeMonitor({ api, esc, icons: ICON, fmtBytes, fmtDate, timeAgo, redraw: render, isVisible: () => ['monitor', 'devices'].includes(state.tab) }); // 复用安全转义、网络请求与主渲染能力。
const relayView = createRelayView({ api, esc, icons: ICON, fmtDate, fmtBytes, redraw: render, isVisible: () => state.tab === 'nodes' }); // 共享安全请求和主题能力。
let realConsoleUrl = null, instancesRequested = false; // 缓存本机新版真实服务入口，避免硬编码到旧端口。
async function locateRealConsole() { if (instancesRequested) return; instancesRequested = true; try { const result = await api('/api/instances', { timeout: 4000 }); realConsoleUrl = result.realUrl; } catch { realConsoleUrl = null; } if (state.status?.mock) render(); } // 演示模式只读查找同版本真实管理台。
const themePreference = createThemePreference({ icons: { light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>'), dark: svg('<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>') } }); // 初始化带文字按钮和系统跟随的主题偏好。
const credentialsView = createCredentialsView({ api, esc, redraw: () => { if (['keys', 'settings'].includes(state.tab)) render(); }, onSaved: () => { state.settings = null; state.data = null; state.error = null; refreshData(); } }); // 凭证替换成功后重新读取目标网络，避免残留旧网络数据。
const fleetView=createFleetView({api,esc,redraw:render,devices:deviceList,isVisible:()=>state.tab==='terminals',openModal,copyText,toast}); // 复用实际设备列表与统一弹窗。
const enrollmentView = createEnrollmentView({ api, esc, openModal, copyText, toast, refresh: () => { nodeMonitor.load(); refreshData(true); } }); // 新设备向导复用真实刷新与统一弹窗能力。
function applyTheme() { themePreference.apply(); } // 重绘页面时保留用户主题选择。

function toast(msg, tone = 'ok') {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = `toast toast-${tone}`; el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 2600);
  setTimeout(() => el.remove(), 3200);
}
async function copyText(t) { try { await writeClipboard(t); toast('已复制'); } catch { toast('复制失败，请手动复制', 'err'); } } // 为统一复制按钮提供 HTTP 兼容和明确失败提示。

function renderNav() { // 按官方习惯生成顶部主导航与更多工具。
  const nav = $('#nav'); if (!nav) return; // 容器不存在时安全返回。
  const moreOpen = Boolean(nav.querySelector('.nav-more')?.open); // 后台异步刷新时保留用户已经展开的更多菜单。
  const main = ['devices', 'terminals', 'users', 'acl', 'dns', 'monitor', 'nodes', 'keys', 'settings']; // 密钥管理放到直接可见的主导航。 // 将设备和两类节点放在直接入口。
  const item = (tab) => { const entry = NAV.find((it) => it.tab === tab); return `<button type="button" class="nav-item${state.tab === tab ? ' active' : ''}" data-tab="${tab}" aria-current="${state.tab === tab ? 'page' : 'false'}">${ICON[entry.i]}<span>${tab === 'monitor' ? '节点信息' : entry.l}</span></button>`; }; // 导航项明确标记当前页面。
  nav.innerHTML = main.map(item).join('') + `<details class="nav-more"${moreOpen ? ' open' : ''}><summary class="nav-item${main.includes(state.tab) ? '' : ' active'}">更多⌄</summary><div class="nav-more-list">${NAV.filter((entry) => !main.includes(entry.tab)).map((entry) => item(entry.tab)).join('')}</div></details>`; // 收纳工具并保留展开状态，避免用户点击前菜单突然收起。
} // 结束顶部导航渲染。

function renderSideLocal() {
  const box = $('#side-local'); if (!box) return;
  const snap = nodeMonitor.snapshot(); // 无管理 Key 时仍能显示本机身份。
  const l = state.data?.local || (snap?.self ? { hostname: snap.self.hostname, ip: snap.self.ips?.[0], online: snap.self.online, peers: snap.peers.length } : null); // 使用已采集的真实节点快照。
  box.innerHTML = l
    ? `<div class="local-card"><div class="local-name"><i class="pulse"></i>${esc(l.hostname || '本机')}</div><div class="local-meta mono">${esc(l.ip || '—')}</div><div class="local-meta">${l.online ? '已连接' : '未连接'}${l.peers != null ? ' · ' + l.peers + ' 个节点' : ''}</div></div>`
    : `<div class="local-card"><div class="local-name">未检测到本机客户端</div><div class="local-meta">安装并登录本机 Tailscale 后自动显示</div></div>`;
}
function renderConn() {
  const pill = $('#conn-pill'); if (!pill) return;
  pill.removeAttribute('data-tab');
  const s = state.status;
  if (!s) { pill.className = 'pill pill-muted'; pill.innerHTML = '<i class="dot"></i>连接中'; return; }
  if (s.mock) { pill.className = 'pill pill-info'; pill.innerHTML = '<i class="dot"></i>演示模式'; return; }
  if (!s.hasToken) { pill.className = 'pill pill-warn'; pill.innerHTML = '<i class="dot"></i>未配置 Key'; pill.setAttribute('data-tab', 'settings'); return; }
  pill.className = `pill ${state.error ? 'pill-warn' : 'pill-ok'}`; pill.innerHTML = `<i class="dot"></i>${state.error ? '读取失败' : '凭证已配置'}`; // 有凭证不等于已经验证上游连接。
}
function skeleton() {
  return `<div class="page-head"><div><div class="skeleton sk-title"></div><div class="skeleton sk-sub"></div></div></div>
  <div class="kpi-grid">${[0, 1, 2, 3].map(() => '<div class="kpi"><div class="skeleton sk-line"></div><div class="skeleton sk-big"></div></div>').join('')}</div>`;
}
function needKeyView() {
  return `<div class="page-head"><div><h2>还没有配置 API Key</h2><p>本工具需要一枚 Tailscale API 访问令牌。令牌只保存在本机 <code>data/config.json</code>，不会进入浏览器存储。</p></div></div>
  <div class="panel"><div class="panel-body actions"><button class="btn btn-primary" type="button" data-tab="settings">去填写 API Key</button></div></div>`;
}
function errorView() {
  const msg = state.error && (state.error.message || String(state.error)) || '未知错误';
  return `<div class="page-head"><div><h2>读取数据失败</h2><p>${esc(msg)}</p></div></div>
  <div class="callout callout-warn"><b>可以试试：</b>检查 Key 是否过期；或先关闭出口节点再试。</div>
  <div class="actions"><button class="btn btn-primary" type="button" data-act="refresh">重试</button><button class="btn" type="button" data-tab="settings">检查设置</button></div>`;
}
const kv = (k, v) => `<div class="kv"><span class="kv-k">${k}</span><span class="kv-v">${v}</span></div>`;
const tip = (lbl, text) => `<span class="tip" tabindex="0" data-tip="${esc(text)}">${esc(lbl)}</span>`;
function pageHead(title, sub, actions) {
  const s = state.data && state.data.stats;
  const foot = s ? `${s.devices} 台设备 · 在线 ${s.online}${s.unknown ? ' · 未知 ' + s.unknown : ''} · 更新于 ${timeAgo(state.data.updatedAt)}` : '';
  return `<div class="page-head"><div><h2>${esc(title)}</h2><p>${sub}</p><div class="page-foot">${foot}</div></div>${actions ? `<div class="toolbar">${actions}</div>` : ''}</div>`;
}
function statusPill(dev) { return dev.onlineKnown === null ? { l: '状态未知', c: 'pill-info' } : dev.online ? { l: '在线', c: 'pill-ok' } : { l: '离线', c: 'pill-muted' }; }
function osMeta(os) {
  const m = { windows: ['🪟', 'Windows'], macos: ['🍎', 'macOS'], linux: ['🐧', 'Linux'], android: ['🤖', 'Android'], ios: ['📱', 'iOS'] };
  const e = m[String(os || '').toLowerCase()] || ['🖥', os || '未知系统'];
  return { icon: e[0], label: e[1] };
}
function keyStatus(k) {
  if (k.revoked || k.status === 'revoked') return { l: '已吊销', c: 'pill-danger' };
  const exp = expiryInfo(k.expiresAt || k.expiry || k.expires);
  if (exp.tone === 'danger') return { l: '已过期', c: 'pill-danger' };
  if (exp.days != null && exp.days <= 7) return { l: `剩 ${exp.days} 天`, c: 'pill-warn' };
  return { l: exp.days == null ? '不过期' : `剩 ${exp.days} 天`, c: 'pill-ok' };
}
function keyCaps(k) { const c = k; // 服务端已将能力标准化到顶层字段。
 const out = []; if (c.reusable) out.push('可复用'); if (c.ephemeral) out.push('临时节点'); if (c.preauthorized) out.push('预授权'); return out; }

/* 总览 */
function renderOverview() {
  const d = state.data;
  if (!d) return state.status && !state.status.mock && !state.status.hasToken ? needKeyView() : '';
  const s = d.stats; const alerts = [];
  if (state.status && !state.status.hasToken && !state.status.mock) alerts.push({ tone: 'info', icon: '🔑', text: '还没有配置 API Key', sub: '在设置里填写后即可读取完整数据', tab: 'settings' });
  if (!d.local) alerts.push({ tone: 'info', icon: '💻', text: '未检测到本机 Tailscale 客户端', sub: '设备在线状态可能显示“未知”', tab: 'help' });
  if (s.unknown) alerts.push({ tone: 'info', icon: '❔', text: `${s.unknown} 台设备在线状态未知`, sub: '官方接口未返回 online 字段，本机也没有匹配到', tab: 'devices' });
  const expiring = (d.keys || []).filter((k) => !(k.revoked || k.status === 'revoked') && isExpiring(k.expiresAt || k.expiry || k.expires));
  if (expiring.length) alerts.push({ tone: 'warn', icon: '🔑', text: `${expiring.length} 个密钥 7 天内到期`, sub: '到期后使用该密钥的脚本会失败', tab: 'keys' });
  const expDev = (d.devices || []).filter((x) => !x.keyExpiryDisabled && isSoon(x.expires));
  if (expDev.length) alerts.push({ tone: 'warn', icon: '🗓️', text: `${expDev.length} 台设备密钥 14 天内到期`, sub: '到期后设备会被移出网络', tab: 'devices' });
  const alertHtml = alerts.length
    ? `<div class="alert-list">${alerts.map((a) => `<button type="button" class="alert alert-${a.tone}" data-tab="${a.tab}"><span class="alert-ico">${a.icon}</span><span class="alert-main"><b>${a.text}</b><span class="alert-sub">${a.sub}</span></span><span class="alert-arrow">${ICON.arrow}</span></button>`).join('')}</div>`
    : `<div class="empty"><div class="empty-ico">✅</div><strong>一切正常</strong><p>没有需要处理的告警。</p></div>`;
  const recent = (d.devices || []).slice(0, 5).map((dev) => {
    const st = statusPill(dev); const m = osMeta(dev.os);
    return `<button type="button" class="list-row" data-act="open-device" data-id="${esc(dev.id)}"><span class="list-ico">${m.icon}</span><span class="list-main"><span class="list-title">${esc(dev.hostname || '未命名设备')}</span><span class="list-sub mono">${esc(dev.ipv4 || dev.ipv6 || '—')}</span></span><span class="pill ${st.c}"><i class="dot"></i>${st.l}</span></button>`;
  }).join('') || '<div class="muted" style="padding:12px">还没有设备</div>';
  return `${pageHead('总览', '一眼看清你的私有网络：在线状态、路由、密钥与需要留意的事', `<button class="btn btn-sm" type="button" data-act="refresh">${ICON.refresh} 刷新</button>`)}
  <section class="hero"><div class="hero-orb o1"></div><div class="hero-orb o2"></div><div class="hero-orb o3"></div>
    <div class="hero-body"><div class="hero-eyebrow"><i class="dot"></i> YOUR PRIVATE NETWORK</div><h1 class="hero-title">${esc((d.tailnet && (d.tailnet.name || d.tailnet.displayName)) || '我的 Tailnet')}</h1><p class="hero-description">连接你的设备，让每一次远程访问都有迹可循。</p><!-- 展示网络名称与工作台说明。 -->
      <div class="hero-meta"><span>🌐 ${s.devices} 台设备</span><span class="sep"></span><span>🟢 ${s.online} 台在线</span><span class="sep"></span><span>${d.local ? '本机 ' + esc(d.local.hostname || '') + ' 已连接' : '未检测到本机节点'}</span></div>
      <div class="hero-actions"><button class="btn btn-primary btn-sm" type="button" data-tab="monitor">${ICON.activity} 查看节点情况 ${ICON.arrow}</button><button class="btn btn-sm" type="button" data-tab="speed">${ICON.speed} 联动测速</button></div></div><!-- 提供节点监控的主要入口。 -->
    <div class="hero-ring"><div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="${s.devices} 台设备中 ${s.online} 台在线"><circle class="track" cx="90" cy="90" r="72"/><circle class="progress" cx="90" cy="90" r="72" stroke-dasharray="${(pct(s.online, s.devices || 1) * 4.524).toFixed(2)} 452.4"/></svg><div class="donut-center"><div class="donut-value">${pct(s.online, s.devices || 1)}<span>%</span></div><div class="donut-label">设备在线率</div></div></div><div class="ring-caption"><i class="dot"></i>${s.online} / ${s.devices} 台设备在线</div></div></section><!-- 用真实比例绘制完整在线率环图。 -->
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-top"><div class="kpi-label">设备总数</div><div class="kpi-ico">${ICON.devices}</div></div><div class="kpi-value">${s.devices}</div><div class="kpi-sub">在线 ${s.online} · 离线 ${s.offline}${s.unknown ? ` · 未知 ${s.unknown}` : ''}</div></div>
    <div class="kpi"><div class="kpi-top"><div class="kpi-label">在线率</div><div class="kpi-ico">${ICON.activity}</div></div><div class="kpi-value">${pct(s.online, s.devices || 1)}%</div><div class="kpi-sub">在线状态优先取本机实时节点</div></div>
    <div class="kpi"><div class="kpi-top"><div class="kpi-label">管理密钥</div><div class="kpi-ico">${ICON.key}</div></div><div class="kpi-value">${s.keys}</div><div class="kpi-sub">${expiring.length ? `${expiring.length} 个 7 天内到期` : '暂无即将到期'}</div></div>
    <div class="kpi"><div class="kpi-top"><div class="kpi-label">用户</div><div class="kpi-ico">${ICON.users}</div></div><div class="kpi-value">${s.users}</div><div class="kpi-sub">${expDev.length ? `${expDev.length} 台设备密钥将到期` : '设备审批见设置页'}</div></div>
  </div>
  <div class="quick-grid"><button class="quick-card" type="button" data-tab="monitor"><span class="quick-icon">${ICON.activity}</span><span><strong>节点监控</strong><small>连接状态、路径与流量</small></span>${ICON.arrow}</button><button class="quick-card" type="button" data-tab="devices"><span class="quick-icon">${ICON.devices}</span><span><strong>管理设备</strong><small>授权、标签与子网路由</small></span>${ICON.arrow}</button><button class="quick-card" type="button" data-tab="netcheck"><span class="quick-icon">${ICON.globe}</span><span><strong>网络诊断</strong><small>检查 UDP 与中继延迟</small></span>${ICON.arrow}</button></div><!-- 汇总最常用的三个操作入口。 -->
  <div class="grid grid-2">
    <section class="panel"><div class="panel-head"><div><div class="panel-title">${ICON.info} 待处理事项</div><div class="panel-sub">只展示需要你留意的信息</div></div></div><div class="panel-body" style="padding:8px 16px 16px">${alertHtml}</div></section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">${ICON.devices} 最近设备</div><div class="panel-sub">按在线状态排序</div></div><button class="btn btn-sm btn-ghost" type="button" data-tab="devices">全部</button></div><div class="panel-body" style="padding:6px 10px 12px">${recent}</div></section>
  </div>
  <div class="callout callout-info" style="margin-top:14px"><b>在线状态是怎么判断的？</b>官方 devices 接口不保证返回 <code>online</code> 字段，因此优先用本机 <code>tailscale status</code> 的实时状态补全；都拿不到时显示「状态未知」。详见 <button class="btn-xs" type="button" data-tab="help">术语说明</button>。</div>`;
}

/* 设备 */
function deviceSorted(list) { const r = (x) => (x.onlineKnown === null ? 1 : x.online ? 0 : 2); return list.slice().sort((a, b) => r(a) - r(b) || String(a.hostname || '').localeCompare(String(b.hostname || ''))); }
function deviceList() { const snapshot = nodeMonitor.snapshot(); return state.data?.devices ? state.data.devices.map((device) => { const peer = peerForDevice(device, snapshot); return peer ? { ...device, online: peer.online === true, onlineKnown: peer.online === null ? null : true, onlineSource: 'local', lastSeen: peer.lastSeen || device.lastSeen } : device; }) : localDevices(snapshot); } // 设备行、排序和筛选统一使用最新客户端状态，管理 API 不可用时显示只读节点。
function filteredDevices() { // 统一筛选管理设备与本机节点。
  const q = state.query.trim().toLowerCase();
  return deviceSorted(deviceList()).filter((dev) => { // 对当前实际设备数据筛选。
    if (state.filter === 'online' && dev.online !== true) return false;
    if (state.filter === 'offline' && (dev.onlineKnown === null || dev.online !== false)) return false; // 用明确的在线值筛选离线，不能将已知状态字段当作离线值。
    if (state.filter === 'unknown' && dev.onlineKnown !== null) return false;
    if (state.filter === 'pending' && dev.authorized !== false) return false; // 只显示明确待批准设备。
    if (state.filter === 'exit' && !peerForDevice(dev, nodeMonitor.snapshot())?.exitNodeOption && !peerForDevice(dev, nodeMonitor.snapshot())?.exitNode) return false; // 仅按真实出口能力筛选。
    if (!q) return true;
    return [dev.hostname, dev.ipv4, dev.ipv6, dev.os, (dev.tags || []).join(' '), dev.id].some((x) => String(x || '').toLowerCase().includes(q));
  });
}
function deviceCard(dev) {
  const st = statusPill(dev); const m = osMeta(dev.os); const checked = state.selected.has(dev.id);
  const exp = dev.keyExpiryDisabled ? null : expiryInfo(dev.expires); const rc = (dev.advertisedRoutes || []).length;
  const inner = `<div class="dev-card-head">${state.batchMode ? `<span class="dev-check${checked ? ' on' : ''}">${checked ? '✓' : ''}</span>` : `<span class="dev-avatar">${m.icon}</span>`}
      <div class="dev-info"><div class="dev-name"><span>${esc(dev.hostname || '未命名设备')}</span>${dev.authorized === false ? '<span class="chip chip-warn">待授权</span>' : ''}</div><div class="dev-ip mono">${esc(dev.ipv4 || dev.ipv6 || '—')}</div></div><span class="pill ${st.c}"><i class="dot"></i>${st.l}</span></div>
    <div class="dev-meta"><span class="chip">${m.label}</span>${rc ? `<span class="chip chip-info">${rc} 条路由</span>` : ''}${exp && exp.days != null && exp.days <= 14 ? `<span class="chip chip-${exp.tone === 'danger' ? 'danger' : 'warn'}">密钥${exp.label}</span>` : ''}${(dev.tags || []).map((t) => `<span class="chip mono">${esc(t)}</span>`).join('')}</div>
    <div class="dev-actions"><span>${dev.onlineSource === 'local' ? '在线状态来自本机 Tailscale' : '点击查看详情与操作'}</span><span>${ICON.arrow}</span></div>`;
  return state.batchMode
    ? `<button type="button" class="dev-card dev-card-batch${checked ? ' selected' : ''}" data-act="sel-device" data-id="${esc(dev.id)}">${inner}</button>`
    : `<button type="button" class="dev-card" data-act="open-device" data-id="${esc(dev.id)}">${inner}</button>`;
}
function deviceRows() { return renderDeviceRows(filteredDevices(), { esc, icons: ICON, snapshot: nodeMonitor.snapshot(), timeAgo, fmtDay, batchMode: state.batchMode, selected: state.selected }); } // 集中生成设备行供搜索局部更新复用。
function renderDevices() { // 按官方设备页的标题、搜索、筛选和表格呈现。
  const all = filteredDevices(), managed = Boolean(state.data), options = [['all', '全部设备'], ['online', '在线'], ['offline', '离线'], ['unknown', '状态未知'], ['pending', '待批准'], ['exit', '出口节点']]; // 保留所有有数据支持的状态筛选。
  const chip = ([value, label]) => `<button class="filter-chip${state.filter === value ? ' active' : ''}" type="button" data-act="filter" data-filter="${value}">${label}</button>`; // 生成直接可点击的筛选标签。
  const source = managed ? '管理 API 设备列表 · 在线状态由本机客户端补全' : '本机可见设备 · 只读视图'; // 明确本机视角与网络管理范围。
  return `<div class="page-head official-page-head"><div><h2>设备</h2><p>管理你的网络设备、子网路由和出口节点。</p></div><div class="toolbar">${managed ? '<button class="btn btn-sm" type="button" data-act="batch-toggle">' + (state.batchMode ? '退出批量' : '批量操作') + '</button>' : ''}<button class="btn btn-sm" type="button" data-act="export-csv">导出 CSV</button><button class="btn btn-primary" type="button" data-act="add-device">＋ 添加设备</button></div></div>
  ${!managed ? '<div class="callout callout-info">' + (state.loading ? '正在读取管理 API，先展示本机可见设备。' : state.error ? '管理 API 暂时不可用，当前展示本机可见设备。' : '当前展示本机可见设备。') + ' 完整管理功能可在 <button class="text-button" type="button" data-tab="settings">设置</button> 中核对凭证。</div>' : ''}
  <div class="official-filter-bar"><label class="search-wrap">${ICON.search}<input class="input" id="device-search" type="search" aria-label="搜索设备" placeholder="搜索设备、地址、操作系统或标签…" value="${esc(state.query)}" autocomplete="off"></label><details class="filter-details"><summary class="btn">${ICON.overview} 筛选⌄</summary><div class="filter-options">${options.map(([value, label]) => `<button type="button" class="${state.filter === value ? 'active' : ''}" data-act="filter" data-filter="${value}">${label}</button>`).join('')}</div></details></div>
  <div class="active-filters">${options.map(chip).join('')}</div>
  ${nodeMonitor.error() ? '<div class="callout callout-warn">本机节点采集失败：' + esc(nodeMonitor.error()) + '。' + (nodeMonitor.snapshot() ? '在线状态可能来自上次快照，请在节点信息页刷新核对。' : '节点状态尚未取得，请在节点信息页检查客户端。') + '</div>' : ''} <!-- 明确指出客户端快照过期，避免把旧在线状态当成实时状态。 -->
  ${state.batchMode && managed ? '<div class="batch-bar"><span>已选 ' + state.selected.size + ' 台</span><span class="spacer"></span><button class="btn btn-sm" type="button" data-act="batch-all">全选当前</button><button class="btn btn-sm" type="button" data-act="batch-clear">清空</button><button class="btn btn-sm" type="button" data-act="batch-authorize">批量授权</button><button class="btn btn-sm btn-primary" type="button" data-act="batch-approve-routes">批准路由</button></div>' : ''}
  <div class="count-label"><b id="device-count">${all.length}</b> 台设备 <span>· ${source}</span></div><div class="table-wrap official-table-wrap"><table class="table devices-table"><thead><tr><th>设备</th><th>地址</th><th>版本</th><th>最后在线</th><th><span class="sr-only">操作</span></th></tr></thead><tbody id="device-rows">${deviceRows()}</tbody></table></div>
  <p class="table-note">自建服务器和出口节点显示在本页。自建 DERP 中继请在 <button class="text-button" type="button" data-tab="nodes">中继节点</button> 查看；点击设备名称可查看节点连接详情。</p>`; // 不把 DERP 区域误当成网络设备。
} // 结束官方式设备列表。
function addDevice() { // 提供真实可用的官方客户端安装入口。
  enrollmentView.open({ mock: state.status?.mock }); // 直接生成注册 Key 与对应终端命令，而非只跳转安装页面。
} // 结束添加设备引导。

/* 抽屉 */
const remoteView = createRemoteView({ api, esc, redraw: renderDrawer, confirm: confirmDialog, toast }); // 远程任务独立于设备列表刷新，重绘仅更新抽屉。
async function openDevice(id) {
  remoteView.load(id); // 并行读取真实连接目标与 SSH 配置。
  state.drawer = { id, loading: true }; renderDrawer();
  try {
    const [dev, routes] = await Promise.all([api(`/api/device?id=${encodeURIComponent(id)}`), api(`/api/device/routes?id=${encodeURIComponent(id)}`), nodeMonitor.load({ background: true }), relayView.load({ background: true })]); // 并行读取管理详情、真实连接和中继主机。
    state.drawer = { id, loading: false, device: dev.device || dev, routes };
  } catch (e) { state.drawer = { id, loading: false, error: e.message || String(e) }; }
  renderDrawer();
}
async function openLocalDevice(id) { // 本机节点只读详情不调用管理写接口。
  await relayView.load({ background: true }); // 补全首选中继的域名和端口。
  const device = deviceList().find((item) => item.id === id); // 仅查找当前已展示设备。
  if (!device) return; // 节点已消失时不打开错误详情。
  state.drawer = { id, device, localOnly: true }; renderDrawer(); // 标记为只读抽屉。
  remoteView.load(id); // 本机可见节点无需管理令牌也可单独配置 SSH 运维。
} // 结束只读设备入口。
function closeDrawer() { state.drawer = null; remoteView.close(); const r = $('#drawer-root'); if (r) r.classList.remove('open'); } // 停止抽屉轮询，远端已提交任务继续执行。
function renderDrawer() {
  const root = $('#drawer-root'), box = $('#drawer'); if (!root || !box) return;
  if (!state.drawer) { root.classList.remove('open'); box.innerHTML = ''; return; }
  root.classList.add('open');
  const dr = state.drawer;
  if (dr.loading) { box.innerHTML = '<div class="drawer-head"><h2>加载中…</h2></div>'; return; }
  if (dr.error) { box.innerHTML = `<div class="drawer-head"><h2>读取失败</h2><p>${esc(dr.error)}</p><button class="icon-btn" type="button" data-act="close-drawer">✕</button></div>`; return; }
  if (dr.localOnly) { const d = dr.device, peer = peerForDevice(d, nodeMonitor.snapshot()); box.innerHTML = `<div class="drawer-head"><h2>${esc(d.hostname)}</h2><p>本机可见节点 · 只读</p><button class="icon-btn" type="button" data-act="close-drawer" aria-label="关闭详情">✕</button></div><div class="drawer-body"><div class="sheet"><div class="sheet-title">设备信息</div>${kv('IP 地址', esc(d.addresses.join(' / ')))}${kv('系统', esc(d.os || '未提供'))}${kv('客户端版本', esc(d.clientVersion || '本机状态未提供'))}${kv('出口能力', peer?.exitNode ? '当前使用的出口节点' : peer?.exitNodeOption ? '可用出口节点' : '未公布出口能力')}<button class="btn btn-sm" type="button" data-act="copy" data-text="${esc(d.ipv4 || d.ipv6)}">复制 IP</button></div>${renderConnectionSheet(peer, relayView.snapshot(), { esc, fmtDate, fmtBytes })}${remoteView.render(d)}</div>`; return; } // 只读节点只展示真实状态与复制操作。
  const d = dr.device || {}; const st = statusPill(d); const m = osMeta(d.os); const exp = expiryInfo(d.expires);
  const adv = (dr.routes && dr.routes.advertisedRoutes) || []; const en = (dr.routes && dr.routes.enabledRoutes) || [];
  const rows = adv.map((r) => `<label class="route-item"><input type="checkbox" data-route="${esc(r)}" ${en.includes(r) ? 'checked' : ''}/><span class="mono">${esc(r)}</span></label>`).join('');
  const exitChecked = en.includes('0.0.0.0/0');
  box.innerHTML = `<div class="drawer-head"><h2>${esc(d.hostname || '未命名设备')}</h2><p class="mono">${esc(d.ipv4 || d.ipv6 || '')} · ${m.label}</p><button class="icon-btn" type="button" data-act="close-drawer">✕</button></div>
  <div class="drawer-body">
    ${renderConnectionSheet(peerForDevice(d, nodeMonitor.snapshot()), relayView.snapshot(), { esc, fmtDate, fmtBytes })} <!-- 补充设备实时节点连接信息。 -->
    ${remoteView.render(d)} <!-- 展示独立认证的 SSH 运维与客户端升级。 -->
    <div class="actions"><span class="pill ${st.c}"><i class="dot"></i>${st.l}</span>${d.authorized === false ? '<span class="pill pill-warn">待授权</span>' : ''}</div>
    <div class="sheet"><div class="sheet-head"><span class="sheet-title">${ICON.info} 基本信息</span></div>
      ${kv('设备 ID', `<span class="mono">${esc(d.id)}</span>`)}${kv('IP 地址', `<span class="mono">${esc(d.ipv4 || '—')}</span>`)}
      ${kv('系统', m.label)}${kv('最后在线', timeAgo(d.lastSeen))}${kv('授权', d.authorized ? '<span class="chip chip-ok">已授权</span>' : '<span class="chip chip-warn">待授权</span>')}
      ${kv('密钥到期', `<span class="chip chip-${exp.tone}">${esc(exp.label)}</span>${d.keyExpiryDisabled ? ' <span class="chip">已禁用到期</span>' : ''}`)}
    </div>
    <div class="sheet"><div class="sheet-head"><span class="sheet-title">${ICON.route} 子网路由与出口</span></div>
      ${adv.length ? `<div class="route-list">${rows}</div><div class="actions"><button class="btn btn-sm btn-primary" type="button" data-act="save-routes">保存路由</button></div>` : '<div class="sheet-note">这台设备没有公布任何子网路由。需先在设备上执行 <code>tailscale up --advertise-routes=192.168.1.0/24</code>，再回来勾选启用。</div>'}
      ${adv.includes('0.0.0.0/0') ? `<label class="check"><input type="checkbox" data-route="0.0.0.0/0" ${exitChecked ? 'checked' : ''}/> 作为出口节点（0.0.0.0/0 与 ::/0）</label>` : ''}
      <div class="sheet-note"><b>子网路由</b>${tip('?', '把设备所在内网的网段加入 tailnet；先“公布”再在管理台“启用”，缺一不可。')} 与 <b>出口节点</b>${tip('?', '让其他设备全部流量经这台设备转发。')} 的区别见术语页。</div>
    </div>
    <div class="sheet"><div class="sheet-head"><span class="sheet-title">${ICON.key} 操作</span></div>
      <div class="actions" style="flex-wrap:wrap"><button class="btn btn-sm" type="button" data-act="device-authorize" data-id="${esc(d.id)}" data-next="${d.authorized ? '0' : '1'}">${d.authorized ? '取消授权' : '授权加入'}</button>
        <button class="btn btn-sm" type="button" data-act="device-rename" data-id="${esc(d.id)}">重命名</button>
        <button class="btn btn-sm" type="button" data-act="device-tags" data-id="${esc(d.id)}">编辑标签</button>
        <button class="btn btn-sm" type="button" data-act="device-key-expiry" data-id="${esc(d.id)}" data-next="${d.keyExpiryDisabled ? '0' : '1'}">${d.keyExpiryDisabled ? '启用密钥到期' : '禁用密钥到期'}</button></div>
      <div class="actions" style="margin-top:8px"><button class="btn btn-sm" type="button" data-act="copy-advertise">复制公布命令</button><button class="btn btn-sm" type="button" data-act="copy" data-text="${esc(d.ipv4 || d.id)}">复制 IP</button></div>
      <div class="actions" style="margin-top:8px"><button class="btn btn-sm btn-warn" type="button" data-act="device-expire" data-id="${esc(d.id)}" data-name="${esc(d.hostname || '')}">过期设备密钥</button></div>
      <div class="sheet-note">“过期密钥”会让设备立即下线，需重新登录 Tailscale 才能恢复。</div>
    </div>
    <div class="sheet"><div class="sheet-head"><span class="sheet-title">${ICON.trash} 危险区</span></div>
      <button class="btn btn-sm btn-danger" type="button" data-act="device-delete" data-id="${esc(d.id)}" data-name="${esc(d.hostname || '')}">从 tailnet 删除设备</button></div>
  </div>`;
}

/* 密钥 */
function renderKeys() {
  const d = state.data || {}; // 无管理凭证时仍可进入令牌配置入口。
  const keys = (d.keys || []).slice().sort((a, b) => Date.parse(b.createdAt || b.created || 0) - Date.parse(a.createdAt || a.created || 0));
  const vis = keys.filter((k) => {
    const rev = !!(k.revoked || k.status === 'revoked');
    const exp = k.expiresAt || k.expiry || k.expires;
    const expired = exp && new Date(exp).getTime() < Date.now();
    if (state.keyFilter === 'active') return !rev && !expired;
    if (state.keyFilter === 'expiring') return isExpiring(exp);
    if (state.keyFilter === 'revoked') return rev;
    return true;
  });
  const rows = vis.map((k) => { const st = keyStatus(k); return `<tr><td><strong class="mono">${esc(k.id)}</strong><div class="muted" style="font-size:11.5px">${esc(k.description || '未命名')}</div></td><td><span class="pill ${st.c}">${st.l}</span></td><td>${keyCaps(k).map((c) => `<span class="chip">${c}</span>`).join('') || '<span class="muted">—</span>'}</td><td class="muted">${fmtDay(k.expiresAt || k.expiry || k.expires)}</td><td class="muted">${fmtDay(k.createdAt || k.created)}</td><td><button class="btn btn-xs btn-ghost" type="button" data-act="key-revoke" data-id="${esc(k.id)}" data-desc="${esc(k.description || '')}">吊销</button></td></tr>`; }).join('');
  const seg = (v, l) => `<button class="seg${state.keyFilter === v ? ' on' : ''}" type="button" data-act="key-filter" data-kf="${v}">${l}</button>`;
  return `${pageHead('密钥管理', '管理设备注册密钥，并测试或替换本后台使用的 API 管理令牌。', '<button class="btn" type="button" data-act="key-guide">使用 Key 登录教程</button><button class="btn btn-primary" type="button" data-act="key-create">＋ 创建设备注册密钥</button>')}
  ${credentialsView.render()} <!-- 管理令牌与设备注册密钥独立呈现。 -->
  ${state.error ? '<div class="callout callout-warn">管理数据读取失败，请测试或替换上方管理令牌。以下列表可能来自旧快照，不能据此判断没有密钥。</div>' : ''} <!-- 不把管理接口故障显示成正常的空密钥列表。 -->
  <div class="keys-section-head"><h3>设备注册密钥 <span class="heading-tag">tskey-auth</span></h3><p>用于让新设备加入网络，不能用于后台 API 管理。</p></div>
  <div class="toolbar"><div class="segmented">${seg('all', '全部')}${seg('active', '有效')}${seg('expiring', '7 天内到期')}${seg('revoked', '已吊销')}</div></div>
  ${vis.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>设备注册密钥</th><th>状态</th><th>能力</th><th>到期</th><th>创建</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="panel"><div class="empty"><div class="empty-ico">🔑</div><strong>${keys.length ? '该筛选下没有密钥' : '还没有设备注册密钥'}</strong><p>${keys.length ? '换个筛选条件。' : '创建设备注册密钥，用于 NAS、服务器或其他设备加入网络。'}</p><div class="actions"><button class="btn btn-primary" type="button" data-act="key-create">立即创建</button></div></div></div>`}
  <div class="callout callout-info" style="margin-top:14px"><b>能力说明</b>${tip('?', '“可复用”可反复注册设备；“一次性”注册一台后失效；“临时节点”会自动清理；“预授权”免审批。')}新建后明文只显示一次，请立即复制保存。</div>`;
}

/* 用户 */
function renderUsers() {
  const d = state.data; if (!d) return '';
  const users = d.users || [];
  const rows = users.map((u) => `<tr><td><strong>${esc(u.displayName || u.loginName || '')}</strong><div class="muted mono" style="font-size:11.5px">${esc(u.loginName || '—')}</div></td>
    <td><span class="chip ${u.role === 'owner' ? 'chip-accent' : ''}">${esc(u.role || 'member')}</span></td><td>${u.status === 'active' ? '<span class="pill pill-ok">活跃</span>' : `<span class="pill pill-muted">${esc(u.status || '—')}</span>`}</td>
    <td>${u.deviceCount != null ? u.deviceCount + ' 台' : '—'}</td><td class="muted">${fmtDay(u.created)}</td>
    <td>${u.role === 'owner' ? '<span class="muted">所有者</span>' : `<select class="select select-sm" data-act="user-role" data-id="${esc(u.id)}"><option value="member" ${u.role === 'member' ? 'selected' : ''}>member</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select> <button class="btn btn-xs btn-ghost" type="button" data-act="user-del" data-id="${esc(u.id)}" data-name="${esc(u.displayName || '')}">移除</button>`}</td></tr>`).join('');
  return `${pageHead('用户', `共 ${users.length} 位成员。owner 是网络所有者，不能在这里降级或移除。`)}
  ${users.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>设备</th><th>加入时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel"><div class="empty"><div class="empty-ico">👥</div><strong>没有成员</strong><p>或当前 Key 没有读取用户的权限。</p></div></div>'}`;
}

/* Webhook */
async function loadWebhooks(force) {
  if (state.webhooks && !force) return;
  try { const r = await api('/api/webhooks'); state.webhooks = r.webhooks || []; } catch (e) { state.webhooks = { error: e.message }; }
  if (state.tab === 'webhooks') render();
}
function renderWebhooks() {
  const h = state.webhooks; const hooks = Array.isArray(h) ? h : [];
  const rows = hooks.map((x) => `<tr><td class="mono">${esc(x.endpointUrl || '—')}</td><td>${(x.subscriptions || []).map((s) => `<span class="chip">${esc(s)}</span>`).join(' ') || '—'}</td><td class="muted">${fmtDay(x.createdAt || x.created)}</td><td><button class="btn btn-xs btn-danger" type="button" data-act="webhook-del" data-id="${esc(x.id)}" data-url="${esc(x.endpointUrl || '')}">删除</button></td></tr>`).join('');
  return `${pageHead('Webhook', '设备事件推送到你的服务。收到请求时校验 <code>Tailscale-Webhook-Signature</code> 头即可防伪造。', '<button class="btn btn-sm btn-primary" type="button" data-act="webhook-create">新建 Webhook</button><button class="btn btn-sm btn-ghost" type="button" data-act="webhook-refresh">刷新</button>')}
  ${h && h.error ? `<div class="callout callout-warn">${esc(h.error)}</div>` : ''}
  ${hooks.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>回调地址</th><th>订阅</th><th>创建</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="panel"><div class="empty"><div class="empty-ico">🔔</div><strong>还没有 Webhook</strong><p>创建后设备事件会以 POST 推送到你的地址。</p><div class="actions"><button class="btn btn-primary" type="button" data-act="webhook-create">立即创建</button></div></div></div>`}`;
}

/* DNS */
async function loadDns(force) {
  if (state.dns && !force) return;
  try { state.dns = await api('/api/dns'); } catch (e) { state.dns = { error: e.message }; }
  if (state.tab === 'dns') render();
}
function renderDns() {
  const r = state.dns;
  if (!r) return pageHead('网络 DNS', '读取中…') + skeleton();
  if (r.error) return pageHead('网络 DNS', '读取失败') + `<div class="callout callout-warn">${esc(r.error)}</div>`;
  const ns = r.nameservers || [], sp = r.searchPaths || [], magic = !!r.magicDNS;
  return `${pageHead('网络 DNS', 'tailnet 的全局名称服务器、MagicDNS 与搜索域，改动对所有设备生效。', '<button class="btn btn-sm" type="button" data-act="dns-refresh">刷新</button>')}
  <div class="grid grid-2">
    <section class="panel"><div class="panel-head"><div><div class="panel-title">MagicDNS</div><div class="panel-sub">用名字而不是 IP 访问设备</div></div><button class="pill ${magic ? 'pill-ok' : 'pill-muted'}" type="button" data-act="magic-toggle" data-on="${magic ? '1' : '0'}"><i class="dot"></i>${magic ? '已开启' : '已关闭'}</button></div><div class="panel-body"><p class="muted">开启后设备获得 <code>名字.ts.net</code> 形式域名。</p></div></section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">全局名称服务器</div><div class="panel-sub">设备优先使用的 DNS</div></div></div><div class="panel-body"><div class="dns-list">${ns.length ? ns.map((ip) => `<div class="dns-row"><span class="mono">${esc(ip)}</span><button class="btn btn-xs btn-ghost" type="button" data-act="dns-ns-del" data-value="${esc(ip)}">删除</button></div>`).join('') : '<div class="sheet-note">当前没有配置，设备使用本地 DNS。</div>'}</div><div class="form-row"><input class="input" id="dns-ns-input" placeholder="1.1.1.1" autocomplete="off"/><button class="btn btn-sm" type="button" data-act="dns-ns-add">添加</button></div></div></section>
  </div>
  <section class="panel"><div class="panel-head"><div><div class="panel-title">搜索域</div><div class="panel-sub">短名称自动补全</div></div></div><div class="panel-body"><div class="dns-list">${sp.length ? sp.map((x) => `<div class="dns-row"><span class="mono">${esc(x)}</span><button class="btn btn-xs btn-ghost" type="button" data-act="dns-sp-del" data-value="${esc(x)}">删除</button></div>`).join('') : '<div class="sheet-note">还没有搜索域。</div>'}</div><div class="form-row"><input class="input" id="dns-sp-input" placeholder="corp.example.com" autocomplete="off"/><button class="btn btn-sm" type="button" data-act="dns-sp-add">添加</button></div></div></section>`;
}

/* ACL */
async function loadAcl(force) {
  if (state.acl && !force) return;
  try { state.acl = await api('/api/acl'); } catch (e) { state.acl = { error: e.message }; }
  if (state.tab === 'acl') render();
}
function renderAcl() {
  const r = state.acl;
  if (!r) return pageHead('访问控制', '读取中…') + skeleton();
  if (r.error) return pageHead('访问控制', '读取失败') + `<div class="callout callout-warn">${esc(r.error)}</div>`;
  return `${pageHead('访问控制', '直接编辑 tailnet 策略文件（ACL）。保存前可先校验语法；保存采用 ETag 乐观锁防覆盖。', '<button class="btn btn-sm" type="button" data-act="acl-reload">重新拉取</button><button class="btn btn-sm" type="button" data-act="acl-validate">校验语法</button><button class="btn btn-sm btn-primary" type="button" data-act="acl-save">保存</button>')}
  <section class="panel"><div class="panel-head"><div><div class="panel-title">规则预览</div><div class="panel-sub">输入邮箱或 IP:端口，查策略会命中哪条规则</div></div><span class="mono muted">${esc(String(r.etag || '').replace(/"/g, '').slice(0, 10))}</span></div><div class="panel-body"><div class="form-row"><select class="select" id="acl-preview-type"><option value="user">按用户</option><option value="ipport">按 IP:端口</option></select><input class="input" id="acl-preview-for" placeholder="user@example.com 或 100.101.1.12:22" autocomplete="off"/><button class="btn btn-sm" type="button" data-act="acl-preview">预览</button></div><div id="acl-preview-out"></div></div></section>
  <section class="panel"><div class="panel-head"><div><div class="panel-title">策略文件（HuJSON）</div><div class="panel-sub">支持注释的 JSON；保存时自动去注释</div></div></div><div class="panel-body"><textarea id="acl-editor" class="acl-editor" spellcheck="false">${esc(state.aclDraft != null ? state.aclDraft : r.acl || '')}</textarea></div></section>
  <div class="callout callout-warn"><b>小心</b>ACL 写错可能导致设备无法互访。建议先校验语法、保存后立即试连一次。</div>`;
}

/* 测速 */
async function runSpeed() {
  if (state.speedRunning) return;
  state.speedRunning = true; render();
  try {
    const peers = await api('/api/speed/peers');
    state.speed = { peers: peers.peers || [], error: null };
    render();
    const urlInput = $('#speed-url');
    const dl = await api('/api/speed/download', { method: 'POST', body: urlInput && urlInput.value.trim() ? { url: urlInput.value.trim() } : {}, timeout: 120000 });
    state.speed = { ...state.speed, download: dl };
  } catch (e) { state.speed = { ...(state.speed || {}), error: e.message || String(e) }; }
  state.speedRunning = false; render();
}
async function refreshExit() {
  try { state.exit = await api('/api/exit'); } catch (e) { state.exit = { error: e.message }; }
  if (state.tab === 'speed') render();
}
function renderSpeed() {
  const sp = state.speed || {}; const ex = state.exit || {}; const act = ex.active; const dl = sp.download;
  const peers = sp.peers || []; const dlOk = dl && dl.ok && !dl.error;
  return `${pageHead('联动测速', '面板主机 → 各设备 tailscale ping 延迟；下载测速走本机当前出口链路（开出口时就是经出口节点的速度）。', '<button class="btn btn-sm" type="button" data-act="exit-refresh">' + ICON.refresh + ' 刷新出口</button>')}
  <div class="grid grid-2">
    <section class="panel"><div class="panel-head"><div><div class="panel-title">${ICON.power} 当前出口</div><div class="panel-sub">流量从哪里出去</div></div></div><div class="panel-body">
      ${act ? `<div class="kv"><span class="kv-k">出口 IP</span><span class="kv-v mono">${esc(act.ip || '—')}</span></div><div class="kv"><span class="kv-k">状态</span><span class="kv-v">${act.online ? '<span class="pill pill-ok"><i class="dot"></i>在线</span>' : '<span class="pill pill-warn"><i class="dot"></i>离线</span>'}</span></div>` : '<div class="sheet-note">当前没有启用出口节点，本机走自己的运营商网络。</div>'}
      <div class="actions" style="margin-top:12px"><button class="btn btn-sm" type="button" data-act="speed-run" ${state.speedRunning ? 'disabled' : ''}>${state.speedRunning ? '测速中…' : '开始测速'}</button>${act ? '<button class="btn btn-sm btn-ghost" type="button" data-act="exit-off">关闭出口节点</button>' : ''}</div>
      <div class="form-row" style="margin-top:10px"><input class="input mono" id="speed-url" placeholder="自定义测速文件 URL（可选）" style="min-width:220px"/></div></div></section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">${ICON.speed} 下载带宽</div><div class="panel-sub">默认取国内镜像的 2 MB 片段</div></div></div><div class="panel-body">
      ${dlOk ? `<div class="speed-hero"><div class="speed-value">${dl.mbps != null ? Number(dl.mbps).toFixed(2) : '—'}</div><div class="speed-unit">Mbps</div></div><div class="muted" style="font-size:12.5px">${fmtBytes(dl.bytes)} / ${dl.seconds}s · ${dl.via && dl.via !== '本机直连' ? '经出口 ' + esc(dl.via) : '本机直连'}</div>` : `<div class="speed-hero"><div class="speed-value muted">—</div><div class="muted">${sp.error ? esc(sp.error) : '点「开始测速」'}</div></div>`}
      ${dlOk && dl.mock ? '<div class="sheet-note">演示模式为模拟值。</div>' : ''}
      <div class="callout callout-info" style="margin-top:12px">测速约消耗 2 MB；开出口时流量算在出口设备上。</div></div></section>
  </div>
  <section class="panel"><div class="panel-head"><div><div class="panel-title">${ICON.devices} 设备延迟</div><div class="panel-sub">tailscale ping</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>设备</th><th>IP</th><th>延迟</th><th>路径</th></tr></thead><tbody>
    ${peers.length ? peers.map((r) => `<tr><td>${esc(r.hostname || '—')}</td><td class="mono">${esc(r.ip || '')}</td><td>${r.ok ? `<span class="mono">${Math.round(r.latencyMs)} ms</span>` : '<span class="muted">失败</span>'}</td><td class="muted">${r.ok ? (r.relay ? '中继 ' + esc(r.relay) : '直连') : esc(r.error || '—')}</td></tr>`).join('') : `<tr><td colspan="4" class="muted" style="padding:18px">${state.speedRunning ? '正在 ping…' : '还没有数据。'}</td></tr>`}
  </tbody></table></div></section>`;
}

/* 网络诊断 */
async function loadNodes() { return relayView.load(); } // 中继页使用不等待 netcheck 的快速读取。
function renderNodes() { return relayView.render(); } // 委托独立模块展示自建中继与明细。

async function runNetcheck() {
  if (state.netcheckRunning) return;
  state.netcheckRunning = true; render();
  try { state.netcheck = await api('/api/netcheck', { timeout: 45000 }); } catch (e) { state.netcheck = { error: e.message || String(e) }; }
  state.netcheckRunning = false; render();
}
function renderNetcheck() {
  const r = state.netcheck;
  const head = pageHead('网络诊断', 'tailscale netcheck：UDP 是否通、NAT 类型、最近的 DERP 与各区域延迟。', `<button class="btn btn-sm btn-primary" type="button" data-act="netcheck-run">${state.netcheckRunning ? '检测中…' : '重新检测'}</button>`);
  if (!r) return head + `<div class="panel"><div class="panel-body muted">${state.netcheckRunning ? '正在检测（2–10 秒）…' : ''}</div></div>`;
  if (r.error) return head + `<div class="callout callout-warn">${esc(r.error)}</div>`;
  const derp = (r.derp || []).map((x) => `<tr><td class="mono">${esc(x.region || '')}</td><td>${esc(x.name || '')}</td><td>${x.latencyMs != null ? `<span class="mono">${Math.round(x.latencyMs)} ms</span>` : '—'}</td></tr>`).join('');
  return head + `<div class="grid grid-2">
    <section class="panel"><div class="panel-head"><div><div class="panel-title">本机网络</div></div></div><div class="panel-body">
      ${kv('UDP', r.udp ? '可用' : '不可用')}${kv('IPv4', esc(r.ipv4 || '—'))}${kv('IPv6', esc(r.ipv6 || '—'))}${kv('NAT 映射随目标变化', esc(r.mappingVariesByDestIP || '—'))}${kv('端口映射', esc(r.portMapping || '—'))}${kv('强制门户', r.captivePortal ? '是' : '否')}${kv('最近 DERP', esc(r.nearestDERP || '—'))}</div></section>
    <section class="panel"><div class="panel-head"><div><div class="panel-title">DERP 延迟</div><div class="panel-sub">越低越好</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>区域</th><th>名称</th><th>延迟</th></tr></thead><tbody>${derp || '<tr><td colspan="3" class="muted">没有数据</td></tr>'}</tbody></table></div></section>
  </div>`;
}

/* 操作记录 */
async function loadAudit(force) {
  if (state.audit && !force) return;
  try { const r = await api('/api/audit'); state.audit = r.entries || []; } catch (e) { state.audit = { error: e.message }; }
  if (state.tab === 'audit') render();
}
function renderAudit() {
  const list = Array.isArray(state.audit) ? state.audit : [];
  const rows = list.map((e) => `<tr><td class="muted mono">${fmtDate(e.t)}</td><td><span class="chip mono">${esc(e.m || '')}</span></td><td class="mono">${esc(e.p || '')}</td><td>${e.s >= 200 && e.s < 300 ? `<span class="pill pill-ok">${e.s}</span>` : `<span class="pill pill-danger">${e.s || '—'}</span>`}</td><td class="muted">${esc(e.note || '')}</td></tr>`).join('');
  return `${pageHead('操作记录', '面板的写操作与自动动作，存本机 <code>data/audit.log</code>（只记录方法、路径、状态码）。', '<button class="btn btn-sm" type="button" data-act="audit-refresh">刷新</button>')}
  ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>方式</th><th>路径</th><th>状态</th><th>备注</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel"><div class="empty"><div class="empty-ico">🧾</div><strong>还没有记录</strong><p>做一次写操作就会出现。</p></div></div>'}`;
}

/* 设置 */
async function loadServe(force) {
  if (state.serve && !force) return;
  try { state.serve = await api('/api/serve'); } catch (e) { state.serve = { error: e.message }; }
  if (state.tab === 'settings') render();
}
function policyRow(field, label) {
  const s = state.settings && state.settings.settings;
  const v = s && typeof s[field] === 'boolean' ? s[field] : null;
  return `<div class="kv"><span class="kv-k">${esc(label)}</span><span class="kv-v">${v === null ? '<span class="muted">未知</span>' : `<button class="pill ${v ? 'pill-ok' : 'pill-muted'}" type="button" data-act="policy-toggle" data-field="${field}" data-on="${v ? '1' : '0'}"><i class="dot"></i>${v ? '已开启' : '已关闭'}</button>`}</span></div>`;
}
async function loadSettings(force) {
  if (state.settings && !force) return;
  try { state.settings = await api('/api/settings'); } catch (e) { state.settings = { error: e.message }; }
  if (state.tab === 'settings') render();
}
function renderSettings() {
  const st = state.status || {}; const cfg = state.settings || {};
  return `${pageHead('设置', '配置主题、API 管理令牌与本机网络功能。')}
  ${themePreference.render()} <!-- 明确展示浅色、深色和跟随系统。 -->
  <section class="panel" style="margin-bottom:14px"><div class="panel-head"><div><div class="panel-title">局域网与域名访问</div><div class="panel-sub">其他设备使用相同入口连接此管理台</div></div><button class="btn btn-sm" type="button" data-act="copy" data-text="${esc(location.origin)}">复制当前入口</button></div><div class="panel-body"><div class="kv"><span class="kv-k">当前入口</span><span class="kv-v mono">${esc(location.origin)}</span></div></div></section> <!-- 显示实际浏览器入口，帮助用户确认正在访问哪台控制台。 -->
  <div class="grid grid-2">
    ${credentialsView.render()} <!-- 与密钥页复用先验证后替换的管理凭证入口。 -->
    <section class="panel"><div class="panel-head"><div><div class="panel-title">${ICON.power} 出口与自我保护</div></div></div><div class="panel-body">
      <div class="kv"><span class="kv-k">自动回落</span><span class="kv-v">${cfg.exitWatchRunning === false ? '<span class="pill pill-muted"><i class="dot"></i>未运行</span>' : cfg.exitAutoFallback !== false ? '<span class="pill pill-ok"><i class="dot"></i>已开启</span>' : '<span class="pill pill-muted"><i class="dot"></i>已关闭</span>'}</span></div> <!-- 区分配置开关与当前服务实际运行状态。 -->
      <p class="muted" style="font-size:12.5px">${cfg.exitWatchRunning === false ? '此实例未运行出口自动监测，不会自动切换部署电脑的出口。' : '出口节点连续两次不可达时自动关闭，事件写入操作记录。'}</p> <!-- 显示部署入口禁用自动切换的真实行为。 -->
      <p class="muted" style="font-size:12.5px">面板版本 ${esc(st.version || '')}</p>
    </div></section>
  </div>
  <section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">${ICON.shield} 网络策略（官方 tailnet 设置）</div><div class="panel-sub">直接修改审批与流量日志开关，改动立即对整个网络生效</div></div><button class="btn btn-sm btn-ghost" type="button" data-act="settings-refresh">刷新</button></div><div class="panel-body">
    ${policyRow('devicesApprovalOn', '新设备需审批')}${policyRow('usersApprovalOn', '新用户需审批')}${policyRow('devicesAutoUpdatesOn', '新设备默认自动更新')}${policyRow('networkFlowLoggingOn', '网络流量日志')}
    <div class="sheet-note">新设备默认自动更新仅影响后续加入的设备。已有设备可在详情中通过 SSH 修改自动更新偏好。</div>
  </div></section>
  <section class="panel" style="margin-top:14px"><div class="panel-head"><div><div class="panel-title">${ICON.cloud} 本机 Serve（HTTPS 反代）</div><div class="panel-sub">把本机端口经 tailnet 暴露为 https://本机名.ts.net</div></div><button class="btn btn-sm btn-ghost" type="button" data-act="serve-refresh">刷新</button></div><div class="panel-body">
    ${(() => { const s = state.serve || {}; if (s.error) return `<div class="callout callout-warn">${esc(s.error)}</div>`; if (s.configured) return `<div class="callout callout-ok">已配置：${(s.handlers || []).map((h) => esc(h.address)).join('、') || '—'}</div>`; return '<div class="sheet-note">当前本机没有 Serve 配置。</div>'; })()}
    <div class="form-row" style="margin-top:10px"><input class="input mono" id="serve-target" placeholder="http://127.0.0.1:8000"/><button class="btn btn-sm" type="button" data-act="serve-on">开启</button><button class="btn btn-sm btn-ghost" type="button" data-act="serve-off">全部关闭</button></div>
    <div class="sheet-note">会改动本机 tailscaled 配置（需管理员权限，且官方后台需开启 HTTPS）；不用了记得关闭。</div>
  </div></section>`;
}

/* 术语 */
const GLOSSARY = [
  ['基础', [
    ['Tailnet', '你的私有网络。同一 Tailnet 内的设备可以互相访问（除非 ACL 限制），免费个人版通常只有一个。'],
    ['设备', '安装了 Tailscale 并登录的机器，固定 100.x.y.z 地址，换网络不变。'],
    ['在线状态', '官方 devices 接口不保证返回 online 字段，所以优先用本机 tailscale status 的实时状态补全；拿不到时显示「状态未知」。'],
    ['MagicDNS', '给每台设备分配短主机名，用名字而非 IP 访问。'],
    ['设备审批', '开启后新设备需管理员批准才能加入。'],
    ['标签', '给设备打 tag（如 tag:nas），在 ACL 里按标签授权。'],
    ['设备密钥到期', '密钥到期后设备会被移出网络，需重新登录；长期在线的设备可禁用到期。'],
  ]],
  ['路由与出口', [
    ['子网路由', '把设备所在内网网段（如 192.168.1.0/24）加入 tailnet，其他设备就能访问该网段。'],
    ['公布 / 启用', '设备端声明愿意转发（advertise），管理台批准启用（enable），两步都完成才生效。'],
    ['出口节点', '把默认路由 0.0.0.0/0 与 ::/0 指向某台设备，让其他设备流量经它转发。'],
    ['出口风险', '出口承载全部流量，选可信设备并留意带宽与稳定性。'],
  ]],
  ['密钥', [
    ['管理密钥（API 令牌）', 'tskey-api-…，用于调用官方 API，本工具需要它读取设备与网络数据。'],
    ['设备密钥（auth key）', 'tskey-auth-…，注册新设备用，和 API 令牌不是一回事。'],
    ['可复用 / 一次性 / 临时 / 预授权', '分别控制能否多次注册、注册后是否失效、是否自动清理、是否免审批。'],
  ]],
  ['安全', [
    ['ACL', '访问控制规则，决定谁能访问什么；默认全互通，正式环境应按最小权限收紧。'],
    ['本机客户端', '跑管理台的机器上的 Tailscale，用于补全在线状态与显示本机 IP。'],
    ['状态未知', '官方接口没给在线字段，本机也匹配不到，管理台不做猜测。'],
  ]],
];
function renderHelp() {
  const q = state.glossaryQuery.trim().toLowerCase();
  const groups = GLOSSARY.map(([g, items]) => {
    const list = items.filter(([t, b]) => !q || (t + b).toLowerCase().includes(q));
    if (!list.length) return '';
    return `<section class="panel"><div class="panel-head"><div><div class="panel-title">${esc(g)}</div></div></div><div class="panel-body">${list.map(([t, b]) => `<div class="g-card"><div class="g-term">${esc(t)}</div><div class="g-body">${esc(b)}</div></div>`).join('')}</div></section>`;
  }).filter(Boolean).join('');
  return `${pageHead('术语说明', '把管理台里的名词一次讲清。')}
  <div class="toolbar"><label class="search-wrap"><span>${ICON.help}</span><input class="input" id="glossary-search" type="search" placeholder="搜索术语，例如：出口节点 / 密钥 / ACL" value="${esc(state.glossaryQuery)}" autocomplete="off"/></label></div>
  ${groups || '<div class="empty"><div class="empty-ico">🔍</div><strong>没有匹配的术语</strong><p>换个关键词。</p></div>'}`;
}

/* 弹窗 */
function openModal({ title, sub, body, okText = '确定', cancelText = '取消', tone = '', onOk, onClose }) { // 弹窗支持关闭清理及密钥请求期间的状态保护。
  const root = $('#modal-root'); if (!root) return;
  if (state.modalOnClose && state.modalOnClose() === false) return; if (!root.classList.contains('open')) state.modalReturnFocus = document.activeElement; state.modalOnClose = onClose || null; // 替换内容前清理上一弹窗并保存返回焦点。
  state.modalOnOk = onOk;
  root.innerHTML = `<div class="modal-backdrop" data-close="modal"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h3 id="modal-title">${esc(title)}</h3><button class="icon-btn" type="button" data-close="modal" aria-label="关闭对话框">✕</button></div> <!-- 通过标题标记弹窗，关闭按钮有可读名称。 -->
    <div class="modal-body">${sub ? `<p class="muted" style="margin-top:0">${sub}</p>` : ''}${body || ''}</div>
    <div class="modal-foot"><button class="btn btn-ghost" type="button" data-close="modal">${esc(cancelText)}</button><button class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" type="button" data-modal-ok>${esc(okText)}</button></div></div>`;
  root.classList.add('open');
  root.querySelector('.modal [data-close="modal"]')?.focus({ preventScroll: true }); // 打开后将键盘焦点移入弹窗。
}
function closeModal() { const root = $('#modal-root'); if (!root || (state.modalOnClose && state.modalOnClose() === false)) return; root.classList.remove('open'); root.innerHTML = ''; state.modalOnOk = null; state.modalOnClose = null; state.modalReturnFocus?.focus?.({ preventScroll: true }); state.modalReturnFocus = null; } // 清除包含密钥的 DOM 和回调，并恢复原按钮焦点。
async function handleModalOk(btn) {
  const fn = state.modalOnOk; if (!fn) return closeModal();
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (r === false) return; closeModal(); } catch (e) { const body = $('#modal-root .modal-body'); if (body) { let message = body.querySelector('.modal-request-error'); if (!message) { message = document.createElement('div'); message.className = 'callout callout-danger modal-request-error'; message.setAttribute('role', 'alert'); body.append(message); } message.textContent = e.message || '操作失败，请检查输入后重试'; } else toast(e.message || '操作失败', 'err'); } finally { if (btn) btn.disabled = false; } // 错误留在当前表单，避免短暂提示消失后不知道哪里失败。
}
function confirmDialog({ title, message, okText = '确认', tone = '' }) {
  return new Promise((resolve) => {
    openModal({ title, body: `<p>${esc(message)}</p>`, okText, tone });
    const root = $('#modal-root'); if (!root) return resolve(false);
    root.querySelectorAll('[data-close="modal"]').forEach((b) => b.addEventListener('click', () => resolve(false)));
    const ok = root.querySelector('[data-modal-ok]'); if (ok) ok.addEventListener('click', () => resolve(true));
  });
}
function promptDialog({ title, label, value = '', placeholder = '', okText = '保存', hint = '' }) {
  return new Promise((resolve) => {
    openModal({ title, okText, body: `<div class="field"><label class="label">${esc(label)}</label><input class="input" id="modal-input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"/></div>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}` });
    const root = $('#modal-root'); if (!root) return resolve(null);
    root.querySelectorAll('[data-close="modal"]').forEach((b) => b.addEventListener('click', () => resolve(null)));
    const ok = root.querySelector('[data-modal-ok]');
    if (ok) ok.addEventListener('click', () => { const v = ($('#modal-input') || {}).value; resolve(v == null ? null : String(v)); });
    setTimeout(() => { const i = $('#modal-input'); if (i) i.focus(); }, 60);
  });
}

/* 刷新 */
async function refreshData(silent = false) {
  try {
    const [status, overview] = await Promise.allSettled([api('/api/status').then((value) => { state.status = value; render(); return value; }), api('/api/overview', { timeout: 90000 })]); // 管理 API 出错时仍保留本机状态与节点页可用性。
    if (status.status === 'fulfilled') state.status = status.value; // 独立更新本地服务与凭证状态。
    if (overview.status === 'fulfilled') { state.data = overview.value; state.error = null; } else state.error = overview.reason; // 成功更新总览，失败保留旧快照并记录错误。
    if (status.status === 'rejected' && !state.error) state.error = status.reason; // 本地服务失联时给出真实错误。
  } catch (e) { state.error = e; } // 为意外运行错误保留显示信息。
  state.loading = false;
  if (!silent || ['overview', 'devices', 'keys', 'users'].includes(state.tab)) render(); // 创建或吊销密钥、修改成员后立即更新当前列表。
}
function switchTab(tab) {
  if (!TABS[tab]) return;
  state.tab = tab; state.batchMode = false; state.selected.clear();
  history.replaceState(null, '', `#${tab}`); // 允许直接收藏或刷新节点监控等具体页面。
  closeModal(); closeDrawer();
  if (tab === 'monitor' || tab === 'devices') nodeMonitor.load(); // 每次进入节点页读取新的快照。
  if (tab === 'speed') refreshExit();
  if (tab === 'netcheck' && !state.netcheck) runNetcheck();
  if (tab === 'terminals') { nodeMonitor.load(); fleetView.load(); } // 进入终端页时读取可见设备和配对状态。
  if (tab === 'nodes') loadNodes(); // 每次进入中继页重新核对客户端映射。
  if (tab === 'dns') loadDns();
  if (tab === 'acl') loadAcl();
  if (tab === 'webhooks') loadWebhooks();
  if (tab === 'audit') loadAudit(true);
  if (tab === 'settings') { loadSettings(); loadServe(); credentialsView.load(); } // 设置页读取凭证元信息。
  if (tab === 'keys') { credentialsView.load(); refreshData(true); } // 密钥页直接可用并刷新当前注册密钥列表。
  render();
}

/* 动作 */
async function deviceAction(action, id, extra = {}) { await api('/api/device/action', { method: 'POST', body: { action, id, ...extra } }); refreshData(true); if (state.drawer && state.drawer.id === id) openDevice(id); }
async function saveRoutes() {
  if (!state.drawer) return;
  const list = $$('#drawer input[data-route]:checked').map((x) => x.dataset.route);
  await api('/api/device/routes', { method: 'POST', body: { id: state.drawer.id, routes: list } });
  toast('路由已保存'); refreshData(true); openDevice(state.drawer.id);
}
async function setKeyExpiry(disable) {
  if (!state.drawer) return;
  await api('/api/device/key', { method: 'POST', body: { id: state.drawer.id, keyExpiryDisabled: !!disable } });
  toast(disable ? '已禁用密钥到期' : '已启用密钥到期'); openDevice(state.drawer.id); refreshData(true);
}
async function copyAdvertise() {
  const v = await promptDialog({ title: '生成公布命令', label: '设备所在内网网段', value: '192.168.1.0/24', hint: '同时加入 --advertise-exit-node；只想要子网路由可删掉后面参数。' });
  if (v == null) return;
  const s = String(v).trim();
  if (!/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(s) && !/^[0-9a-fA-F:]+\/\d{1,3}$/.test(s)) return toast('网段格式不对，例如 192.168.1.0/24', 'err');
  copyText(`tailscale up --advertise-routes=${s} --advertise-exit-node`);
}
async function createKey() { // 创建的是设备注册密钥，不是后台管理令牌。
  enrollmentView.open({ mock: state.status?.mock }); // 密钥页使用同一个向导，避免出现缺少标签或需要手工拼命令的旧流程。
} // 结束设备密钥创建。
function showSecret(secret) { // 明文仅存在于一次性结果弹窗。
  openModal({ title: '设备注册密钥已创建', sub: '复制保存后关闭；关闭后无法再次读取明文。', okText: '我已保存', cancelText: '关闭', body: '<div class="key-secret mono" id="secret-box">' + esc(secret) + '</div><div class="actions"><button class="btn" type="button" data-act="copy" data-text="' + esc(secret) + '">' + ICON.copy + ' 复制密钥</button></div><p class="sheet-note">在新设备上使用此密钥完成注册。它不能替换本后台的 API 管理令牌。</p>' }); // 不将新生成的密钥写入浏览器存储。
} // 结束一次性结果展示。

async function revokeKey(id, desc) {
  const ok = await confirmDialog({ title: '吊销这个密钥？', message: `吊销后不能再用这个密钥注册新设备，已加入的设备不会因此被移除${desc ? '（' + desc + '）' : ''}，不可恢复。`, okText: '吊销', tone: 'danger' });
  if (!ok) return;
  await api(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('密钥已吊销'); refreshData(true);
}
async function dnsAdd(kind) {
  const input = kind === 'ns' ? $('#dns-ns-input') : $('#dns-sp-input');
  const val = input && input.value.trim(); if (!val) return toast('先输入内容', 'err');
  const cur = kind === 'ns' ? ((state.dns && state.dns.nameservers) || []) : ((state.dns && state.dns.searchPaths) || []);
  const path = kind === 'ns' ? '/api/dns/nameservers' : '/api/dns/searchpaths';
  await api(path, { method: 'POST', body: kind === 'ns' ? { nameservers: [...cur, val] } : { searchPaths: [...cur, val] } });
  toast('已添加'); state.dns = null; loadDns(true);
}
async function dnsDel(kind, val) {
  const cur = kind === 'ns' ? ((state.dns && state.dns.nameservers) || []) : ((state.dns && state.dns.searchPaths) || []);
  const path = kind === 'ns' ? '/api/dns/nameservers' : '/api/dns/searchpaths';
  await api(path, { method: 'POST', body: kind === 'ns' ? { nameservers: cur.filter((x) => x !== val) } : { searchPaths: cur.filter((x) => x !== val) } });
  toast('已删除'); state.dns = null; loadDns(true);
}
async function magicToggle(on) { await api('/api/dns/preferences', { method: 'POST', body: { magicDNS: !on } }); toast(!on ? '已开启 MagicDNS' : '已关闭 MagicDNS'); state.dns = null; loadDns(true); }
async function aclValidate() { const ed = $('#acl-editor'); if (!ed) return; await api('/api/acl/validate', { method: 'POST', body: { acl: ed.value } }); toast('ACL 语法校验通过'); }
async function aclSave() {
  const ed = $('#acl-editor'); if (!ed) return;
  await api('/api/acl', { method: 'POST', body: { acl: ed.value, etag: (state.acl && state.acl.etag) || undefined } });
  toast('ACL 已保存'); state.acl = null; loadAcl(true);
}
async function aclPreview() {
  const ed = $('#acl-editor');
  const type = ($('#acl-preview-type') || {}).value || 'user';
  const pf = (($('#acl-preview-for') || {}).value || '').trim();
  if (!pf) return toast('先输入预览对象', 'err');
  const res = await api('/api/acl/preview', { method: 'POST', body: { acl: ed ? ed.value : '', type, previewFor: pf } });
  const out = $('#acl-preview-out'); if (!out) return;
  const m = res.matches || [];
  out.innerHTML = m.length ? m.map((x) => `<div class="alert alert-info" style="margin-top:8px"><span class="alert-ico">✓</span><span class="alert-main"><b>命中：${esc((x.users || []).join(', ') || '任意')} → ${esc((x.ports || []).join(', ') || '任意')}</b></span></div>`).join('') : '<div class="sheet-note">没有规则命中。</div>';
}
async function hookCreate() {
  openModal({ title: '新建 Webhook', okText: '创建', sub: '事件会 POST 到该地址。', body: `<div class="field"><label class="label">回调地址（https://）</label><input class="input" id="m-url" placeholder="https://example.com/hooks/tailscale"/></div>
    <div class="checkboxes"><label class="check"><input type="checkbox" data-sub value="nodeCreated" checked/> nodeCreated</label><label class="check"><input type="checkbox" data-sub value="nodeDeleted" checked/> nodeDeleted</label><label class="check"><input type="checkbox" data-sub value="nodeNeedsApproval" checked/> nodeNeedsApproval</label><label class="check"><input type="checkbox" data-sub value="nodeKeyExpiry" checked/> nodeKeyExpiry</label></div>`,
    onOk: async () => {
      const url = ($('#m-url') || {}).value.trim(); if (!url) { toast('先填写回调地址', 'err'); return false; }
      const subs = $$('input[data-sub]:checked').map((x) => x.value);
      const res = await api('/api/webhooks', { method: 'POST', body: { endpointUrl: url, subscriptions: subs } });
      const secret = (res && res.webhook && res.webhook.secret) || (res && res.secret) || '';
      toast(secret ? '已创建（签名密钥只显示一次）' : '已创建 Webhook');
      state.webhooks = null; loadWebhooks(true); return true;
    } });
}
async function hookDelete(id, url) {
  const ok = await confirmDialog({ title: '删除 Webhook？', message: `删除后事件不再推送到 ${url || '该地址'}。`, okText: '删除', tone: 'danger' });
  if (!ok) return;
  await api(`/api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('已删除'); state.webhooks = null; loadWebhooks(true);
}
async function exitOff() {
  const ok = await confirmDialog({ title: '关闭出口节点？', message: '流量回到本机网络。', okText: '关闭出口' });
  if (!ok) return;
  await api('/api/exit', { method: 'POST', body: { enabled: false } }); toast('已关闭出口'); refreshExit();
}
async function saveSettings() { credentialsView.act('credential-save'); } // 兼容旧按钮映射并统一使用验证后替换逻辑。

async function userRole(id, role) { await api('/api/users/role', { method: 'POST', body: { id, role } }); toast('角色已更新'); refreshData(true); }
async function delUser(id, name) {
  const ok = await confirmDialog({ title: '移除这个用户？', message: `被移除的成员（${name || id}）将失去访问权限。`, okText: '移除', tone: 'danger' });
  if (!ok) return;
  await api(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('已移除'); refreshData(true);
}
function exportCsv() {
  const list = filteredDevices();
  const head = ['hostname', 'ip', 'os', 'online', 'authorized', 'tags', 'keyExpires', 'lastSeen', 'id'];
  const rows = list.map((d) => [d.hostname || '', d.ipv4 || d.ipv6 || '', d.os || '', d.onlineKnown === null ? 'unknown' : d.online ? 'online' : 'offline', d.authorized ? 'yes' : 'no', (d.tags || []).join(' '), fmtDay(d.expires), fmtDay(d.lastSeen), d.id].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob(['\ufeff' + head.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tailscale-devices.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('已导出');
}

function diagnosticState() { return { status: state.status, data: state.data, nodes: nodeMonitor.snapshot(), relays: relayView.snapshot(), error: state.error }; } // 只向诊断模块提供必要运行快照。
async function openNotices() { // 打开提醒前刷新本机只读状态。
  await Promise.allSettled([nodeMonitor.load({ background: true }), relayView.load({ background: true })]); // 不因单个采集失败丢失其他提醒。
  const items = collectNotices(diagnosticState()); // 将离线、到期、未知和采集失败分开说明。
  openModal({ title: '提醒中心', sub: '提醒来自本机可见节点与当前已读取的密钥信息。', okText: '关闭', cancelText: '返回', body: items.length ? '<div class="notice-list">' + items.map((item) => '<button class="notice-item notice-' + item.tone + '" type="button" data-tab="' + item.tab + '"><strong>' + esc(item.title) + '</strong><span>' + esc(item.text) + '</span><small>查看详情 →</small></button>').join('') + '</div>' : '<div class="empty"><strong>暂时没有需要处理的提醒</strong><p>未读取到的远端数据不在此处推测。</p></div>' }); // 每条提醒都能直接进入对应功能。
} // 结束提醒中心。
async function exportDiagnostics() { // 导出当前真实节点与中继的排障报告。
  await Promise.allSettled([nodeMonitor.load({ background: true }), relayView.load({ background: true })]); // 导出前尽量更新只读快照。
  const report = buildDiagnosticReport(diagnosticState()), blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); // 严格白名单并隐藏令牌文本。
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'tailscale-diagnostics-' + new Date().toISOString().slice(0, 10) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 2000); toast('诊断报告已导出，不包含管理令牌或注册密钥'); // 仅在本机下载，不上传任何报告。
} // 结束报告导出。
/* 渲染 */
function render() {
  applyTheme();
  renderNav(); renderSideLocal(); renderConn(); // 刷新当前服务身份。
  const notices = collectNotices(diagnosticState()), noticeButton = $('#btn-notices'); if (noticeButton) noticeButton.textContent = '提醒' + (notices.length ? ' ' + notices.length : ''); // 顶部始终展示来自实际快照的提醒数量。
  const version = $('#side-ver'), mockFlag = $('#foot-mock'); if (version && state.status) version.textContent = `v${state.status.version}`; if (mockFlag) mockFlag.classList.toggle('hidden', !state.status?.mock); // 同步版本与演示标记，避免页面误导。
  const notice = $('#runtime-notice'), workspace = $('#workspace-name'); // 更新运行模式和网络名。
  if (workspace) workspace.textContent = state.data?.tailnet?.displayName || state.data?.tailnet?.name || '我的网络'; // 使用网络名称字段，避免把对象显示成文本。
  if (notice) { const mismatch = state.status && state.status.version !== '1.17.0'; notice.classList.toggle('hidden', !state.status?.mock && !mismatch); const realLink = realConsoleUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(realConsoleUrl) ? '<a href="' + esc(realConsoleUrl) + '/#nodes">新版真实管理台 ' + esc(new URL(realConsoleUrl).port) + '</a>' : '项目目录中的「启动.bat」'; notice.innerHTML = (state.status?.mock ? '当前是演示模式，节点为示例数据。查看自己的节点请打开 ' + realLink + '。' : '') + (mismatch ? ' 当前后端为 v' + esc(state.status.version) + '，界面为 v1.17.0。请双击「启动.bat」打开新版真实服务。' : ''); if (state.status?.mock) locateRealConsole(); } // 演示入口只指向经过健康检查的同版本真实服务。
  const focused = document.activeElement?.id, selection = document.activeElement?.selectionStart; // 自动刷新时保留搜索输入位置。
  const view = $('#view'); if (!view) return;
  const meta = TABS[state.tab] || TABS.overview;
  const tt = $('#page-title'), ss = $('#page-sub');
  if (tt) tt.textContent = meta.t; if (ss) ss.textContent = meta.s;
  let html = '';
  if (state.tab === 'settings') html = renderSettings();
  else if (state.tab === 'terminals') html = fleetView.render(); // 无管理凭证时也可管理本机可见终端。
  else if (state.tab === 'help') html = renderHelp();
  else if (state.tab === 'monitor') html = nodeMonitor.render(); // 节点页不依赖管理 API 或总览是否成功。
  else if (state.tab === 'nodes') html = renderNodes(); // 只读中继检测不受管理密钥错误阻塞。
  else if (state.tab === 'netcheck') html = renderNetcheck(); // 只读本机诊断在未配置 Key 时仍可使用。
  else if (state.tab === 'devices') html = renderDevices(); // 即使管理 API 失败也展示本机设备。
  else if (state.tab === 'keys') html = renderKeys(); // 管理 Key 缺失或过期时仍能打开替换入口。
  else if (state.loading && !state.data) html = skeleton();
  else if (state.error && !state.data) html = errorView();
  else if (state.tab === 'overview') html = renderOverview();
  else if (state.tab === 'devices') html = renderDevices();
  else if (state.tab === 'keys') html = renderKeys();
  else if (state.tab === 'users') html = renderUsers();
  else if (state.tab === 'dns') html = renderDns();
  else if (state.tab === 'acl') html = renderAcl();
  else if (state.tab === 'webhooks') html = renderWebhooks();
  else if (state.tab === 'speed') html = renderSpeed();
  else if (state.tab === 'audit') html = renderAudit();
  view.innerHTML = html; // 更新当前功能页面。
  if (['device-search', 'node-search', 'relay-search', 'fleet-search'].includes(focused)) { const input = document.getElementById(focused); input?.focus(); if (input && input.type !== 'search' && selection != null) input.setSelectionRange(selection, selection); } // 自动采集保持输入焦点。
  renderDrawer();
}

/* 事件 */
function onClick(ev) {
  const close = ev.target.closest('[data-close]');
  if (close) { if (close.dataset.close === 'modal') closeModal(); else if (close.dataset.close === 'drawer') closeDrawer(); return; }
  const okb = ev.target.closest('[data-modal-ok]');
  if (okb) { handleModalOk(okb); return; }
  const tab = ev.target.closest('[data-tab]');
  if (tab) { $('#nav .nav-more')?.removeAttribute('open'); switchTab(tab.dataset.tab); return; } // 选定页面后关闭更多菜单，避免覆盖新页面的操作按钮。
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, val = el.dataset.value;
  el.closest('.row-menu')?.removeAttribute('open'); // 操作选中后关闭设备菜单。
  if (fleetView.act(act, el)) { ev.preventDefault(); return; } // 终端任务按独立队列管理。
  if (credentialsView.act(act, el)) { ev.preventDefault(); return; } // 管理令牌动作由独立状态机处理。
  if (enrollmentView.act(act, el)) { ev.preventDefault(); return; } // 添加设备流程独立处理平台选择、复制和实际加入检查。
  if (remoteView.act(act, el)) { ev.preventDefault(); return; } // 远端操作使用独立目标确认和后台任务。
  if (relayView.act(act, el)) { ev.preventDefault(); return; } // 优先处理中继专属只读动作。
  if (nodeMonitor.act(act, el)) { ev.preventDefault(); return; } // 优先交给节点模块处理其专属动作。
  const map = {
    refresh: () => state.tab === 'monitor' ? nodeMonitor.load() : state.tab === 'nodes' ? loadNodes() : state.tab === 'netcheck' ? runNetcheck() : refreshData(), 'open-device': () => openDevice(id), closeDrawer: () => closeDrawer(), 'close-drawer': () => closeDrawer(), // 修复详情关闭按钮并按当前页面刷新。
    'theme-set': () => themePreference.set(el.dataset.value), 'notices-open': () => openNotices(), 'diagnostic-export': () => exportDiagnostics(), // 接入主题、提醒和诊断报告。
    'remote-setup': () => openRemoteSetup({os:el.dataset.os,esc,openModal,copyText,toast}), // 为所选设备生成远程配置命令。
    'remote-help': () => openModal({ title: '配置一次，即可使用 SSH 运维', sub: 'OAuth 管理授权不包含操作系统登录账号或密码。', body: '<ol class="auth-guide-steps"><li>普通 SSH：在目标设备开启 SSH 服务，使用该设备上真实存在的账号，并配置 SSH 密钥或可用的 SSH 代理；将账号填入设备详情。</li><li>支持 Tailscale SSH 的 Linux 设备可在目标终端执行下方命令，并在网络策略中授权当前身份连接该设备及目标用户。Windows 不提供 Tailscale SSH 服务端。</li><li>回本机终端执行详情中复制的连接命令，核对主机指纹并验证能登录，然后在后台读取系统、检查版本与执行升级。</li></ol><pre class="remote-output"># 在支持此功能的目标 Linux 设备上启用 Tailscale SSH。\nsudo tailscale set --ssh</pre><button class="btn btn-sm" type="button" data-act="copy" data-text="sudo tailscale set --ssh">复制启用命令</button><p class="sheet-note">这只启用服务，不替你创建系统用户或修改 SSH 访问策略。本后台不会猜测、下载或破解设备密码；NAS、容器或受限安装环境请先核对支持情况。</p>', okText: '知道了', cancelText: '关闭' }), // 提供明确的一次准备步骤，不自动改动目标主机。
    'add-device': () => addDevice(), 'open-local-device': () => openLocalDevice(id), // 提供添加设备与本机只读详情。
    'speed-run': () => runSpeed(), 'exit-refresh': () => refreshExit(), 'exit-off': () => exitOff(),
    'netcheck-run': () => runNetcheck(), 'nodes-run': () => loadNodes(), 'audit-refresh': () => loadAudit(true),
    'dns-refresh': () => loadDns(true), 'dns-ns-add': () => dnsAdd('ns'), 'dns-sp-add': () => dnsAdd('sp'),
    'dns-ns-del': () => dnsDel('ns', val), 'dns-sp-del': () => dnsDel('sp', val), 'magic-toggle': () => magicToggle(el.dataset.on === '1'),
    'acl-reload': () => { state.acl = null; loadAcl(true); }, 'acl-validate': () => aclValidate(), 'acl-save': () => aclSave(), 'acl-preview': () => aclPreview(),
    'webhook-create': () => hookCreate(), 'webhook-del': () => hookDelete(id, el.dataset.url), 'webhook-refresh': () => loadWebhooks(true),
    'key-guide': () => openAuthGuide({ openModal, esc }), 'key-create': () => createKey(), 'key-revoke': () => revokeKey(id, el.dataset.desc), 'key-filter': () => { state.keyFilter = el.dataset.kf; render(); }, // 从密钥页直接查看不同系统的登录步骤。
    filter: () => { state.filter = el.dataset.filter; render(); }, 'export-csv': () => exportCsv(), copy: () => copyText(el.dataset.text || ''),
    'batch-toggle': () => { state.batchMode = !state.batchMode; state.selected.clear(); render(); },
    'batch-all': () => { filteredDevices().forEach((x) => state.selected.add(x.id)); render(); },
    'batch-clear': () => { state.selected.clear(); render(); },
    'sel-device': () => { if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); render(); },
    'save-routes': () => saveRoutes(), 'device-authorize': () => deviceAction('authorize', id, { authorized: el.dataset.next === '1' }),
    'device-rename': async () => { const dev = (state.data.devices || []).find((x) => x.id === id) || {}; const v = await promptDialog({ title: '重命名设备', label: '新设备名', value: dev.hostname || '' }); if (v) { await deviceAction('rename', id, { name: v.trim() }); toast('已重命名'); } },
    'device-tags': async () => { const dev = (state.data.devices || []).find((x) => x.id === id) || {}; const v = await promptDialog({ title: '编辑标签', label: '标签（逗号分隔）', value: (dev.tags || []).join(', '), hint: '留空清空；自动补 tag: 前缀。' }); if (v != null) { await deviceAction('tags', id, { tags: String(v).split(/[,\s]+/).filter(Boolean) }); toast('标签已更新'); } },
    'device-key-expiry': () => setKeyExpiry(el.dataset.next === '1'), 'copy-advertise': () => copyAdvertise(),
    'device-expire': async () => { const ok = await confirmDialog({ title: '过期设备密钥', message: `「${el.dataset.name || id}」会立即断开，必须重新登录 Tailscale 才能恢复。`, okText: '过期密钥', tone: 'danger' }); if (!ok) return; await api('/api/device/action', { method: 'POST', body: { action: 'expire', id } }); toast('已过期'); refreshData(true); openDevice(id); },
    'device-delete': async () => { const ok = await confirmDialog({ title: '删除设备', message: `从 tailnet 删除 ${el.dataset.name || id}，不可撤销。`, okText: '删除', tone: 'danger' }); if (!ok) return; await deviceAction('delete', id); closeDrawer(); toast('已删除'); },
    'user-role': () => userRole(id, el.value), 'user-del': () => delUser(id, el.dataset.name),
    'settings-save': () => saveSettings(), 'settings-refresh': () => loadSettings(true), 'toggle-token': () => { const i = $('#set-token'); if (i) i.type = i.type === 'password' ? 'text' : 'password'; },
    'policy-toggle': async () => { const field = el.dataset.field; const on = el.dataset.on === '1'; await api('/api/tailnet-settings', { method: 'POST', body: { [field]: !on } }); toast('已更新'); state.settings = null; loadSettings(true); },
    'serve-refresh': () => loadServe(true),
    'serve-on': async () => { const t = (($('#serve-target') || {}).value || '').trim(); if (!t) return toast('先填写目标地址', 'err'); await api('/api/serve', { method: 'POST', body: { action: 'on', target: t } }); toast('Serve 已开启'); loadServe(true); },
    'serve-off': async () => { const ok = await confirmDialog({ title: '关闭 Serve？', message: '会移除本机所有 serve 配置，外部链接立即失效。', okText: '关闭' }); if (!ok) return; await api('/api/serve', { method: 'POST', body: { action: 'off' } }); toast('已关闭'); loadServe(true); },
  };
  if (map[act]) { ev.preventDefault(); Promise.resolve(map[act]()).catch((e) => toast(e.message || String(e), 'err')); }
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  const initialTab = location.hash.slice(1); if (TABS[initialTab]) switchTab(initialTab); // 恢复地址栏指定的页面。
  const tb = $('#btn-theme'); if (tb) tb.addEventListener('click', () => themePreference.toggle()); // 主题切换不重绘表单，避免丢失候选令牌。
  const rb = $('#btn-refresh'); if (rb) rb.addEventListener('click', () => { if (state.tab === 'monitor') nodeMonitor.load(); else if (state.tab === 'nodes') loadNodes(); else if (state.tab === 'netcheck') runNetcheck(); else refreshData(); }); // 顶栏刷新针对当前页面生效。
  document.body.addEventListener('click', onClick);
  document.body.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el) fleetView.input(el); // 保存终端选择与显式上传的脚本／回执。
    if (el) credentialsView.input(el); // 候选令牌只保存在当前页面内存中。
    if (el) enrollmentView.input(el); // 保留新设备配置草稿并按用途更新表单。
    if (el) remoteView.input(el); // 保存远程连接草稿，不把账号切换到其他设备。
    if (el) relayView.input(el); // 中继搜索只更新表格内容。
    if (el) nodeMonitor.input(el); // 为节点搜索提供不丢失输入焦点的实时筛选。
    if (el && el.id === 'device-search') {
      state.query = el.value;
      const body = $('#device-rows'), count = $('#device-count'); // 只更新列表，保留输入光标。
      if (body) body.innerHTML = deviceRows(); // 让搜索结果与官方表格保持一致。
      if (count) count.textContent = filteredDevices().length; // 同步实际筛选结果数。
    }
    if (el && el.id === 'glossary-search') { state.glossaryQuery = el.value; render(); const gi = $('#glossary-search'); if (gi) gi.focus(); }
    if (el && el.id === 'acl-editor') { state.aclDraft = el.value; }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeModal(); closeDrawer(); } if (ev.key === 'Tab' && $('#modal-root.open')) { const focusable = [...$('#modal-root').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea,summary,a[href]')].filter(element => element.getClientRects().length), first = focusable[0], last = focusable.at(-1); if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); } } }); // 键盘焦点限制在可见弹窗内，关闭仍清理一次性密钥。
  if (!initialTab || !TABS[initialTab]) nodeMonitor.load(); // 默认设备页立即读取真实节点。
  refreshData();
  setInterval(() => { if (state.tab === 'overview' || state.tab === 'devices') refreshData(true); }, 90000);
});
