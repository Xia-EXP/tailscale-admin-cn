import fs from 'node:fs'; // 读取安装器保存的域名与端口。
import path from 'node:path'; // 构造部署目录内的配置路径。
import { fileURLToPath } from 'node:url'; // 支持包含中文或空格的解压路径。
const root = path.dirname(fileURLToPath(import.meta.url)); // 固定部署根目录，不依赖计划任务工作目录。
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'data', 'deployment.json'), 'utf8')); // 配置缺失时停止，不意外开放默认服务。
if (!Number.isInteger(deployment.port) || deployment.port < 1 || deployment.port > 65535 || !Array.isArray(deployment.allowedHosts) || !deployment.allowedHosts.length) throw new Error('Invalid deployment settings.'); // 严格校验监听端口和域名白名单。
process.env.HOST = '0.0.0.0'; process.env.PORT = String(deployment.port); process.env.TSADMIN_ALLOWED_HOSTS = deployment.allowedHosts.join(','); // 明确启用网络监听及已配置的访问地址。
process.env.TSADMIN_MOCK = '0'; // 计划任务始终运行真实管理服务。
process.argv.push('--no-open', '--no-exit-watch'); // 后台启动不打开浏览器，也不自动调整目标机出口。
await import('./server.mjs'); // 通过已带密码门禁的原服务处理全部管理请求。
