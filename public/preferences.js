export function createThemePreference({ icons, onChange = () => {} }) { // 为所有页面提供清楚且一致的主题入口。
  const allowed = ['light', 'dark', 'system'], media = matchMedia('(prefers-color-scheme: dark)'); // 同时支持手动和系统主题。
  let stored = 'light'; try { stored = localStorage.getItem('ts-admin-theme') || 'light'; } catch {} // 浏览器禁止存储时仍可临时使用主题。
  let mode = allowed.includes(stored) ? stored : 'light'; // 忽略未知或损坏的历史值。
  const resolved = () => mode === 'system' ? media.matches ? 'dark' : 'light' : mode; // 将系统偏好解析成实际样式。
  function apply() { // 应用主题同时更新按钮可访问性。
    const theme = resolved(), button = document.querySelector('#btn-theme'); document.documentElement.dataset.theme = theme; // 在同一个根属性上切换整站样式。
    if (button) { button.innerHTML = `${theme === 'dark' ? icons.dark : icons.light}<span>${theme === 'dark' ? '深色' : '浅色'}</span>`; button.title = `当前${theme === 'dark' ? '深色' : '浅色'}，点击切换${theme === 'dark' ? '浅色' : '深色'}`; button.setAttribute('aria-label', button.title); } // 为原来只有图标的按钮增加文字。
    document.querySelectorAll('[data-act="theme-set"]').forEach((item) => { const selected = item.dataset.value === mode; item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected)); }); // 同步设置页三种主题选项。
  } // 结束主题应用。
  function set(next) { if (!allowed.includes(next)) return; mode = next; try { localStorage.setItem('ts-admin-theme', mode); } catch {} apply(); onChange(mode); } // 即时切换但不重绘表单，以保留尚未提交的输入。
  media.addEventListener('change', () => { if (mode === 'system') apply(); }); // 跟随系统时响应系统主题改变。
  const render = () => `<section class="panel preference-panel"><div class="panel-head"><div><div class="panel-title">外观主题</div><div class="panel-sub">立即生效并记住本浏览器的选择。</div></div></div><div class="panel-body theme-options">${[['light', '浅色', '白色画布与蓝色操作'], ['dark', '深色', '深灰画布与柔和文字'], ['system', '跟随系统', '随系统自动切换']].map(([value, title, note]) => `<button class="theme-option${mode === value ? ' active' : ''}" type="button" data-act="theme-set" data-value="${value}" aria-pressed="${mode === value}"><span class="theme-preview preview-${value}"><i></i><i></i><i></i></span><strong>${title}</strong><small>${note}</small></button>`).join('')}</div></section>`; // 用可辨识的预览展示三种选择。
  return { apply, set, toggle: () => set(resolved() === 'dark' ? 'light' : 'dark'), render }; // 对主应用暴露最小主题接口。
} // 结束主题偏好模块。
