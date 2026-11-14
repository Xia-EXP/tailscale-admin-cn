export async function copyToClipboard(text) { // 在 HTTPS、localhost 和局域网 HTTP 页面统一复制纯文本。
  if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(String(text)); return; } catch { /* 浏览器拒绝现代剪贴板时继续尝试兼容方式。 */ } } // 首选浏览器原生异步接口。
  const focused = document.activeElement, area = document.createElement('textarea'); area.value = String(text); area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'; document.body.append(area); // 创建不含 HTML 的临时选择区，兼容普通 HTTP。
  try { area.focus(); area.select(); if (!document.execCommand('copy')) throw new Error('浏览器未允许复制，请选中命令手动复制。'); } finally { area.remove(); focused?.focus?.({ preventScroll: true }); } // 无论成败都移除包含密钥的临时元素并恢复焦点。
} // 结束统一复制。
export const writeClipboard = copyToClipboard; // 保留已有页面与局域网部署验证所使用的复制入口名称。
