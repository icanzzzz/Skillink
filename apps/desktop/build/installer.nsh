!include "WinMessages.nsh"

!ifdef BUILD_UNINSTALLER
  Var SkillinkDeleteDataState
  Var SkillinkDeleteDataCheckbox
!endif

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

# Parse options before any uninstaller page is shown. This covers silent uninstalls,
# where the custom page below never runs.
!macro SkillinkParseUninstallOptions
  StrCpy $SkillinkDeleteDataState "0"

  ${GetParameters} $R0

  # Keep the electron-builder flag working: it already removes Electron's
  # %APPDATA%\Skillink directory, and now also removes Skillink's data directory.
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    StrCpy $SkillinkDeleteDataState "1"
  ${EndIf}

  ${GetOptions} $R0 "--delete-skillink-data" $R1
  ${IfNot} ${Errors}
    StrCpy $SkillinkDeleteDataState "1"
  ${EndIf}
!macroend

!macro customUnInit
  !insertmacro SkillinkParseUninstallOptions
!macroend

# Replace the default uninstaller welcome page with a page that lets the user
# choose whether %USERPROFILE%\.agents\skillink should be removed.
!macro customUnWelcomePage
  UninstPage custom un.skillinkDeleteDataPageCreate un.skillinkDeleteDataPageLeave

  Function un.skillinkDeleteDataPageCreate
    !insertmacro MUI_HEADER_TEXT "Uninstall Skillink" "Choose whether to delete your Skillink data."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 12u "Skillink stores its data in:"
    Pop $0
    ${NSD_CreateLabel} 0 14u 100% 12u "$PROFILE\.agents\skillink"
    Pop $0
    ${NSD_CreateCheckbox} 0 36u 100% 12u "Delete Skillink data and configuration"
    Pop $SkillinkDeleteDataCheckbox
    ${If} $SkillinkDeleteDataState == "1"
      ${NSD_Check} $SkillinkDeleteDataCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 12u 52u 100% 32u "This removes skills, packages, routes, history, settings, and language packs. This cannot be undone. Leave unchecked to keep your data for a future installation."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function un.skillinkDeleteDataPageLeave
    ${NSD_GetState} $SkillinkDeleteDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $SkillinkDeleteDataState "1"
    ${Else}
      StrCpy $SkillinkDeleteDataState "0"
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  !insertmacro RunCliPathScript add
  !insertmacro InstallBundledLanguagePack
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  !insertmacro RunCliPathScript remove

  # Never remove user data while the installer is replacing an existing version.
  ${IfNot} ${isUpdated}
    ${If} $SkillinkDeleteDataState == "1"
      DetailPrint "Deleting Skillink data from $PROFILE\.agents\skillink"
      RMDir /r "$PROFILE\.agents\skillink"
    ${EndIf}
  ${EndIf}

  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
