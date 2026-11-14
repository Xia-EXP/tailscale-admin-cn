@echo off
rem Keep the installer path in an environment variable to preserve spaces and Chinese directory names.
set "TSADMIN_INSTALL_SCRIPT=%~dp0install.ps1"
rem Launch the extracted installer with administrator rights and wait for its result.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -NoExit -File ""' + $env:TSADMIN_INSTALL_SCRIPT + '""')"
