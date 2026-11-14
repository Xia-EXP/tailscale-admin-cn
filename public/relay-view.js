export function createRelayView({ api, esc, icons, fmtDate, fmtBytes, redraw, isVisible }) { // 将自建中继的采集与展示集中管理。
  const model = { data: null, error: null, running: '', filter: 'custom', query: '', selected: null }; // 默认优先查看自建节点，而不是淹没在官方区域中。
  const pill = (text, tone = 'muted') => `<span class="pill pill-${tone}"><i class="dot"></i>${esc(text)}</span>`; // 统一转义状态文字。
  const regions = () => model.data?.regions || []; // 为未采集情况提供空数组。
  function visibleRegions() { // 根据类型和搜索词筛选中继。
    const query = model.query.trim().toLowerCase(); // 忽略前后空格与大小写。
    return regions().filter((region) => (model.filter !== 'custom' || region.custom) && (model.filter !== 'official' || !region.custom) && (!query || [region.name, region.code, region.id, ...region.nodes.map((node) => `${node.hostname}:${node.port}`)].join(' ').toLowerCase().includes(query))); // 同时支持区域代码、编号和域名搜索。
  } // 结束中继筛选。
  function rows() { // 输出实际采集到的区域，任何类型都不根据名称猜测。
    return visibleRegions().map((region) => `<tr class="relay-row${model.selected === region.code ? ' selected-row' : ''}"><td><button class="relay-name" type="button" data-act="relay-inspect" data-id="${esc(region.code)}"><strong>${esc(region.name)}</strong><small>${esc(region.code)} · 区域 ${region.id}</small></button></td><td>${pill(region.custom ? '自建' : '官方', region.custom ? 'accent' : 'muted')}</td><td>${region.nodes.map((node) => `<button class="address-copy" type="button" data-act="copy" data-text="${esc((node.hostname || node.ipv4 || node.ipv6 || '未知主机') + ':' + node.port)}">${esc(node.hostname || node.ipv4 || node.ipv6 || '未知主机')}<span class="port">:${node.port}</span>${icons.copy}</button>`).join('')}</td><td>${region.loaded ? pill('本机已加载', 'ok') : pill('仅策略配置', 'warn')}${region.home ? '<small class="cell-sub">本机当前首选</small>' : ''}</td><td>${region.latencyMs == null ? '<span class="muted">未检测</span>' : `<strong class="latency-value">${region.latencyMs.toFixed(1)}<small> ms</small></strong>`}</td><td>${region.usedBy.length ? `<span>${region.usedBy.length} 台</span><small class="cell-sub">${esc(region.usedBy.join('、'))}</small>` : '<span class="muted">暂无首选关联</span>'}</td><td><button class="icon-btn" type="button" data-act="relay-inspect" data-id="${esc(region.code)}" aria-label="查看 ${esc(region.name)} 中继详情">${icons.arrow}</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty"><strong>没有匹配的中继区域</strong><p>可切换到“全部”查看本机映射，或核对网络策略中的 DERP 配置。</p></div></td></tr>'; // 没有匹配结果时明确下一步。
  } // 结束区域表格生成。
  function detail() { // 展示中继主机的实际配置细节。
    const region = regions().find((item) => item.code === model.selected); // 从当前快照获取选中区域。
    if (!region) return ''; // 未选择区域时不展示详情。
    return `<section class="panel relay-detail"><div class="panel-head"><div><div class="panel-title">${esc(region.name)} <span class="heading-tag">${esc(region.code)} / ${region.id}</span></div><div class="panel-sub">${esc(region.customReason)} · ${region.loaded ? '已进入本机 DERP 映射' : '尚未进入本机映射'}</div></div><button class="icon-btn" type="button" data-act="relay-close" aria-label="关闭中继详情">✕</button></div><div class="panel-body"><div class="table-wrap"><table class="table"><thead><tr><th>节点名称</th><th>主机</th><th>DERP 端口</th><th>STUN 端口</th><th>IPv4 / IPv6</th></tr></thead><tbody>${region.nodes.map((node) => `<tr><td>${esc(node.name || '未提供')}</td><td>${esc(node.hostname || '未提供')}${node.certName ? `<small class="cell-sub">证书名 ${esc(node.certName)}</small>` : ''}</td><td>${node.stunOnly ? '仅 STUN' : node.port}</td><td>${node.stunPort ?? '已禁用'}</td><td class="mono">${esc([node.ipv4, node.ipv6].filter(Boolean).join(' / ') || '未指定，使用域名解析')}</td></tr>`).join('')}</tbody></table></div><div class="relay-detail-notes"><p><strong>首选关联设备：</strong>${esc(region.usedBy.join('、') || '暂无')}</p><p><strong>活动中继连接：</strong>${esc((region.activeBy || []).join('、') || '当前未观察到活动中继连接')}</p><p><strong>配置来源：</strong>${region.source === 'both' ? '本机映射与网络策略均存在' : region.source === 'client' ? '本机客户端实际加载的 DERP 映射' : '仅在网络策略中配置，本机尚未加载'}</p></div><p class="sheet-note">“已加载”说明客户端知道这个中继；“首选”不代表所有流量都经过它。检测延迟可确认本机是否获得区域探测响应，不能替代远端主机的系统监控。</p></div></section>`; // 将加载、首选、活动和可探测性分开解释。
  } // 结束中继详情。
  function render() { // 使用与官方设备页一致的表格布局。
    const data = model.data; // 保留上一次成功映射直到新采集完成。
    const head = `<div class="page-head official-page-head"><div><h2>中继节点</h2><p>查看官方与自建 DERP 中继，核对实际加载的节点信息。</p></div><div class="toolbar"><button class="btn btn-sm" type="button" data-act="relay-policy" ${model.running ? 'disabled' : ''}>核对网络策略</button><button class="btn btn-sm" type="button" data-act="relay-refresh" ${model.running ? 'disabled' : ''}>${icons.refresh} 刷新映射</button><button class="btn btn-sm btn-primary" type="button" data-act="relay-probe" ${model.running ? 'disabled' : ''}>${icons.activity} ${model.running === 'probe' ? '正在检测…' : '检测延迟'}</button></div></div>`; // 将快速刷新与较慢的网络探测分开。
    const error = model.error ? `<div class="callout callout-warn">${esc(model.error)}${data ? '。下方保留上次快照。' : ''}</div>` : ''; // 出错时标记旧数据而不是静默显示。
    if (!data) return head + error + `<div class="empty"><span class="empty-ico">${icons.server}</span><strong>${model.running ? '正在读取本机 DERP 映射…' : '等待采集'}</strong><p>从真实客户端读取，不需要管理 API Key。</p></div>`; // 首次读取不等待 netcheck。
    const customs = regions().filter((region) => region.custom); // 获取确认属于规则识别的自建区域。
    const tabs = [['custom', '自建中继', customs.length], ['all', '全部区域', regions().length], ['official', '官方中继', regions().length - customs.length]].map(([value, text, count]) => `<button class="seg${model.filter === value ? ' active' : ''}" type="button" data-act="relay-filter" data-value="${value}">${text}<span>${count}</span></button>`).join(''); // 为自建中继提供显眼的独立入口。
    const discovery = customs.length ? `<div class="relay-discovery"><span class="discovery-check">✓</span><div><strong>已发现 ${customs.length} 个自建 DERP 区域</strong><p>${customs.map((region) => `${esc(region.code)} · ${esc(region.nodes.map((node) => `${node.hostname || node.ipv4 || '未指定'}:${node.port}`).join('、'))}`).join('　 /　 ')}</p></div><span class="pill ${data.mock ? 'pill-warn' : 'pill-ok'}">${data.mock ? '演示数据' : '真实客户端映射'}</span></div>` : '<div class="callout callout-warn">本机映射中未识别到自建中继。可先核对网络策略，确认自建区域是否已经下发到这个客户端。</div>'; // 直接列出真实主机，避免只显示一个难以辨认的代码。
    const notices = (data.warnings || []).map((warning) => `<div class="callout callout-warn">${esc(warning)}</div>`).join(''); // 保留每一个独立采集维度的错误。
    return head + error + notices + discovery + `<div class="relay-summary"><span>本机：<strong>${esc(data.hostname || '未检测到')}</strong></span><span>已加载 ${data.loadedCount ?? regions().filter((region) => region.loaded).length} 个区域</span><span>当前首选：<strong>${esc(data.selfRelay || '未知')}</strong></span><span>${data.latencyAt ? '延迟检测于 ' + esc(fmtDate(data.latencyAt)) : '尚未检测区域延迟'}</span></div><div class="official-filter-bar"><label class="search-wrap">${icons.search}<input class="input" id="relay-search" type="search" aria-label="搜索中继区域" placeholder="搜索区域、域名或节点编号…" value="${esc(model.query)}"></label><div class="segmented">${tabs}</div></div><div class="count-label">${visibleRegions().length} 个区域 <span>· ${esc(fmtDate(data.observedAt))} 采集</span></div><div class="table-wrap official-table-wrap"><table class="table relay-table"><thead><tr><th>区域</th><th>类型</th><th>节点主机</th><th>加载情况</th><th>区域延迟</th><th>首选关联设备</th><th><span class="sr-only">详情</span></th></tr></thead><tbody id="relay-rows">${rows()}</tbody></table></div><div id="relay-detail">${detail()}</div><p class="table-note">自建 DERP 可独立于设备列表存在。设备／出口节点请在 <button class="text-button" type="button" data-tab="devices">设备</button> 中查看；实际连接与累计流量请在 <button class="text-button" type="button" data-tab="monitor">节点信息</button> 中查看。</p>`; // 解释两种节点的关系并提供直接入口。
  } // 结束中继页面。
  async function load({ probe = false, policy = false, background = false } = {}) { // 统一手动读取与自动刷新。
    if (model.running) return; // 防止对同一 CLI 发起重复工作。
    model.running = probe ? 'probe' : policy ? 'policy' : 'map'; // 记录当前操作类型。
    if (!background && isVisible()) redraw(); // 显示正在进行的操作但保留原列表。
    try { model.data = await api(`/api/nodes${probe ? '?probe=1' : policy ? '?policy=1' : ''}`, { timeout: probe ? 35000 : policy ? 30000 : 15000 }); model.error = null; } // 映射读取不等待延迟检测。
    catch (error) { model.error = error.name === 'AbortError' ? '中继采集超时，请重试' : error.message || '无法读取中继'; } // 显示可恢复的错误。
    finally { model.running = ''; } // 始终释放采集状态。
    if (isVisible()) redraw(); // 用户切到其他页面时不抢回视图。
  } // 结束采集入口。
  function act(action, element) { // 处理中继页的只读交互。
    if (action === 'relay-refresh') { load(); return true; } // 快速刷新实际映射。
    if (action === 'relay-probe') { load({ probe: true }); return true; } // 用户主动检测延迟。
    if (action === 'relay-policy') { load({ policy: true }); return true; } // 用户主动核对策略来源。
    if (action === 'relay-filter') { model.filter = element.dataset.value; redraw(); return true; } // 切换自建、全部与官方区域。
    if (action === 'relay-inspect' || action === 'relay-close') { model.selected = action === 'relay-close' ? null : element.dataset.id; redraw(); if (model.selected) document.querySelector('.relay-detail')?.scrollIntoView({ block: 'nearest' }); return true; } // 展示或关闭主机配置明细。
    return false; // 其他事件继续交给主应用。
  } // 结束中继按钮处理。
  function input(element) { // 只更新结果区，避免搜索时丢失输入光标。
    if (element.id !== 'relay-search') return; // 忽略其他页面输入。
    model.query = element.value; // 保留查询，刷新后仍使用相同条件。
    const body = document.querySelector('#relay-rows'); // 定位中继列表。
    if (body) body.innerHTML = rows(); // 即时应用本地过滤。
    const count = document.querySelector('.count-label'); if (count && model.data) count.innerHTML = `${visibleRegions().length} 个区域 <span>· ${esc(fmtDate(model.data.observedAt))} 采集</span>`; // 搜索时同步结果数量与采集时间。
  } // 结束中继搜索。
  return { render, load, act, input, snapshot: () => model.data }; // 为主应用和设备详情提供统一快照。
} // 结束中继页面模块。
