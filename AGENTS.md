# AGENTS.md

面向 AI 协作者的项目说明。

## 项目概述

wallpaper-tauri 是基于 Tauri 2 的 macOS 动态壁纸应用：无边框、鼠标穿透的窗口压到桌面图标层之下运行动态壁纸；应用隐藏在菜单栏托盘中，通过托盘菜单切换壁纸或退出。

## 常用命令

```sh
npm install            # 安装依赖（仅 @tauri-apps/cli）
npm run tauri dev      # 开发运行
saver/build.sh         # 构建锁屏屏保 saver/build/WallpaperTauri.saver（tauri build 前必须先跑）
npm run tauri build    # release 构建，产物在 src-tauri/target/release/bundle/
```

Rust 侧检查：在 `src-tauri/` 下执行 `cargo check`。

## 目录结构

```
src/
  index.html                 # 壁纸加载器：iframe 全屏加载当前壁纸，监听 wallpaper-changed 事件
  vendor/three/              # 本地化 Three.js 运行时（import map 引用 ../../vendor/three/）
  wallpapers/<id>/           # 每款壁纸一个自包含目录：index.html + 资源
src-tauri/
  src/lib.rs                 # 窗口桌面化、托盘菜单、WALLPAPERS 注册表、AppState、屏保安装
  tauri.conf.json
saver/
  WallpaperSaverView.m       # 锁屏屏保：ScreenSaverView + WKWebView 渲染同款壁纸
  Info.plist                 # .saver bundle 清单（NSPrincipalClass = WallpaperSaverView）
  build.sh                   # 用 clang 直接编译 .saver 并打包壁纸资源（无需 Xcode 工程）
assets/                      # 壁纸原型 / 素材（见下方「壁纸来源」声明）
```

## 锁屏动态壁纸（屏保）

锁屏属 loginwindow 安全会话，普通窗口无法覆盖；锁屏展示通过屏幕保护程序实现（锁屏后屏保引擎会在登录窗口之上运行 .saver）。

- `tauri.conf.json` 把 `saver/build/WallpaperTauri.saver` 作为 bundle 资源打进 .app；托盘「安装锁屏屏保…」将其复制到 `~/Library/Screen Savers/` 并打开系统设置，用户选定该屏保后锁屏即展示动态壁纸。
- 主应用启动/切换壁纸时把当前 id 写入 `~/Library/Application Support/wallpaper-tauri/current-wallpaper`；屏保读取该文件渲染同款壁纸，读取失败（沙盒）回退注册表第一项。
- 注意：屏保渲染的壁纸随 `saver/build.sh` 打包进 .saver 资源，**新增/修改壁纸后需重新运行 `saver/build.sh` 并重装屏保**才会生效。

## 新增壁纸的流程

1. 在 `src/wallpapers/<id>/` 下新建目录，提供 `index.html`（自包含页面）。
2. 在 `src-tauri/src/lib.rs` 的 `WALLPAPERS` 注册表追加 `("<id>", "显示名")`。
3. 托盘「选择壁纸」子菜单会自动出现新选项；切换通过 `wallpaper-changed` 事件通知前端。

## 壁纸来源声明

壁纸源自 `assets/` 目录中的内容，即 3D 的 Web 页面。如果要求根据 `assets/` 中的某个 HTML 页面新增壁纸，则需要：

- 去除页面中的所有文字（标题、说明、UI 文案等，只保留纯视觉内容）；
- 默认以 45 度俯视角自动圆周巡航（相机高度 = 水平半径，绕场景匀速旋转）；
- 如果用户有其他要求（例如固定视角、水平移动等），以用户的要求为准，上述两条默认规则相应让位。

## 技术要点（改动时注意）

- 窗口层级用 `kCGDesktopIconWindowLevel - 1`（lib.rs 中 `CG_DESKTOP_WINDOW_LEVEL`），不能用 `kCGDesktopWindowLevel`，否则新版 macOS 上会被桌面图片压住。
- `NSWindowCollectionBehavior` = canJoinAllSpaces | stationary | ignoresCycle，保证所有 Space 常驻。
- 托盘勾选状态与当前壁纸保存在 Rust 端 `AppState`；前端启动时通过 `current_wallpaper` 命令取初始值。选择不持久化，重启回到注册表第一项。
- 前端使用 `withGlobalTauri`（`window.__TAURI__`），无 npm 前端依赖；capabilities 仅需 `core:default`。
- 壁纸页面是独立 iframe 页面，切换即整页重载，无需实现 mount/unmount 生命周期。
- 托盘图标是单色模板图（`src-tauri/icons/tray-icon.rgba`，源文件 `assets/tray-icon.svg`），经 `icon_as_template(true)` 由系统按菜单栏明暗自动着色；重新生成：`rsvg-convert -w 64 -h 64 assets/tray-icon.svg -o src-tauri/icons/tray-icon.png && magick src-tauri/icons/tray-icon.png -depth 8 rgba:src-tauri/icons/tray-icon.rgba`。

## 约定

- 代码注释、提交信息使用中文（与现有代码一致）。
- 新增壁纸优先复用 `src/vendor/three/`，不要重复打包 Three.js。
- `assets/` 是素材/原型目录，不参与构建；构建产物只来自 `src/`（frontendDist）。
