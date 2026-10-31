!include "WinMessages.nsh"

!macro RunCliPathScript Action
  StrCpy $R0 "$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -ExecutionPolicy Bypass -File $\"$INSTDIR\resources\cli\skillink-path.ps1$\" ${Action} $\"$INSTDIR\resources\cli$\""
  nsExec::ExecToStack "$R0"
  Pop $0
  Pop $1
!macroend

!macro InstallBundledLanguagePack
  StrCpy $R0 "$PROFILE\.agents\skillink\locales"
  IfFileExists "$R0\zh-cn.json" SkillinkLanguagePackDone
  IfFileExists "$INSTDIR\resources\locales\zh-CN.json" 0 SkillinkLanguagePackDone
  CreateDirectory "$PROFILE\.agents\skillink"
  CreateDirectory "$R0"
  CopyFiles /SILENT "$INSTDIR\resources\locales\zh-CN.json" "$R0\zh-cn.json"
SkillinkLanguagePackDone:
!macroend

!macro customInstall
  !insertmacro RunCliPathScript add
  !insertmacro InstallBundledLanguagePack
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  !insertmacro RunCliPathScript remove
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
