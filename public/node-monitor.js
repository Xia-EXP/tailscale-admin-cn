export function createNodeMonitor({ api, esc, icons, fmtBytes, fmtDate, timeAgo, redraw, isVisible }) { // 将节点页面封装为独立模块，复用管理台的基础能力。
  const model = { data: null, error: null, running: false, query: '', filter: 'all', selected: null, auto: true }; // 保存节点页面自己的交互状态。
  const labels = { self: ['本机', 'accent'], direct: ['直连', 'ok'], derp: ['DERP 中继', 'warn'], 'peer-relay': ['对等中继', 'warn'], idle: ['空闲', 'muted'], offline: ['离线', 'muted'], unknown: ['待确认', 'info'] }; // 保持连接标签与颜色一致。
  const badge = (text, tone = 'muted') => `<span class="pill pill-${tone}"><i class="dot"></i>${esc(text)}</span>`; // 对所有动态徽标文本进行转义。
  const stateBadge = (peer) => peer.online === true ? badge('在线', 'ok') : peer.online === false ? badge('离线') : badge('未知', 'info'); // 保留未知在线状态。
  const pathBadge = (peer) => badge(...(labels[peer.connection] || labels.unknown)); // 将原始分类映射为中文。
  const metric = (label, value, note, icon, tone = '') => `<div class="kpi ${tone}"><div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-ico">${icons[icon] || icons.activity}</span></div><div class="kpi-value">${value}</div><div class="kpi-sub">${note}</div></div>`; // 生成统一统计卡片。
  const byteText = (value) => value == null ? '未提供' : fmtBytes(value); // 缺失流量不会显示为零。
  const pair = (key, value) => `<div class="kv"><span class="kv-k">${key}</span><span class="kv-v">${value}</span></div>`; // 生成详情的键值行。
  const allPeers = () => model.data ? [model.data.self, ...(model.data.peers || [])].filter(Boolean) : []; // 将本机加入可搜索列表。
  function filtered() { // 按文本与明确状态筛选节点。
    const query = model.query.trim().toLowerCase(); // 忽略查询大小写与前后空格。
    return allPeers().filter((peer) => { // 仅筛选内存快照，不触发网络写操作。
      if (model.filter === 'online' && peer.online !== true) return false; // 只保留确认在线的节点。
      if (model.filter === 'offline' && peer.online !== false) return false; // 只保留确认离线的节点。
      if (model.filter === 'unknown' && peer.online !== null) return false; // 单独检查在线未知的节点。
      if (model.filter === 'direct' && peer.connection !== 'direct') return false; // 筛选正在直连的节点。
      if (model.filter === 'relay' && !['derp', 'peer-relay'].includes(peer.connection)) return false; // 筛选有活动中继证据的节点。
      return !query || [peer.hostname, peer.dnsName, peer.os, peer.relay, ...peer.ips].join(' ').toLowerCase().includes(query); // 搜索名称、地址、系统与区域。
    }); // 返回匹配的节点。
  } // 结束筛选。
  function rows() { // 输出可通过键盘操作的详情入口。
    return filtered().map((peer) => `<tr class="node-row${peer.id === model.selected ? ' node-selected' : ''}"><td><button class="node-name" type="button" data-act="node-inspect" data-id="${esc(peer.id)}"><span class="node-avatar">${icons[peer.self ? 'devices' : 'server']}</span><span><strong>${esc(peer.hostname)}</strong><small class="node-os">${esc(peer.os || '未知系统')}${peer.self ? ' · 本机' : ''}${peer.exitNode ? ' · 当前出口' : peer.exitNodeOption ? ' · 出口候选' : ''}</small><small class="node-mobile-ip mono">${esc(peer.ips[0] || '—')}</small></span></button></td><td><span class="mono">${esc(peer.ips[0] || '—')}</span></td><td>${stateBadge(peer)}</td><td>${pathBadge(peer)}</td><td class="mono">${byteText(peer.rxBytes)}</td><td class="mono">${byteText(peer.txBytes)}</td><td class="muted">${peer.online === true ? '当前在线' : peer.lastSeen ? esc(timeAgo(peer.lastSeen)) : '未提供'}</td><td><button class="icon-btn" type="button" data-act="node-inspect" data-id="${esc(peer.id)}" aria-label="查看 ${esc(peer.hostname)} 的节点详情">${icons.arrow}</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty"><span class="empty-ico">⌕</span><strong>没有匹配的节点</strong><p>试试其他名称、IP 或筛选条件。</p></div></td></tr>'; // 同时准备手机地址行，并对空列表提供说明。
  } // 结束表格生成。
  function detail() { // 展示选中节点的只读技术信息。
    const peer = allPeers().find((item) => item.id === model.selected); // 使用当前快照查找节点，避免旧详情残留。
    if (!peer) return ''; // 未选择节点时不占用详情空间。
    const addressButtons = peer.ips.map((ip) => `<button class="btn btn-sm mono" type="button" data-act="copy" data-text="${esc(ip)}">${esc(ip)} ${icons.copy}</button>`).join(''); // 每个地址均可独立复制。
    return `<section class="panel node-detail"><div class="panel-head"><div><div class="panel-title">${icons.server} ${esc(peer.hostname)}</div><div class="panel-sub">当前采集快照 · ${esc(fmtDate(model.data.observedAt))}</div></div><button class="icon-btn" type="button" data-act="node-close" aria-label="关闭节点详情">✕</button></div><div class="panel-body"><div class="node-detail-grid"><div>${pair('在线状态', stateBadge(peer))}${pair('连接方式', pathBadge(peer))}${pair('操作系统', esc(peer.os || '未提供'))}${pair('MagicDNS', `<span class="mono">${esc(peer.dnsName || '未提供')}</span>`)}</div><div>${pair('当前端点', `<span class="mono">${esc(peer.self || !['direct', 'derp', 'peer-relay'].includes(peer.connection) ? '无活动连接' : peer.endpoint || '未提供')}</span>`) }${pair('首选 DERP', `<span class="mono">${esc(peer.relay || '未提供')}</span>`)}${pair('最近握手', esc(fmtDate(peer.lastHandshake)))}${pair('最近在线', peer.online === true ? '当前在线' : esc(fmtDate(peer.lastSeen)))}</div><div>${pair('累计接收', byteText(peer.rxBytes))}${pair('累计发送', byteText(peer.txBytes))}${pair('出口角色', peer.exitNode ? '本机正在使用' : peer.exitNodeOption ? '出口候选' : '普通节点')}${pair('创建时间', esc(fmtDate(peer.created)))}</div></div><div class="actions">${addressButtons}</div><p class="sheet-note">收发流量是本机与该节点之间的累计值，客户端重启后可能重置；首选 DERP 区域不等同于当前连接路径。这里不采集远端 CPU、内存或磁盘。</p></div></section>`; // 解释指标范围，避免把连接字节当作远端主机监控。
  } // 结束详情生成。
  function render() { // 生成监控页的全部内容。
    const data = model.data, summary = data && data.summary; // 读取最近成功的快照。
    const head = `<div class="page-head"><div><h2>节点信息<span class="heading-tag">只读</span></h2><p>查看本机可见设备、服务器与出口节点的实际连接情况。</p></div><div class="toolbar"><button class="btn btn-sm" type="button" data-act="diagnostic-export">${icons.download} 导出诊断报告</button><button class="btn btn-sm btn-ghost" type="button" data-act="node-auto" aria-pressed="${model.auto}">${icons.clock} 自动刷新${model.auto ? ' · 15 秒' : '已暂停'}</button><button class="btn btn-sm btn-primary" type="button" data-act="node-refresh" ${model.running ? 'disabled' : ''}>${icons.refresh} ${model.running ? '采集中…' : '刷新状态'}</button></div></div>`; // 提供节点状态刷新、自动采集与脱敏诊断报告导出。
    const failure = model.error ? `<div class="callout callout-warn node-notice">本次采集失败：${esc(model.error)}${data ? '。下方保留上一次成功的快照，请留意采集时间。' : '。请点击刷新状态重试。'}</div>` : ''; // 失败时明确标记旧数据。
    if (!data) return head + failure + `<section class="panel"><div class="empty"><span class="empty-ico">${icons.activity}</span><strong>${model.running ? '正在采集节点状态' : '等待采集'}</strong><p>只读取本机客户端，无需管理 API Key。</p></div></section>`; // 展示首次采集中的状态。
    if (!data.available) return head + failure + `<section class="panel"><div class="empty"><span class="empty-ico">${icons.devices}</span><strong>暂时无法读取本机节点</strong><p>${esc(data.message || '请打开 Tailscale 客户端并登录后重新采集。')}</p><div class="actions"><button class="btn btn-primary" type="button" data-act="node-refresh">重新采集</button></div></div></section>`; // 客户端不可用时不给出虚构统计。
    const self = data.self, peers = data.peers || [], online = summary ? summary.online : 0; // 使用采集器明确计算的统计。
    const counts = { all: allPeers().length, online: allPeers().filter((p) => p.online === true).length, offline: allPeers().filter((p) => p.online === false).length, unknown: allPeers().filter((p) => p.online === null).length, direct: summary.direct, relay: summary.relayed }; // 为筛选按钮显示对应数量。
    const filters = [['all', '全部'], ['online', '在线'], ['offline', '离线'], ['unknown', '未知'], ['direct', '直连'], ['relay', '中继']].map(([key, label]) => `<button class="seg${model.filter === key ? ' active' : ''}" type="button" data-act="node-filter" data-value="${key}" aria-pressed="${model.filter === key}">${label}<span>${counts[key]}</span></button>`).join(''); // 让筛选结果可预期。
    const health = (data.health || []).map((message) => `<div class="callout callout-warn node-notice">${esc(message)}</div>`).join(''); // 展示原始健康提示并转义文本。
    return head + failure + health + `<section class="node-local-strip"><span class="node-local-symbol">${icons.activity}</span><div class="grow"><strong>${esc(self.hostname)}</strong><span class="node-local-meta">${esc(self.ips[0] || '无节点地址')}<i>·</i>${esc(data.backendState)}<i>·</i>${esc(data.version || '版本未知')}</span></div>${badge(data.mock ? '演示数据' : '本机实时采集', data.mock ? 'warn' : 'ok')}<span class="node-updated">采集于 ${esc(fmtDate(data.observedAt))}</span></section><div class="kpi-grid node-kpis">${metric('可见对等节点', peers.length, '不含本机 · 以本机可见范围为准', 'server')}${metric('在线对等节点', online, `离线 ${summary.offline} · 未知 ${summary.unknown}`, 'activity', 'tone-ok')}${metric('活动直连', summary.direct, '本机与节点直接建立连接', 'route')}${metric('活动中继', summary.relayed, `DERP / 对等中继 · 空闲 ${summary.idle}`, 'globe', 'tone-warn')}</div><section class="panel node-table-panel"><div class="panel-head"><div><div class="panel-title">节点状态<span class="heading-tag">${allPeers().length}</span></div><div class="panel-sub">点击节点查看地址、端点与握手详情</div></div><span class="live-label"><i class="dot"></i>${model.auto ? '自动采集' : '手动采集'}</span></div><div class="node-tools"><label class="search-wrap">${icons.search}<input class="input" id="node-search" type="search" aria-label="搜索节点" placeholder="搜索节点名称、IP、系统…" value="${esc(model.query)}" autocomplete="off"></label><div class="segmented">${filters}</div></div><div class="table-wrap"><table class="table node-table"><thead><tr><th>节点名称</th><th>Tailscale IP</th><th>在线状态</th><th>连接方式</th><th>↓ 累计接收</th><th>↑ 累计发送</th><th>最近在线</th><th><span class="sr-only">详情</span></th></tr></thead><tbody id="node-rows">${rows()}</tbody></table></div></section><div id="node-detail">${detail()}</div><div class="node-legend"><span>${badge('直连', 'ok')} 当前活动路径有远端地址</span><span>${badge('空闲')} 在线但没有活动连接</span><span>${badge('待确认', 'info')} 客户端未提供完整路径证据</span></div><p class="monitor-foot">${icons.shield} 只读查看 · 不修改路由或出口设置 · 采集范围受本机网络可见性限制</p>`; // 汇总监控页并说明各类状态。
  } // 结束监控页渲染。
  async function load({ background = false } = {}) { // 手动与自动刷新共享同一个采集入口。
    if (model.running) return; // 防止重复请求。
    model.running = true; // 锁定当前采集。
    if (!background && isVisible()) redraw(); // 手动操作立即显示忙碌状态。
    try { // 保留上次成功快照直到新快照到达。
      model.data = await api('/api/node-status', { timeout: 12000 }); // 请求独立于管理 API 的只读端点。
      model.error = null; // 成功后清除旧错误。
    } catch (error) { model.error = error.name === 'AbortError' ? '采集超时' : error.message || '无法连接本地服务'; } // 为超时和网络错误提供中文提示。
    finally { model.running = false; } // 始终解除忙碌状态。
    if (isVisible()) { // 仅更新仍然打开的节点页面。
      const input = document.activeElement; // 记录搜索焦点以免自动刷新打断输入。
      const focused = input && input.id === 'node-search'; // 判断用户是否正在搜索。
      redraw(); // 通过原有渲染入口更新页面。
      if (focused) document.querySelector('#node-search')?.focus(); // 恢复搜索框焦点。
    } // 结束页面更新。
  } // 结束采集入口。
  function act(action, element) { // 处理监控页专属按钮。
    if (action === 'node-refresh') { load(); return true; } // 手动刷新。
    if (action === 'node-auto') { model.auto = !model.auto; redraw(); return true; } // 切换自动采集。
    if (action === 'node-filter') { model.filter = element.dataset.value; redraw(); return true; } // 切换筛选项。
    if (action === 'node-inspect' || action === 'node-close') { // 打开或关闭内嵌详情。
      model.selected = action === 'node-close' ? null : element.dataset.id; // 更新当前选中的节点。
      redraw(); // 同步选中行和详情内容。
      if (model.selected) document.querySelector('.node-detail')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' }); // 遵守减少动画设置并让详情可见。
      return true; // 标记已处理专属事件。
    } // 结束详情处理。
    return false; // 让原管理台继续处理其他动作。
  } // 结束动作分派。
  function input(element) { // 仅替换搜索结果，避免每输入一个字就丢失焦点。
    if (element.id !== 'node-search') return; // 忽略其他页面输入。
    model.query = element.value; // 保存查询供刷新后恢复。
    const body = document.querySelector('#node-rows'); // 定位节点结果区。
    if (body) body.innerHTML = rows(); // 立即应用本地搜索。
  } // 结束输入处理。
  setInterval(() => { if (model.auto && isVisible() && !document.hidden) load({ background: true }); }, 15000); // 仅前台节点页面自动采集，隐藏标签页暂停请求。
  return { render, load, act, input, snapshot: () => model.data, error: () => model.error }; // 让设备列表复用真实快照并标记采集失败后的旧数据。
} // 结束页面模块工厂。
