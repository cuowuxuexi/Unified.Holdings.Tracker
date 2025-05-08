[Setup]
AppName=Portfolio Management Tool
AppVersion=1.0.0
DefaultDirName={pf}\PortfolioTool
DefaultGroupName=Portfolio Tool
OutputDir=release
OutputBaseFilename=Unified.Holdings.Tracker
SetupIconFile=electron\assets\icon.ico

[Files]
Source: "final-release\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\Portfolio Tool"; Filename: "{app}\portfolio-launcher.exe"
Name: "{commondesktop}\Portfolio Tool"; Filename: "{app}\portfolio-launcher.exe"

[Run]
Filename: "{app}\portfolio-launcher.exe"; Description: "Launch Portfolio Tool"; Flags: postinstall nowait