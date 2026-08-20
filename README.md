# wallpaper-tauri

基于 [Tauri 2](https://v2.tauri.app/) 的 macOS 动态壁纸应用：一个无边框、鼠标穿透的窗口被压到桌面图标层之下，作为动态壁纸运行；应用本体隐藏在菜单栏托盘中，通过托盘菜单切换壁纸或退出。

## 功能

- 桌面级动态壁纸（低于桌面图标、高于桌面图片的窗口层级）
- 鼠标事件穿透，不影响桌面正常使用
- 隐藏 Dock 图标，纯菜单栏后台应用
- 托盘菜单切换壁纸（单选勾选，可扩展）

## 内置壁纸

| id | 名称 | 说明 |
| --- | --- | --- |
| `storm-ship` | 风暴航船 | Three.js 实时渲染：Gerstner 波浪海面、闪电、泛光后期 |
| `pipes` | 三维水管 | 原生 WebGL2：经典 Windows 屏保重现，水管基本长满网格后清场重来 |

## 开发

前置要求：Node.js、Rust 工具链，以及 Tauri 2 的[系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm install
npm run tauri dev
```

## 构建

```sh
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`。

## 目录结构

```
src/
  index.html                 # 壁纸加载器（iframe 全屏加载当前壁纸）
  vendor/three/              # 本地化的 Three.js 运行时
  wallpapers/
    storm-ship/              # 每款壁纸一个目录：index.html + 资源
src-tauri/
  src/lib.rs                 # 窗口桌面化、托盘菜单、壁纸注册表
  tauri.conf.json
assets/                      # 原型 / 素材
```

## 新增一款壁纸

1. 在 `src/wallpapers/<id>/` 下新建目录，提供 `index.html`（自包含页面即可，
   通过 import map 引用 `../../vendor/three/` 下的共享库）。
2. 在 `src-tauri/src/lib.rs` 的 `WALLPAPERS` 注册表中追加 `("<id>", "显示名")`。

托盘「选择壁纸」子菜单会自动出现新选项；切换通过 `wallpaper-changed` 事件通知前端加载器。

## 技术要点

- 窗口层级：`kCGDesktopIconWindowLevel - 1`（见 `lib.rs` 中 `CG_DESKTOP_WINDOW_LEVEL`），
  不能用 `kCGDesktopWindowLevel`，否则新版 macOS 上会被桌面图片压住。
- `NSWindowCollectionBehavior`：canJoinAllSpaces | stationary | ignoresCycle，
  保证壁纸在所有 Space 中常驻且不参与窗口循环。
- 托盘勾选状态与当前壁纸保存在 Rust 端 `AppState`，前端启动时通过
  `current_wallpaper` 命令获取初始值（选择目前不持久化，重启后回到默认壁纸）。
