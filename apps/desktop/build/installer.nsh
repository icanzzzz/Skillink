!include "WinMessages.nsh"

!macro RunCliPathScript Action
  StrCpy $R0 "$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\resources\cli\skillink-path.ps1$\" ${Action} $\"$INSTDIR\resources\cli$\""
  nsExec::ExecToStack "$R0"
  Pop $0
  Pop $1
!macroend

!macro customInstall
  !insertmacro RunCliPathScript add
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  !insertmacro RunCliPathScript remove
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
