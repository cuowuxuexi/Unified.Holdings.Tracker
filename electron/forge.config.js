const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: './assets/icon', // 指定应用图标 (Forge 会自动选择 .ico/.icns)
    name: "Portfolio Tool", // 应用名称 (显示在标题栏等)
    executableName: "PortfolioTool" // Windows 下的可执行文件名
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel', // Windows (NSIS 替代品)
      config: {
        name: 'PortfolioTool', // 安装程序的名称
        setupIcon: './assets/icon.ico' // 安装程序的图标
      },
    },
    {
      name: '@electron-forge/maker-zip', // macOS 和 Linux
      platforms: ['darwin', 'linux'], // 为 Zip 包指定目标平台
    },
    // 移除了 maker-deb 和 maker-rpm 以简化配置，与文档保持一致
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
