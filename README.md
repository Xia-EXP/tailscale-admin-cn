# Tailscale 中文管理台

一个零运行时依赖的中文 Tailscale 管理台。服务端使用 Node.js 内置模块，前端是原生 JavaScript，无需构建或 npm install。

本项目是社区工具，不是 Tailscale 官方产品。Tailscale 是 Tailscale Inc. 的商标。

## 功能

- 查看设备、在线状态、连接路径和本机 Tailscale 节点。
- 管理设备名称、授权状态、密钥到期、子网路由、DNS、ACL、用户、注册密钥和 Webhook。
- 使用 API Token 或 OAuth Client Credentials 访问自己的 tailnet。
- 对已配置 SSH 的设备执行只读检查、升级预检和有限的固定运维动作。
- 生成不含账号密码的 Windows 远程桌面连接文件。
- 提供不读取真实凭证的内存演示模式。

## 隐私边界

公开仓库只包含源码、前端和通用部署脚本。真实部署中的 data/、API Token、OAuth Secret、SSH 私钥、设备地址、审计记录、迁移文件和本地访问地址都不会进入仓库。

第一次使用时，真实配置会写入本机的 data/ 目录。请把它当作私密目录。若凭证曾经进入 Git、Issue、截图或聊天记录，请立即吊销并重新生成。

详见 [隐私与安全](docs/隐私与安全.md)。

## 环境要求

- Node.js 18 或更新版本。
- 真实模式需要在运行管理台的电脑上安装并登录 Tailscale 客户端。
- Windows 局域网常驻安装需要管理员权限；Linux 和 macOS 可以手动启动本地服务。
- 管理凭证需要拥有对应 Tailscale API 权限，建议使用最小权限的 OAuth Client。

## 演示模式

演示模式不读取 data/ 中的真实配置，写操作只存在于内存：

~~~powershell
npm run mock
~~~

打开启动器打印的 http://127.0.0.1:8787 或备用端口。不自动打开浏览器时运行：

~~~powershell
node launcher.mjs --mock --no-open
~~~

## 接入自己的 Tailnet

1. 在运行管理台的电脑上安装并登录 Tailscale：

   ~~~powershell
   tailscale status
   ~~~

2. 启动真实服务：

   ~~~powershell
   npm start
   ~~~

3. 在「设置」或「密钥管理」中配置自己的凭证：

   - API access token：在自己的 Tailscale 管理后台生成 tskey-api-...，只授予实际需要的权限。
   - OAuth 自动续期：创建自己的 OAuth Client，填写 Client ID、Client Secret 和 Tailnet。Secret 只保存在服务端的 data/config.json。

4. 先点击「测试连接」，通过后再点击「验证并替换管理凭证」。

设备页和节点信息页会同时使用官方 API 与本机 tailscale status --json，因此显示范围取决于 API 权限、当前机器的 tailnet 登录状态和网络策略。

完整步骤见 [接入自己的 Tailnet](docs/接入自己的-Tailnet.md)。

## Windows 局域网安装

公开发行版使用用户自己安装的 Node.js，不捆绑某台电脑的运行时。以管理员身份运行：

~~~powershell
.\deploy\install.cmd
~~~

安装器会创建后台密码、Host 白名单、防火墙规则和 TailscaleAdmin-LAN 开机任务。后台账号固定为 admin，密码长度为 12–256 个字符，默认监听 8787。

也可以显式指定自己的域名、端口和 LAN 地址：

~~~powershell
.\deploy\install.ps1 -Domain 'tailscale-admin.lan' -Port 8787 -LanAddress '192.168.1.20'
~~~

客户端 DNS 可以由路由器统一解析，也可以在 Windows 客户端以管理员身份运行：

~~~powershell
.\deploy\set-domain.ps1 -Address '192.168.1.20' -Domain 'tailscale-admin.lan'
~~~

然后访问 http://tailscale-admin.lan:8787，使用安装时设置的 admin 密码登录。不要把域名、局域网 IP 或密码写进仓库。

服务管理：

~~~powershell
.\deploy\manage.ps1 -Action start
.\deploy\manage.ps1 -Action stop
.\deploy\manage.ps1 -Action restart
~~~

## 手动启动

本地使用时：

~~~powershell
node server.mjs --no-open
~~~

默认只监听 127.0.0.1:8787。局域网访问必须同时设置后台密码、Host 白名单和网络边界；不要直接暴露到公网。非 Windows 系统建议使用 HTTPS 反向代理。

## 远程 SSH 运维

为自己的设备填写 Tailscale IP、SSH 用户、端口和本机私钥路径后，先在终端完成一次主机指纹确认，再运行只读检查或升级预检。管理台不读取或保存私钥内容，也不保存 SSH 密码；连接配置属于本地 data/remote-profiles.json。

## 检查

~~~powershell
npm test
Get-ChildItem -Filter '*.mjs' | ForEach-Object { node --check $_.FullName }
~~~

## 目录

~~~text
server.mjs            本地服务、API 代理和安全边界
launcher.mjs          真实/演示启动器和端口选择
public/               原生前端
deploy/               Windows 安装、域名映射和服务管理
deployment-tools.mjs  密码初始化和可选加密迁移工具
tests/                不依赖网络的 Node 测试
data/                 运行时私密数据，不提交
~~~

## 许可与安全

本项目以 MIT License 发布，见 LICENSE。请不要在公开 Issue 中粘贴 API Token、OAuth Secret、SSH 私钥、完整 data/ 或真实设备清单；安全问题请按 SECURITY.md 说明报告。
