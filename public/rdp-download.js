import {storedZip} from './fleet-zip.js'; // 复用浏览器本地 ZIP 打包，不把密码传回后台。
function connection(target,profile={}){ // 在生成 RDP 和批处理前校验所有插入值。
  const address=String(target.address||''),username=String(profile.username||''); // 仅使用保存的连接账号。
  if(!/^(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})|fd7a:115c:a1e0:[0-9a-f:]+)$/i.test(address))throw Error('远程桌面目标必须是设备的 Tailscale 地址'); // 拒绝批处理元字符、换行和任意目标。
  if(username&&!/^[A-Za-z0-9_][A-Za-z0-9_.@\\-]{0,127}$/.test(username))throw Error('远程桌面账号包含不支持的字符'); // 禁止命令替换、环境变量及 RDP 行注入。
  return{address,username}; // 仅返回经过校验的值。
} // 结束下载参数校验。
export function rdpContent(target,profile={}){ // 为原有下载入口生成带已保存账号的 RDP 文件。
  const {address,username}=connection(target,profile); // 共用连接文件和凭据保存脚本的目标。
  return[`full address:s:${address.includes(':')?'['+address+']':address}`,...(username?[`username:s:${username}`]:[]),'prompt for credentials:i:0','authentication level:i:2','enablecredsspsupport:i:1','redirectclipboard:i:0','screen mode id:i:2',''].join('\r\n'); // 允许使用本机保存的凭据，同时保留服务器身份检查及 NLA。
} // 结束带账号的连接文件生成。
export function rdpBundleFiles(target,profile={}){ // 为首次保存密码和日后直接连接提供独立入口。
  const {address,username}=connection(target,profile);if(!username)throw Error('请先保存此设备的登录账号，再下载一键连接包'); // 不把未知账号替换为 Administrator 或 root。
  const connect=['@echo off','rem Open the connection using credentials saved by this Windows user.','start "" "%SystemRoot%\\System32\\mstsc.exe" "%~dp0Connection.rdp"',''].join('\r\n'); // 日常连接不再要求重新保存密码。
  const save=['@echo off','rem Ask Windows to store this target password locally; the password is never in this script.',`echo Target: ${address}`,`echo Account: ${username}`,'echo Enter the Windows account password when prompted. A Windows Hello PIN is not the account password.',`"%SystemRoot%\\System32\\cmdkey.exe" /generic:TERMSRV/${address} /user:${username} /pass`,'rem Stop if Windows refuses to save the credential.','if errorlevel 1 goto failed','rem Open Remote Desktop after credential storage succeeds.','start "" "%SystemRoot%\\System32\\mstsc.exe" "%~dp0Connection.rdp"','exit /b 0',':failed','echo Credential storage failed. No connection was started.','pause','exit /b 1',''].join('\r\n'); // 让 cmdkey 自己交互读取密码，避免密码出现在参数、文件或后台请求中。
  const readme=`设备：${target.hostname||address}\r\n地址：${address}\r\n账号：${username}\r\n\r\n完整解压后，首次双击 Save-Password.cmd，在 Windows 提示处输入该账号的登录密码。输入时可能不显示字符。成功后自动打开远程桌面。\r\n以后双击 Connect.cmd 或 Connection.rdp。更换密码时再运行 Save-Password.cmd。\r\n密码由当前 Windows 用户的凭据管理器保存，目标是 TERMSRV/${address}；本连接包和管理后台不保存密码。换电脑或换 Windows 用户后需要重新输入。\r\n请使用 Windows 账号密码，不能使用 Windows Hello PIN。设备或组织策略可能要求每次重新认证；本工具不会绕过这些策略。\r\n可以在 Windows 凭据管理器的 Windows 凭据中删除对应 TERMSRV 条目。目标需已开启远程桌面且允许该账号登录。\r\n`; // 说明首次操作、记住密码范围和删除入口。
  return[{name:'Connection.rdp',content:rdpContent(target,profile)},{name:'Connect.cmd',content:connect},{name:'Save-Password.cmd',content:save},{name:'README.txt',content:'\ufeff'+readme}]; // 包内只含目标、账号和固定脚本，没有任何真实密码。
} // 结束可审阅连接包文件生成。
export function rdpBundle(target,profile){return storedZip(rdpBundleFiles(target,profile));} // 直接在访问者浏览器生成 ZIP，不上传凭据。
