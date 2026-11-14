# 接入自己的 Tailnet

每个使用者都应使用自己的 Tailscale 账号、tailnet、管理凭证和设备连接信息。

## 准备本机

在管理台运行主机上安装 Node.js 18+ 和 Tailscale 客户端，然后登录目标 tailnet：

~~~powershell
node --version
tailscale status
~~~

本机客户端用于读取节点实时状态、连接路径和 DERP 信息。管理台调用官方 API 的权限来自页面中配置的 API Token 或 OAuth Client。

## 生成管理凭证

在自己的 Tailscale 管理后台进入 Settings → Keys → API access tokens，生成 tskey-api-...。从只读权限开始，只为设备、路由、DNS、ACL、用户、Webhook 或注册密钥等实际功能增加 scope，不要把 Owner 级别长期 Token 放入脚本、网页或仓库。

如果希望自动续期，可以创建自己的 OAuth Client，记录 Client ID 和 Client Secret，在管理台选择 OAuth 后填写 Client ID、Client Secret 和 Tailnet。Secret 只保存在服务端的 data/config.json。撤销 OAuth Client 后，需要重新配置有效 Client。

## 启动和配置

~~~powershell
npm run mock
npm start
~~~

先用演示模式确认界面，再启动真实模式。打开页面后进入设置，填写自己的认证信息。不要复制原机器的 data/ 目录，也不要复用原机器的 data/access.json。

## 局域网访问

Windows 下使用安装器：

~~~powershell
.\deploy\install.ps1 -Domain 'tailscale-admin.lan' -Port 8787 -LanAddress '192.168.1.20'
~~~

客户端需要能解析这个域名。可以在路由器 DNS 中添加记录，也可以在 Windows 客户端以管理员身份运行：

~~~powershell
.\deploy\set-domain.ps1 -Address '192.168.1.20' -Domain 'tailscale-admin.lan'
~~~

然后访问 http://tailscale-admin.lan:8787。可信内网可以使用 HTTP；跨公网或不可信网络应配置 HTTPS 反向代理、VPN 或 Tailscale Serve，并保留管理台自己的登录保护。

## SSH 运维

1. 确认目标设备有自己的 Tailscale IP。
2. 先在管理台所在主机的终端执行一次标准 SSH 命令，核对主机指纹。
3. 在设备详情中填写 SSH 用户、端口和本机私钥路径。
4. 先执行版本读取和升级预检，再确认需要执行的动作。

私钥路径指向管理台所在主机上的文件。管理台不会把私钥内容上传到 Tailscale API，也不会保存 SSH 密码。

## 常见权限问题

- 401：Token 已过期、被吊销或格式错误。
- 403：凭证有效，但没有当前功能需要的 scope。
- 状态未知：官方 API 和本机 Tailscale 客户端都没有提供可匹配的在线状态。
- 路由没有生效：设备还需要在本机用 tailscale set --advertise-routes=... 公布路由，API 只能批准已经公布的路由。
- OAuth 注册密钥失败：OAuth Client 没有对应的标签或注册密钥权限。
