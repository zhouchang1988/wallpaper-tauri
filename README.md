# wallpaper-tauri

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-blue.svg)]()
[![Built with Tauri](https://img.shields.io/badge/Tauri-2.x-24C8D8.svg)](https://v2.tauri.app/)

基于 [Tauri 2](https://v2.tauri.app/) 的 macOS 动态壁纸应用：一个无边框、鼠标穿透的窗口被压到桌面图标层之下，作为动态壁纸运行；应用本体隐藏在菜单栏托盘中，通过托盘菜单切换壁纸或退出。另附配套屏幕保护程序，锁屏时也能展示同款动态壁纸。

## 功能

- 桌面级动态壁纸（低于桌面图标、高于桌面图片的窗口层级）
- 鼠标事件穿透，不影响桌面正常使用
- 隐藏 Dock 图标，纯菜单栏后台应用
- 托盘菜单切换壁纸（单选勾选，可扩展）
- 锁屏动态壁纸：内置 .saver 屏幕保护程序，随主应用同步切换同款壁纸

## 内置壁纸

| id | 名称 | 说明 |
| --- | --- | --- |
| `storm-ship` | 风暴航船 | Three.js 实时渲染：Gerstner 波浪海面、闪电、泛光后期 |
| `pipes` | 三维水管 | 原生 WebGL2：经典 Windows 屏保重现，水管基本长满网格后清场重来 |
| `dolphins` | 海豚群 | Three.js 实时渲染：程序化建模的海豚群在深海光束与气泡中穿梭 |
| `neon-rain` | 雨夜霓虹 | Three.js 实时渲染：程序化夜城，霓虹招牌泛光闪烁、雨丝与车流、地面湿光拖影 |

## 开发

前置要求：Node.js、Rust 工具链，以及 Tauri 2 的[系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm install
npm run tauri dev
```

## 构建

```sh
saver/build.sh        # 先构建锁屏屏保 saver/build/WallpaperTauri.saver
npm run tauri build   # 再构建应用，屏保会作为 bundle 资源打进 .app
```

产物位于 `src-tauri/target/release/bundle/`。

## 锁屏动态壁纸（屏保）

锁屏属于 loginwindow 安全会话，普通窗口无法覆盖；锁屏展示通过屏幕保护程序实现（锁屏后屏保引擎会在登录窗口之上运行 .saver）。

- 应用内托盘菜单「安装锁屏屏保…」会把 `WallpaperTauri.saver` 复制到 `~/Library/Screen Savers/` 并打开系统设置，选定该屏保后锁屏即展示动态壁纸。
- 主应用切换壁纸时会把当前壁纸 id 写入共享配置文件，屏保读取后渲染同款壁纸。
- 新增/修改壁纸后需重新运行 `saver/build.sh` 并重装屏保才会生效。

## 目录结构

```
src/
  index.html                 # 壁纸加载器（iframe 全屏加载当前壁纸）
  vendor/three/              # 本地化的 Three.js 运行时
  wallpapers/<id>/           # 每款壁纸一个目录：index.html + 资源
src-tauri/
  src/lib.rs                 # 窗口桌面化、托盘菜单、壁纸注册表、屏保安装
  tauri.conf.json
saver/
  WallpaperSaverView.m       # 锁屏屏保：ScreenSaverView + WKWebView
  build.sh                   # 用 clang 直接编译 .saver 并打包壁纸资源
assets/                      # 原型 / 素材（不参与构建）
```

## 新增一款壁纸

1. 在 `src/wallpapers/<id>/` 下新建目录，提供 `index.html`（自包含页面即可，
   通过 import map 引用 `../../vendor/three/` 下的共享库）。
2. 在 `src-tauri/src/lib.rs` 的 `WALLPAPERS` 注册表中追加 `("<id>", "显示名")`。
3. 重新运行 `saver/build.sh`，让锁屏屏保也带上新壁纸。

托盘「选择壁纸」子菜单会自动出现新选项；切换通过 `wallpaper-changed` 事件通知前端加载器。

## 技术要点

- 窗口层级：`kCGDesktopIconWindowLevel - 1`（见 `lib.rs` 中 `CG_DESKTOP_WINDOW_LEVEL`），
  不能用 `kCGDesktopWindowLevel`，否则新版 macOS 上会被桌面图片压住。
- `NSWindowCollectionBehavior`：canJoinAllSpaces | stationary | ignoresCycle，
  保证壁纸在所有 Space 中常驻且不参与窗口循环。
- 托盘勾选状态与当前壁纸保存在 Rust 端 `AppState`，前端启动时通过
  `current_wallpaper` 命令获取初始值（选择目前不持久化，重启后回到默认壁纸）。

## License

[MIT](LICENSE)
