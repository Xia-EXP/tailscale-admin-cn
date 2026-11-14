import http from 'node:http'; // 只探测固定的本机管理台端口。
export const consolePorts = [8787, 8788, 8789, 8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798, 8799, 8800, 8801, 8802, 8803]; // 覆盖默认端口与有限的备用端口。
export function healthAt(port) { // 有界读取本机服务的公开健康信息。
  return new Promise((resolve) => { // 网络失败按未发现实例处理。
    const request = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 500 }, (response) => { // 固定目标，避免任意网络探测。
      let body = ''; response.setEncoding('utf8'); // 健康响应只接收文本。
      response.on('data', (part) => { body += part; if (body.length > 2048) request.destroy(); }); // 对陌生端口限制响应大小。
      response.on('end', () => { try { const data = JSON.parse(body); resolve(response.statusCode === 200 && data.ok === true && typeof data.mock === 'boolean' && /^\d+\.\d+\.\d+$/.test(data.version) ? { port, version: data.version, mock: data.mock, url: `http://127.0.0.1:${port}` } : null); } catch { resolve(null); } }); // 仅接受管理台使用的健康响应结构。
      response.on('error', () => resolve(null)); // 中断响应不阻塞启动。
    }); // 完成本机请求设置。
    request.on('timeout', () => request.destroy()); request.on('error', () => resolve(null)); // 端口不可用时快速结束。
  }); // 返回健康结果。
} // 结束单端口读取。
export async function discoverConsoles(ports = consolePorts) { // 同时查找有限范围内已运行的实例。
  return (await Promise.all(ports.map(healthAt))).filter(Boolean); // 过滤不可用或不匹配的服务。
} // 结束实例发现。
