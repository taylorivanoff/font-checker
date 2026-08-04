!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Font Checker" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --start-minimised'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Font Checker"
!macroend
