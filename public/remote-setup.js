export function remoteSetupCommands({ os, ssh = true, rdp = false } = {}) { // 为目标设备生成可审核的远程服务开启脚本，不在后台机器执行。
  if (!['linux', 'windows'].includes(os) || (!ssh && !rdp) || (rdp && os !== 'windows')) throw new Error('请选择支持的系统和至少一种远程服务。'); // 拒绝不支持的组合。
  if (os === 'linux') return ['# 在目标 Linux 的终端执行，需要 sudo 和已连接的 Tailscale。', '( # 独立运行，失败不关闭终端。', 'set -eu # 任一步骤失败立即停止。', 'command -v tailscale >/dev/null 2>&1 || { echo "Install and connect Tailscale first."; exit 1; } # 检查客户端。', 'sudo tailscale set --ssh=true # 开启 Tailscale SSH，不重置其他客户端参数。', 'printf "SSH user: %s\\n" "$(id -un)" # 显示当前真实系统用户名。', 'tailscale ip -4 # 显示连接目标地址。', 'echo "Tailscale SSH policy must allow this user and device." # 提醒网络策略仍需允许登录。', ') # 完成服务配置。'].join('\n'); // Linux 使用已有客户端的 SSH 服务，保留普通 OpenSSH 配置。
  return [ // Windows 使用系统 OpenSSH 与远程桌面，不修改系统账号密码。
    '# 在目标 Windows 上以管理员身份打开 PowerShell，粘贴执行。', // 明确执行位置。
    "$ErrorActionPreference = 'Stop' # 发生错误立即停止。", // 禁止把部分失败显示为成功。
    "if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator.' } # 校验管理员权限。", // 在任何修改前验证权限。
    "$tailExe = Join-Path $env:ProgramFiles 'Tailscale\\tailscale.exe' # 定位客户端。", // 不使用用户可控可执行路径。
    "if (-not (Test-Path -LiteralPath $tailExe)) { throw 'Install and connect Tailscale first.' } # 要求已有客户端。", // 服务开启不负责重新登录设备。
    "$tailState = (& $tailExe status --json | ConvertFrom-Json) # 读取实际连接状态。", // 校验目标网络。
    "if ($LASTEXITCODE -ne 0 -or $tailState.BackendState -ne 'Running') { throw 'Connect Tailscale before enabling remote services.' } # 避免为未连接设备配置访问。", // 保留失败的真实原因。
    "$tailAddresses = @($tailState.TailscaleIPs) # 获取防火墙规则需要的实际本机覆盖网络地址。", // 不硬编码其他机器地址。
    "if (-not $tailAddresses.Count) { throw 'No Tailscale address found.' } # 不允许空地址变成任意地址规则。", // 防止意外扩大监听范围。
    ...(rdp ? ["$edition = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').EditionID # 读取系统版本。", "if ($edition -notmatch '^(Professional|Enterprise|Education|Server|IoTEnterprise)') { throw 'This Windows edition cannot host Remote Desktop. Select SSH only or use a supported Windows edition.' } # 家庭版等不支持远程桌面服务端，修改前终止。"] : []), // 在所有服务修改前检查远程桌面兼容性。
    "$peerRanges = @('100.64.0.0/10', 'fd7a:115c:a1e0::/48') # 仅为 Tailscale 地址创建本工具的放行规则。", // 不对公网添加新规则。
    ...(ssh ? [ // 只在明确选择 SSH 时配置系统服务。
      "$capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' # 检查系统 OpenSSH 服务端组件。", // 避免重复安装。
      "if ($capability.State -ne 'Installed') { $install = Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'; if ($install.RestartNeeded) { throw 'OpenSSH installation requires a restart; restart Windows and run this script again.' }; $defaultRule = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue; if ($defaultRule) { $defaultRule | Set-NetFirewallRule -RemoteAddress $peerRanges -LocalAddress $tailAddresses } } # 按需安装并限制安装器新建的默认放行规则。", // 不修改原来已安装组件的防火墙配置。
      "Set-Service -Name sshd -StartupType Automatic # 设置 SSH 服务随系统启动。", // 让重启后仍可运维。
      "Start-Service -Name sshd # 启动 SSH 服务。", // 不重新启动已运行的服务。
      "$sshRule = Get-NetFirewallRule -Name 'TailscaleAdmin-SSH' -ErrorAction SilentlyContinue # 查找本工具自己的规则。", // 保留其他程序规则。
      "if ($sshRule) { $sshRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any -RemoteAddress $peerRanges -LocalAddress $tailAddresses } else { New-NetFirewallRule -Name 'TailscaleAdmin-SSH' -DisplayName 'Tailscale Admin SSH' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $tailAddresses -RemoteAddress $peerRanges -Profile Any | Out-Null } # 为覆盖网络添加可重复执行的 SSH 规则。", // 使用固定名称保证重复执行不会增加多份规则。
      "Get-Service -Name sshd | Select-Object Name, Status, StartType # 显示实际 SSH 服务状态。" // 输出服务状态，仍不等于远端认证成功。
    ] : []), // 结束 SSH 配置分支。
    ...(rdp ? [ // 只在选择远程桌面时启用 RDP。
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -Value 0 # 允许远程桌面连接。", // 使用 Windows 服务端开关。
      "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' -Name UserAuthentication -Value 1 # 要求网络级别身份验证 NLA。", // 保留认证要求。
      "Start-Service -Name TermService # 确保远程桌面服务运行。", // 使用系统现有服务配置。
      "foreach ($protocol in @('TCP','UDP')) { $ruleName = 'TailscaleAdmin-RDP-' + $protocol; $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue; if ($rule) { $rule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Any -RemoteAddress $peerRanges -LocalAddress $tailAddresses } else { New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol $protocol -LocalPort 3389 -LocalAddress $tailAddresses -RemoteAddress $peerRanges -Profile Any | Out-Null } } # 仅在覆盖网络地址放行远程桌面。", // 不批量启用系统自带的广域规则。
      "Get-Service -Name TermService | Select-Object Name, Status # 显示实际远程桌面服务状态。" // 确认服务操作结果。
    ] : []), // 结束远程桌面配置分支。
    "Write-Output ('Current Windows account: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name) # 显示执行此脚本的实际系统账号，不读取密码。", // 便于填入后台连接信息。
    "& $tailExe ip -4 # 显示目标 Tailscale IPv4。", // 提供连接地址。
    "Write-Output 'Use an existing authorized account. Passwordless admin automation needs SSH keys or an SSH agent; Windows Hello PIN is not an SSH password.' # 说明首次身份认证条件。", // 不误导用户把管理 API 授权当作系统登录。
    "Write-Output 'Existing firewall rules and network access policies still apply; test the connection from your management computer.' # 提醒实际连通性仍需验证。" // 不宣称服务启动等于网络登录成功。
  ].join('\n'); // 返回可复制或下载的完整脚本。
} // 结束服务配置生成器。
export function openRemoteSetup({ os, esc, openModal, copyText, toast }) { // 设备详情提供无需新建 Key 的独立开启入口。
  const windows = os === 'windows'; // 只显示该设备支持的服务。
  openModal({ title: windows ? '一键配置 SSH／远程桌面' : '一键配置 Tailscale SSH', sub: '复制后在这台目标机器执行一次；不会在管理后台电脑执行。', body: `<div class="callout">${windows ? 'Windows 可开启 OpenSSH 和远程桌面。家庭版请选择仅 SSH；远程桌面需支持服务端的系统版本与有登录权限的账号。' : '开启 Tailscale SSH，保留现有客户端参数；仍需网络 SSH 策略允许访问。'}</div><label class="check"><input id="setup-ssh" type="checkbox" checked>开启 ${windows ? 'Windows OpenSSH' : 'Tailscale SSH'}</label>${windows ? '<label class="check"><input id="setup-rdp" type="checkbox" checked>开启远程桌面（要求 NLA）</label>' : ''}<p class="sheet-note">修改选择后，点击下方生成。脚本会显示当前系统账号和 Tailscale 地址；不会创建账号或设置密码。</p><textarea id="setup-command" class="enrollment-command mono" readonly aria-label="开启远程服务的完整命令"></textarea><div class="actions"><button class="btn" data-act="setup-copy" type="button">复制完整命令</button><button class="btn" data-act="setup-download" type="button">下载配置脚本</button></div>`, okText: '生成／更新命令', cancelText: '关闭', onOk: () => { update(); return false; } }); // 生成与执行分离，供用户检查。
  function update() { const command = remoteSetupCommands({ os, ssh: document.getElementById('setup-ssh').checked, rdp: Boolean(document.getElementById('setup-rdp')?.checked) }); document.getElementById('setup-command').value = command; return command; } // 每次复制都重新读取选项，避免使用过期脚本。
  const modal = document.getElementById('modal-root'); // 将监听器绑定到本次弹窗内的按钮。
  modal.querySelector('[data-act="setup-copy"]').onclick = () => { try { copyText(update()); } catch (error) { toast(error.message, 'err'); } }; // 兼容局域网 HTTP 的统一复制实现。
  modal.querySelector('[data-act="setup-download"]').onclick = () => { try { const command=update(), link=document.createElement('a'), url=URL.createObjectURL(new Blob([windows ? '\ufeff' + command : command], {type:'text/plain;charset=utf-8'})); link.href=url; link.download=windows?'enable-remote.ps1':'enable-tailscale-ssh.sh'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); } catch(error) { toast(error.message,'err'); } }; // Windows 脚本带 UTF-8 BOM，兼容 Windows PowerShell 5.1 中文注释。
  update(); // 首次打开直接准备默认脚本，不修改设备状态。
} // 结束独立远程配置弹窗。
