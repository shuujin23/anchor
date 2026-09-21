const fs=require('node:fs'),path=require('node:path');
if(require('../package.json').dependencies['electron-updater'])throw new Error('Installer manual tidak mendukung updater. Jalankan npm run package atau workflow Build Windows release.');
const root=path.resolve(__dirname,'..'),appFolder=path.join(root,'release','Anchor');
const {version}=require('../package.json');
const files=[],dirs=[];
function visit(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){visit(p);dirs.push(path.relative(appFolder,p));}else files.push(path.relative(appFolder,p));}}
visit(appFolder);
const removeLines=files.map(f=>'  Delete "$INSTDIR\\'+f+'"').concat(dirs.map(d=>'  RMDir "$INSTDIR\\'+d+'"')).join('\n');
const script=String.raw`Unicode True
Name "Anchor"
OutFile "${path.join(root,'release',`Anchor-Setup-${version}.exe`)}"
InstallDir "$LOCALAPPDATA\Programs\Anchor"
RequestExecutionLevel user
SetCompressor zlib
Icon "${path.join(root,'assets','icon.ico')}"
UninstallIcon "${path.join(root,'assets','icon.ico')}"
VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "Anchor"
VIAddVersionKey "FileDescription" "Anchor personal vault and reminders"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "LegalCopyright" "Personal use"
!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Anchor.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Indonesian"
Function .onInit
  FindWindow $0 "Chrome_WidgetWin_1" "Anchor"
  StrCmp $0 0 +3
  MessageBox MB_OK "Tutup Anchor melalui system tray sebelum melanjutkan instalasi."
  Abort
FunctionEnd
Section "Anchor"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${appFolder}\*.*"
  CreateShortcut "$DESKTOP\Anchor.lnk" "$INSTDIR\Anchor.exe"
  CreateShortcut "$SMPROGRAMS\Anchor.lnk" "$INSTDIR\Anchor.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "DisplayName" "Anchor"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "DisplayIcon" "$INSTDIR\Anchor.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor" "NoRepair" 1
SectionEnd
Function un.onInit
  FindWindow $0 "Chrome_WidgetWin_1" "Anchor"
  StrCmp $0 0 +3
  MessageBox MB_OK "Tutup Anchor melalui system tray sebelum uninstall."
  Abort
FunctionEnd
Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Anchor.lnk"
  Delete "$SMPROGRAMS\Anchor.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Anchor"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anchor"
${removeLines}
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ; User data in AppData\Roaming\Anchor is intentionally retained.
SectionEnd
`;
fs.writeFileSync(path.join(root,'release','installer.nsi'),script);
console.log('Installer source generated. Only installed files are removed on uninstall.');
