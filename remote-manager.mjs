import { advancedActions, operationSpec } from './remote-operations.mjs'; // 接入经过校验的终端管理动作。
import { execFile } from 'node:child_process'; // 通过参数数组启动 SSH，不拼接本机 shell。
import { isIP } from 'node:net'; // 严格确认连接目标属于 Tailscale 地址空间。
import path from 'node:path'; // 校验本机 SSH 私钥文件的绝对路径。
import fs from 'node:fs'; // 仅检查私钥文件存在，不读取私钥内容。
import { randomUUID } from 'node:crypto'; // 为每项远程任务生成独立编号。
const fail = (status, message) => Object.assign(new Error(message), { status }); // 为调用方提供明确的 HTTP 错误类型。
export function tailAddress(value) { // 只接受节点已经公布的覆盖网络 IP。
  if (typeof value !== 'string') return false; // 拒绝通过对象或数组绕过地址检查。
  if (isIP(value) === 4) { const bytes = value.split('.').map(Number); return bytes[0] === 100 && bytes[1] >= 64 && bytes[1] <= 127; } // 限制 IPv4 为 100.64.0.0/10。
  return isIP(value) === 6 && /^fd7a:115c:a1e0:/i.test(value); // 限制 IPv6 为 Tailscale 的固定 ULA 前缀。
} // 结束目标地址校验。
export function remoteProfile(body = {}) { // 白名单提取 SSH 登录参数，丢弃命令和密码等额外字段。
  const username = String(body.username || '').trim(), port = Number(body.port || 22), identityFile = String(body.identityFile || '').trim(); // 读取账号、端口和私钥路径。
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(username)) throw fail(400, 'SSH 用户名只支持字母、数字、点、下划线与连字符，并须以字母、数字或下划线开头'); // 限制账号避免远端 shell 注入。
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail(400, 'SSH 端口必须在 1 到 65535 之间'); // 只接受真实 TCP 端口。
  if (identityFile && (!path.isAbsolute(identityFile) || /[\r\n\0]/.test(identityFile) || identityFile.length > 1024)) throw fail(400, '私钥路径必须是管理台所在电脑上的绝对路径'); // 禁止控制字符及相对路径。
  const knownHostsFile=String(body.knownHostsFile||''); if(knownHostsFile&&(!path.isAbsolute(knownHostsFile)||/[\r\n\0]/.test(knownHostsFile))) throw fail(400,'主机公钥文件路径必须是有效绝对路径'); return { username, port, identityFile, ...(knownHostsFile?{knownHostsFile}:{}), sudo: body.sudo === true }; // 私钥内容与密码始终不进入配置。
} // 结束 SSH 配置标准化。
export function remoteCommand(os, action, sudo = false) { // 所有远端指令均从固定命令表选择。
  const platform = String(os).toLowerCase(), windows = platform === 'windows', linux = platform === 'linux', mac = ['macos', 'darwin'].includes(platform); // 识别允许运维的平台。
  if (!windows && !linux && !mac) throw fail(400, '此系统暂不支持 SSH 运维，请使用设备原有的管理工具'); // 手机等设备不提供虚假的升级按钮。
  const command = { version: 'tailscale version', preflight: 'tailscale update --dry-run', upgrade: 'tailscale update --yes', 'auto-on': 'tailscale set --auto-update=true', 'auto-off': 'tailscale set --auto-update=false' }[action]; // 提供有限的客户端管理动作。
  if (action === 'system') return windows ? 'powershell.exe -NoProfile -NonInteractive -Command "$o=Get-CimInstance Win32_OperatingSystem; $p=Get-CimInstance Win32_Processor; [pscustomobject]@{Computer=$env:COMPUTERNAME;OS=$o.Caption;LastBoot=$o.LastBootUpTime;TotalMemoryKB=$o.TotalVisibleMemorySize;FreeMemoryKB=$o.FreePhysicalMemory;CpuLoadPercent=($p.LoadPercentage | Measure-Object -Average).Average}|ConvertTo-Json -Compress"' : 'uname -a; uptime; ' + (linux ? 'free -m; df -h /' : 'vm_stat; df -h /'); // 只读查看实际系统、负载、内存与根分区信息。
  if (!command) throw fail(400, '不支持的远程操作'); // 禁止传入自定义命令。
  if (mac && action !== 'version') throw fail(400, 'macOS 更新方式取决于安装渠道，请使用设备本机的 Tailscale 或 App Store 更新入口'); // 避免通过通用命令破坏 App Store 安装版本。
  return (sudo && linux && ['upgrade', 'auto-on', 'auto-off'].includes(action) ? 'sudo -n ' : '') + command; // Linux 提权只用非交互 sudo，不索取密码。
} // 结束固定远程命令生成。
export function sshArguments(address, profile, command) { // 为 OpenSSH 创建独立参数，避免参数和主机注入。
  if (!tailAddress(address)) throw fail(400, '只能连接本网络设备公布的 Tailscale IP'); // 拒绝公网、环回和任意内网目标。
  return ['-F', 'none', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-p', String(profile.port), ...(profile.identityFile ? ['-o', 'IdentitiesOnly=yes', '-i', profile.identityFile] : []), ...(profile.knownHostsFile?['-o','UserKnownHostsFile='+profile.knownHostsFile,'-o','GlobalKnownHostsFile=none','-o','HostKeyAlgorithms=ssh-ed25519']:[]), '-l', profile.username, address, command]; // 禁用交互、转发与未知主机自动信任。
} // 结束 SSH 参数生成。
export function executionCommand(os, action, command) { // 为 Windows 固定运维命令提供不依赖 PATH 的执行包装。
  if (String(os).toLowerCase() !== 'windows') return command; // Linux 与 macOS 直接使用固定命令表。
  const script = action === 'system' ? command.slice('powershell.exe -NoProfile -NonInteractive -Command "'.length, -1) : "$ErrorActionPreference='Stop'; $ts=Join-Path $env:ProgramFiles 'Tailscale\\tailscale.exe'; if (!(Test-Path -LiteralPath $ts)) { $ts=(Get-Command tailscale.exe -ErrorAction Stop).Source }; & $ts " + command.slice('tailscale '.length) + '; exit $LASTEXITCODE'; // 优先使用标准安装路径，找不到时查找已安装的 CLI，并保留退出码。
  return 'powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from("$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; " + script, 'utf16le').toString('base64'); // 固定脚本编码传入，避免远端默认 shell 展开变量或破坏引号。
} // 结束 Windows 运维包装。
const clean = (value) => String(value || '').replace(/tskey-[A-Za-z0-9_-]+/g, '[已隐藏凭证]').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').slice(-48000); // 隐藏输出中意外出现的令牌和终端控制序列并限制长度。
export function executeSsh(binary, args, timeout, input = '') { // 运行固定 SSH 程序并完整返回退出状态。
  return new Promise((resolve) => { const child = execFile(binary, args, { windowsHide: true, timeout, maxBuffer: 128 * 1024 }, (error, stdout, stderr) => resolve({ exitCode: error ? typeof error.code === 'number' ? error.code : null : 0, output: clean(stdout), error: clean(stderr) || (error ? error.code === 'ENOENT' ? '本机未安装 OpenSSH 客户端，或 ssh.exe 路径不可用' : error.killed ? '操作超时或输出超过限制；远端操作可能仍在执行，请重新查看版本确认结果' : 'SSH 执行失败，请检查主机指纹、账号、认证和网络权限' : ''), uncertain: Boolean(error?.killed) })); child.stdin.on('error',()=>{}); child.stdin.end(input); }); // 不将本机完整错误命令回传浏览器。
} // 结束 SSH 执行器。
export function createRemoteManager({ resolveTarget, load = () => ({}), persist = () => {}, run = executeSsh, binary = 'ssh', mock = false }) { // 注入目标解析与配置持久化，方便在隔离测试中验证。
  let profiles = load(); const jobs = new Map(), busy = new Set(), checks = new Map(); // 保存连接配置、任务状态和成功预检证据。
  async function target(id) { const device = await resolveTarget(id); if (!device || !tailAddress(device.address)) throw fail(404, '找不到带有 Tailscale 地址的目标设备，请刷新设备列表'); return device; } // 每次操作重新核对目标，客户端不能直接指定地址。
  const ready = (id, address) => { const checked = checks.get(id); return Boolean(checked && checked.address === address && Date.now() - checked.at < 10 * 60000); }; // 后端统一判断预检是否仍然有效。
  async function info(id) { const device = await target(id); return { ok: true, target: device, profile: profiles[id] || null, mock, preflightReady: ready(id, device.address), jobs: [...jobs.values()].filter((job) => job.deviceId === id).slice(-8).reverse() }; } // 提供设备操作记录，不包含 SSH 私钥内容。
  async function save(id, body) { await target(id); if (busy.has(id)) throw fail(409, '此设备正在执行远程任务，请等待完成后修改连接配置'); const profile = remoteProfile(body), next = { ...profiles, [id]: profile }; await persist(next); profiles = next; checks.delete(id); return info(id); } // 原子保存成功后才替换内存并使旧预检失效。
  async function start(id, body = {}) { // 创建远程任务并立即返回编号供页面轮询。
    const device = await target(id), profile = profiles[id]; if(body.expectedAddress&&body.expectedAddress!==device.address) throw fail(409,'目标地址已变化，请重新确认'); if (!profile) throw fail(400, '请先保存此设备的 SSH 连接配置'); // 操作之前必须明确登录身份。
    const spec = advancedActions.includes(body.action) ? operationSpec(device.os, body.action, body.params, profile.sudo) : null, command = spec?.command || remoteCommand(device.os, body.action, profile.sudo), modifying = spec ? spec.modifying : ['upgrade', 'auto-on', 'auto-off'].includes(body.action); // 先验证操作类型，避免无效操作占用任务槽。
    if (modifying && body.confirm !== device.address) throw fail(400, '请确认目标设备地址后再执行修改'); // 绑定用户确认与当前设备地址。
    const checked = checks.get(id); if (body.action === 'upgrade' && (!checked || checked.address !== device.address || Date.now() - checked.at > 10 * 60000)) throw fail(409, '请先完成本设备的升级预检，预检有效期为 10 分钟'); // 真实升级必须有近期成功预检。
    if (busy.has(id) || busy.size >= 4) throw fail(409, '远程任务正在执行，请稍后再试'); // 限制单设备和全局并发。
    if (!mock && profile.identityFile && !fs.existsSync(profile.identityFile)) throw fail(400, '本机 SSH 私钥路径不存在，请检查连接配置'); // 不启动注定失败的私钥连接。
    const args = sshArguments(device.address, profile, spec ? command : executionCommand(device.os, body.action, command)), job = { id: randomUUID(), deviceId: id, hostname: device.hostname, address: device.address, action: body.action, command: spec?.summary || command, status: 'running', startedAt: new Date().toISOString(), mock, output: '', error: '' }; // 执行平台适配命令，同时保留可读的动作与目标快照。
    for (const [key, old] of jobs) if (jobs.size >= 60 && old.status !== 'running') jobs.delete(key); jobs.set(job.id, job); busy.add(id); // 限制历史记录占用并立即锁定目标。
    if (body.action === 'upgrade') checks.delete(id); // 升级后再次升级需要新的预检。
    Promise.resolve().then(() => mock ? { exitCode: 0, output: spec ? '【演示】'+spec.summary+'；未连接真实设备。' : body.action === 'preflight' ? '【演示】升级预检通过，将使用设备当前安装渠道升级；未连接真实设备。' : body.action === 'system' ? '【演示】系统在线；CPU 12%；可用内存 4.2 GB；根分区可用 68 GB。' : body.action === 'upgrade' ? '【演示】客户端升级流程完成。请重新查看版本确认。' : body.action === 'version' ? '【演示】1.104.5（模拟版本）' : '【演示】自动更新偏好已修改。' } : run(binary, args, spec?.timeout || (body.action === 'upgrade' ? 240000 : 45000), spec?.input || '')).then((result) => { Object.assign(job, result, { status: result.exitCode === 0 ? 'succeeded' : result.uncertain || modifying && result.exitCode === 255 ? 'uncertain' : 'failed' }); if (body.action === 'preflight' && job.status === 'succeeded') checks.set(id, { address: device.address, at: Date.now() }); }).catch(() => { job.status = 'failed'; job.error = '远程执行器异常，请检查 SSH 连接后重试'; }).finally(() => { job.finishedAt = new Date().toISOString(); busy.delete(id); }); // 后台执行，不因关闭抽屉或 HTTP 超时中断观察；升级期间 SSH 中断时明确标为待确认。
    return { ok: true, job: { ...job } }; // 返回任务副本，避免调用者修改内部状态。
  } // 结束远程任务创建。
  function job(id) { const value = jobs.get(id); if (!value) throw fail(404, '任务不存在，服务重启后历史记录会清空'); return { ok: true, job: { ...value }, preflightReady: ready(value.deviceId, value.address) }; } // 查询有限的本次运行任务历史并同步预检状态。
  return { info, save, start, job, target }; // 仅暴露配置、允许的动作和状态读取。
} // 结束远程管理器工厂。
