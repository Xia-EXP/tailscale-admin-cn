import { remoteSetupCommands } from './public/remote-setup.js'; // 复用已验证的 Windows SSH 服务开启步骤。
const sh = value => "'" + String(value).replaceAll("'", "'\\''") + "'"; // 对固定脚本中的数据使用 POSIX 单引号转义。
const ps = value => "'" + String(value).replaceAll("'", "''") + "'"; // 对 PowerShell 数据使用字面量转义。
export function pairingScript(plan, publicKey, { switchSsh = false } = {}) { // 生成只包含公钥的目标机一次性配置脚本。
  const receipt={version:1,pairingId:plan.id,deviceId:plan.deviceId,address:plan.address,keyFingerprint:plan.keyFingerprint,username:'%s',hostKey:'%s',port:22},filename='tailscale-pairing-'+plan.id+'.json'; // 回执绑定设备、地址和本次管理公钥。
  if(plan.os==='linux')return [ // Linux 配置标准 OpenSSH，兼容后台严格主机验证。
    '# 在此目标 Linux 的终端执行一次；需要 sudo。只安装公钥，不包含管理私钥。', // 明确执行位置和权限。
    '( # 隔离变量并保留当前终端。', 'set -eu # 任意配置失败立即停止。', // 防止失败后产生成功回执。
    'sudo -v # 在目标机本地确认管理员权限。', // 不将密码传给后台。
    `EXPECTED_IP=${sh(plan.address)} # 绑定用户选定的目标地址。`, // 防止脚本在错误机器上误授权。
    'tailscale ip | grep -Fx -- "$EXPECTED_IP" >/dev/null || { echo "Wrong machine or Tailscale is disconnected."; exit 1; } # 必须匹配当前机器地址。', // 不接受仅同名的设备。
    ...(switchSsh?['sudo tailscale set --ssh=false # 按用户选择切换到标准 OpenSSH，保留其他参数。']:['if tailscale debug prefs | grep -Eq \'"RunSSH"[[:space:]]*:[[:space:]]*true\'; then echo "Tailscale SSH intercepts port 22. Regenerate with the explicit OpenSSH switch selected."; exit 1; fi # 不静默关闭已有 Tailscale SSH。']), // 避免公钥被安装后流量仍进入另一套 SSH。
    'command -v systemctl >/dev/null || { echo "This setup supports systemd Linux only."; exit 1; } # 拒绝无法可靠管理服务的平台。', // 不猜测容器或 NAS 服务方式。
    'if ! command -v sshd >/dev/null && [ ! -x /usr/sbin/sshd ]; then if command -v apt-get >/dev/null; then sudo apt-get update; sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server; elif command -v dnf >/dev/null; then sudo dnf install -y openssh-server; else echo "Install openssh-server first."; exit 1; fi; fi # 使用目标系统包管理器安装 SSH。', // 仅在缺少组件时安装。
    'sudo ssh-keygen -A # 只生成缺失的主机密钥，不覆盖既有身份。', // 主机身份用于后台固定验证。
    'SSHD=$(command -v sshd || printf /usr/sbin/sshd) # 定位服务端程序。', // 避免普通用户 PATH 缺少 sbin。
    'sudo install -d -m 755 /run/sshd # 准备服务端运行目录。', // 支持首次安装后的配置检查。
    'PORT=$(sudo "$SSHD" -T | awk \'$1=="port" {print $2;exit}\') # 读取现有服务端口。', // 不覆盖用户自定义 sshd 配置。
    '[ "$PORT" = 22 ] || { echo "This setup requires SSH port 22; keep custom-port profiles configured manually."; exit 1; } # 非默认端口明确停止。', // 不输出不能使用的默认端口回执。
    'SSH_USER=${SUDO_USER:-$(id -un)} # 优先识别 sudo 前的原用户。', // 不因为提权就错误保存 root。
    'printf "%s" "$SSH_USER" | grep -Eq \'^[A-Za-z_][A-Za-z0-9_.-]{0,63}$\' || { echo "Unsupported SSH username."; exit 1; } # 账号必须可安全回传。', // 与后台用户名规则一致。
    'USER_HOME=$(getent passwd "$SSH_USER" | cut -d: -f6) # 从系统账号数据库读取真实主目录。', // 不按用户名猜测路径。
    '[ -n "$USER_HOME" ] && [ -d "$USER_HOME" ] || { echo "Account home not found."; exit 1; } # 确认账号已有主目录。', // 不创建未知系统账号。
    'SSH_GROUP=$(id -gn "$SSH_USER") # 读取账号实际主组。', // 正确设置公钥文件所有权。
    'sudo install -d -m 700 -o "$SSH_USER" -g "$SSH_GROUP" "$USER_HOME/.ssh" # 创建或规范目标账号 SSH 目录。', // 仅处理选中账号的配置。
    `PUBLIC_KEY=${sh(publicKey)} # 后台专用公钥，可安全分发；不是私钥。`, // 公钥只用于授权该控制台。
    'sudo touch "$USER_HOME/.ssh/authorized_keys" # 保留已有授权文件。', // 不覆盖其他合法管理员公钥。
    'if ! sudo grep -qxF -- "$PUBLIC_KEY" "$USER_HOME/.ssh/authorized_keys"; then printf "\\n%s\\n" "$PUBLIC_KEY" | sudo tee -a "$USER_HOME/.ssh/authorized_keys" >/dev/null; fi # 仅追加尚不存在的公钥。', // 重复运行不会重复添加相同授权。
    'sudo chown "$SSH_USER:$SSH_GROUP" "$USER_HOME/.ssh/authorized_keys" # 确保公钥由目标账号持有。', // 满足 OpenSSH 权限要求。
    'sudo chmod 600 "$USER_HOME/.ssh/authorized_keys" # 限制授权文件写入。', // 避免其他用户篡改登录授权。
    'sudo "$SSHD" -t # 在启动前检查现有服务配置。', // 不在错误配置下报告成功。
    'if systemctl list-unit-files ssh.service --no-legend | grep -q \'^ssh.service\'; then sudo systemctl enable --now ssh; else sudo systemctl enable --now sshd; fi # 启用并启动系统对应服务。', // 不修改其他系统服务。
    'HOST_KEY=$(sudo awk \'{print $1" "$2}\' /etc/ssh/ssh_host_ed25519_key.pub) # 只导出服务端公钥。', // 私有主机密钥始终保留在目标机。
    `printf ${sh(JSON.stringify(receipt)+'\n')} "$SSH_USER" "$HOST_KEY" > ${sh(filename)} # 保存不含密码或私钥的导入回执。`, // JSON 模板的可变字段均经过字符范围限制。
    `cat ${sh(filename)} # 也可以直接复制这段 JSON 到后台批量导入。`, // 不强制依赖目标机回调到后台。
    'echo "Import this JSON in the console, then test SSH. Existing firewall and sudo rules still apply." # 以真实连接验证最终权限。', // 不自动开放整个防火墙或授予免密码 sudo。
    ') # 返回终端。' // 结束 Linux 配置脚本。
  ].join('\n'); // 返回可复制且重复执行不覆盖既有公钥的脚本。
  if(plan.os!=='windows')throw Object.assign(Error('免密配置脚本目前支持 Windows 和 systemd Linux。'),{status:400}); // 不假装支持未知系统。
  return [ // Windows 使用管理员本地执行账号，与系统默认 OpenSSH 授权位置一致。
    '# 在选定 Windows 目标机的管理员 PowerShell 中执行一次。', // 明确使用管理员终端。
    `$expectedIp=${ps(plan.address)} # 绑定选中的设备地址。`, // 阻止在另一台机器运行该授权脚本。
    "$pairTail=Join-Path $env:ProgramFiles 'Tailscale\\tailscale.exe' # 定位目标客户端。", // 使用官方安装位置。
    "if (-not (Test-Path -LiteralPath $pairTail)) { throw 'Install Tailscale first.' } # 在修改前检查客户端。", // 不在未安装机器上配置密钥。
    "if ($expectedIp -notin @(& $pairTail ip)) { throw 'Wrong target machine or Tailscale is disconnected.' } # 目标地址必须匹配。", // 防止批量脚本分发错位。
    remoteSetupCommands({os:'windows',ssh:true,rdp:false}), // 复用按需安装、服务自启动及限定地址的防火墙步骤。
    "$identity=[Security.Principal.WindowsIdentity]::GetCurrent() # 识别当前实际执行账号。", // 不读取或推测密码。
    "$account=$identity.Name.Split('\\') # 区分本机账号与域账号。", // 明确当前实现的系统账号范围。
    "if ($account.Count -ne 2 -or $account[0] -ine $env:COMPUTERNAME -or $account[1] -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$') { throw 'Use a supported local administrator account for this setup.' } # 域或特殊账号使用手工 SSH 配置。", // 不把不可用账号写入批量配置。
    "$sshExe=Join-Path $env:WINDIR 'System32\\OpenSSH\\sshd.exe' # 定位系统 SSH 服务端。", // 不信任其他位置的同名程序。
    "$effective=@(& $sshExe -T) # 读取实际服务设置。", // 避免假设用户没有改端口。
    "if ($LASTEXITCODE -ne 0 -or 'port 22' -notin $effective) { throw 'This setup requires an SSH server listening on port 22.' } # 非默认端口交给手动配置。", // 防止产生错误端口回执。
    "$authFile=Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys' # Windows 默认管理员组使用共享授权文件。", // 与官方 OpenSSH 管理员行为一致。
    `$publicKey=${ps(publicKey)} # 仅包含后台公钥。`, // 不会把私钥复制到节点。
    "$existing=if(Test-Path -LiteralPath $authFile){[IO.File]::ReadAllText($authFile)}else{''} # 保留所有已有授权。", // 不覆盖其他运维身份。
    "if ($publicKey -notin ($existing -split '\\r?\\n')) { [IO.File]::AppendAllText($authFile, [Environment]::NewLine+$publicKey+[Environment]::NewLine, [Text.UTF8Encoding]::new($false)) } # 追加缺失公钥，保持可重复执行。", // 不产生 UTF-8 BOM 破坏 authorized_keys。
    "& icacls.exe $authFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null # 仅 SYSTEM 与管理员组可管理此授权文件。", // 使用 SID 兼容中文 Windows。
    "if ($LASTEXITCODE -ne 0) { throw 'Cannot protect administrators_authorized_keys.' } # 权限设置失败时停止。", // 不在未知授权状态下签发回执。
    "$hostKeyFile=Join-Path $env:ProgramData 'ssh\\ssh_host_ed25519_key.pub' # 读取服务端公开身份。", // 私钥不离开目标机。
    "$hostParts=([IO.File]::ReadAllText($hostKeyFile).Trim() -split '\\s+') # 去掉主机公钥的可选注释。", // 后台仅接受标准类型及二进制公钥。
    `$receipt=@{version=1;pairingId=${ps(plan.id)};deviceId=${ps(plan.deviceId)};address=$expectedIp;keyFingerprint=${ps(plan.keyFingerprint)};username=$account[1];hostKey=($hostParts[0]+' '+$hostParts[1]);port=22} # 自动填入账号与主机公钥。`, // 不要求用户逐台手写用户名。
    `$receiptPath=Join-Path (Get-Location).Path ${ps(filename)} # 输出到当前终端目录。`, // 文件名只含本次配对标识。
    "$receiptJson=$receipt|ConvertTo-Json -Compress # 生成批量导入格式。", // 单个文件可与其他节点一起导入。
    "[IO.File]::WriteAllText($receiptPath,$receiptJson,[Text.UTF8Encoding]::new($false)) # 保存无密码回执。", // 适合跨系统传回后台。
    "Write-Output $receiptPath # 告知生成文件位置。", // 便于批量收集。
    "Write-Output $receiptJson # 支持直接复制 JSON。", // 文件不方便传回时仍可导入。
    "Write-Output 'Import the receipt in the console and test SSH. Windows administrators share this authorization file.' # 说明授权影响与下一步。" // 不把服务开启当成 SSH 登录成功。
  ].join('\n'); // 返回完整 Windows 配置脚本。
} // 结束批量配对脚本生成器。
