export function keyDescription(value, hostname = '') { // 前后端共用兼容的密钥备注规则，避免中文默认文案进入官方 API。
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); }; // 后端返回可理解的输入错误而不是服务故障。
  if (value != null && typeof value !== 'string') fail('密钥备注必须是文本。'); // 不把数组或对象隐式转换成用途备注。
  const description = (value || '').trim() || String(hostname).slice(0, 50); // 未填写备注时使用设备名，兼容最长 63 位的设备名。
  if (description.length > 50) fail('密钥备注最多 50 个字符；可以留空，自动使用设备名。'); // 不悄悄截断用户输入的自定义备注。
  if (!/^[A-Za-z0-9 ._-]*$/.test(description)) fail('密钥备注请使用英文字母、数字、空格、点、下划线或短横线，不要填写中文、表情或其他符号；留空即可自动使用设备名。'); // 使用明确的保守字符集，提前阻止已观察到的上游拒绝。
  return description; // 返回可直接提交的备注；独立 API 允许省略备注。
} // 结束统一备注处理。
