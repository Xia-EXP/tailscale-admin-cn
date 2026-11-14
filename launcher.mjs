import { readFile } from 'node:fs/promises'; // 从源码版本识别可复用的服务。
import { spawn, execFile } from 'node:child_process'; // 启动真实后台或打开已有实例。
import net from 'node:net'; // 用真实监听判断端口是否空闲。
import { fileURLToPath } from 'node:url'; // 使用准确的项目目录。
import { discoverConsoles, consolePorts } from './runtime-discovery.mjs'; // 复用只读本机服务发现。
const root = fileURLToPath(new URL('.', import.meta.url)), args = process.argv.slice(2); // 定位项目并接收启动选项。
const version = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8')).version; // 始终与项目版本保持一致。
const mock = args.includes('--mock'), noOpen = args.includes('--no-open'); // 启动入口默认真实模式，演示须明确指定。
const preferred = process.env.PORT ? [Number(process.env.PORT)] : consolePorts; // 显式 PORT 优先于自动备用端口。
if (preferred.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('PORT 必须为有效端口号'); // 防止无效端口造成含糊失败。
const instances = await discoverConsoles([...new Set([...preferred, ...consolePorts])]); // 先发现现有服务，避免重复启动。
const existing = instances.find((item) => preferred.includes(item.port) && item.mock === mock && item.version === version); // 严格区分真实、演示和旧版。
function open(url) { // 按平台调用默认浏览器。
  if (noOpen) return; // 允许无浏览器验证。
  const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]; // 地址仅由固定本机端口生成。
  execFile(command[0], command[1], { windowsHide: true }, () => {}); // 启动浏览器失败不影响服务使用。
} // 结束浏览器打开。
if (existing) { // 最新同模式实例已存在时直接使用。
  console.log(`使用运行中的 v${version} ${mock ? '演示服务' : '真实管理台'}：${existing.url}/#devices`); // 告知用户确切模式和地址。
  open(`${existing.url}/#devices`); // 打开正确的实例。
} else { // 没有匹配版本时选择真正空闲端口。
  const available = (port) => new Promise((resolve) => { const probe = net.createServer(); probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true))); }); // 不触碰占用端口的已有进程。
  let port = null; for (const candidate of preferred) if (await available(candidate)) { port = candidate; break; } // 按顺序使用默认或备用端口。
  if (port === null) throw new Error('管理台端口均已占用，请设置一个空闲 PORT 后再启动。'); // 给出可操作的启动错误。
  const activeReal = instances.some((item) => !item.mock); // 已有真实服务时保留其唯一出口自动监测。
  const childArgs = [fileURLToPath(new URL('server.mjs', import.meta.url)), ...(mock ? ['--mock'] : []), ...(noOpen ? ['--no-open'] : []), ...(activeReal || mock ? ['--no-exit-watch'] : [])]; // 防止多个并行实例重复自动修改出口。
  console.log(`正在启动 v${version} ${mock ? '演示服务' : '真实管理台'}：http://127.0.0.1:${port}/#devices`); // 显示实际选择的模式和端口。
  if (activeReal && !mock) console.log('已有真实服务继续负责出口自动监测；本实例使用相同本地配置。'); // 交代并行运行时的监测归属。
  const child = spawn(process.execPath, childArgs, { cwd: root, env: { ...process.env, PORT: String(port), TSADMIN_MOCK: mock ? '1' : '0' }, stdio: 'inherit', windowsHide: true }); // 只启动当前项目服务并明确覆盖演示环境变量。
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; }); // 启动失败返回明确结果。
  child.on('exit', (code) => { process.exitCode = code || 0; }); // 将服务器退出状态传递给启动窗口。
} // 结束启动分支。
