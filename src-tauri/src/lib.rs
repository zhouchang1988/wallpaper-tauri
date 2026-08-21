use std::sync::Mutex;

use tauri::{
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

/// 壁纸注册表：(id, 显示名)。
/// 新增壁纸时在此追加一项，并在 `src/wallpapers/<id>/` 下放置同名前端页面即可，
/// 托盘菜单会自动出现对应选项。
const WALLPAPERS: &[(&str, &str)] = &[
    ("storm-ship", "风暴航船"),
    ("pipes", "三维水管"),
    ("dolphins", "海豚群"),
    ("cloud-sea", "云海日出"),
];

/// 默认壁纸（注册表第一项）
const DEFAULT_WALLPAPER: &str = WALLPAPERS[0].0;

/// 托盘菜单项 id 前缀，例如 `wallpaper:storm-ship`
const WALLPAPER_MENU_PREFIX: &str = "wallpaper:";

/// 前端加载壁纸页面的相对路径模板：`src/wallpapers/<id>/index.html`
const WALLPAPER_EVENT: &str = "wallpaper-changed";

struct AppState {
    current: Mutex<String>,
    items: Vec<CheckMenuItem<tauri::Wry>>,
}

/// 前端启动时查询当前壁纸 id
#[tauri::command]
fn current_wallpaper(state: tauri::State<AppState>) -> String {
    state.current.lock().unwrap().clone()
}

/// 切换壁纸：更新状态与勾选，并通知前端重新加载
fn select_wallpaper(app: &tauri::AppHandle, id: &str) {
    if !WALLPAPERS.iter().any(|(wid, _)| *wid == id) {
        return;
    }
    let state = app.state::<AppState>();
    *state.current.lock().unwrap() = id.to_string();
    #[cfg(target_os = "macos")]
    write_shared_wallpaper_id(id);
    for item in &state.items {
        let checked = item.id().as_ref() == format!("{WALLPAPER_MENU_PREFIX}{id}");
        let _ = item.set_checked(checked);
    }
    let _ = app.emit_to("main", WALLPAPER_EVENT, id);
}

/// kCGDesktopIconWindowLevel - 1：比桌面图标低一级、但在桌面壁纸之上。
/// 注意不能用 kCGDesktopWindowLevel（-2147483646），它与桌面壁纸窗口同级，
/// 新版 macOS 上会被压在桌面图片后面导致不可见。
#[cfg(target_os = "macos")]
const CG_DESKTOP_WINDOW_LEVEL: i64 = -2147483605;

/// NSWindowCollectionBehavior：canJoinAllSpaces | stationary | ignoresCycle
#[cfg(target_os = "macos")]
const WALLPAPER_COLLECTION_BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 6);

#[cfg(target_os = "macos")]
fn pin_window_to_desktop(window: &tauri::WebviewWindow) {
    use objc::{msg_send, sel, sel_impl};

    let ns_window = window.ns_window().unwrap() as *mut objc::runtime::Object;
    unsafe {
        let _: () = msg_send![ns_window, setLevel: CG_DESKTOP_WINDOW_LEVEL];
        let _: () = msg_send![ns_window, setCollectionBehavior: WALLPAPER_COLLECTION_BEHAVIOR];
        let _: () = msg_send![ns_window, setHasShadow: false];
    }
}

/// 把当前壁纸 id 写入共享文件，供锁屏屏保（saver/）进程在锁屏时读取，
/// 使锁屏与桌面展示同一款壁纸。
#[cfg(target_os = "macos")]
fn write_shared_wallpaper_id(id: &str) {
    if let Ok(home) = std::env::var("HOME") {
        let dir = std::path::Path::new(&home).join("Library/Application Support/wallpaper-tauri");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("current-wallpaper"), id);
    }
}

/// 安装锁屏屏保：把随包携带的 WallpaperTauri.saver 复制到
/// `~/Library/Screen Savers/`，并打开系统设置的屏保面板。
/// 屏保由系统屏保引擎托管，锁屏时会在登录窗口之上运行。
#[cfg(target_os = "macos")]
fn install_saver(app: &tauri::AppHandle) {
    use std::path::PathBuf;
    use std::process::Command;

    // 优先取 .app 内资源；开发环境下回退到源码目录的构建产物
    let src = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("WallpaperTauri.saver"))
        .filter(|p| p.exists())
        .or_else(|| {
            let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../saver/build/WallpaperTauri.saver");
            dev.exists().then_some(dev)
        });
    let Some(src) = src else {
        eprintln!("未找到 WallpaperTauri.saver，请先运行 saver/build.sh");
        return;
    };

    let Ok(home) = std::env::var("HOME") else {
        return;
    };
    let dest = PathBuf::from(home).join("Library/Screen Savers/WallpaperTauri.saver");
    let _ = std::fs::remove_dir_all(&dest);
    let installed = Command::new("cp")
        .arg("-R")
        .arg(&src)
        .arg(&dest)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if installed {
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension")
            .status();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![current_wallpaper])
        .setup(|app| {
            // 隐藏 Dock 图标，成为纯菜单栏后台应用
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app.get_webview_window("main").unwrap();

            // 铺满主显示器
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let size = monitor.size();
                let pos = monitor.position();
                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: size.width,
                    height: size.height,
                }));
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition { x: pos.x, y: pos.y },
                ));
            }

            // 鼠标事件穿透到桌面（点击、拖拽都直接落在桌面图标上）
            let _ = window.set_ignore_cursor_events(true);

            // 压到桌面层级，作为动态壁纸
            #[cfg(target_os = "macos")]
            pin_window_to_desktop(&window);

            // 同步当前壁纸 id，供锁屏屏保读取
            #[cfg(target_os = "macos")]
            write_shared_wallpaper_id(DEFAULT_WALLPAPER);

            // 托盘菜单：壁纸选择子菜单 + 退出
            let mut items = Vec::with_capacity(WALLPAPERS.len());
            let mut builder = SubmenuBuilder::new(app, "选择壁纸");
            for (id, label) in WALLPAPERS {
                let item = CheckMenuItemBuilder::with_id(
                    format!("{WALLPAPER_MENU_PREFIX}{id}"),
                    label,
                )
                .checked(*id == DEFAULT_WALLPAPER)
                .build(app)?;
                builder = builder.item(&item);
                items.push(item);
            }
            let picker = builder.build()?;
            let install =
                MenuItemBuilder::with_id("install-saver", "安装锁屏屏保…").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出动态壁纸").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&picker, &install, &quit]).build()?;

            app.manage(AppState {
                current: Mutex::new(DEFAULT_WALLPAPER.to_string()),
                items,
            });

            // 托盘图标用单色剪影并标记为 template image：macOS 会按菜单栏
            // 明暗自动渲染为白色/深色，与系统图标风格一致（应用图标保持彩色）
            // tray-icon.rgba 由 assets/tray-icon.svg 生成：rsvg-convert → PNG → magick 转 RGBA
            let tray_icon = tauri::image::Image::new(include_bytes!("../icons/tray-icon.rgba"), 64, 64);
            let mut tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("wallpaper-tauri")
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id == "quit" {
                        app.exit(0);
                    } else if id == "install-saver" {
                        #[cfg(target_os = "macos")]
                        install_saver(app);
                    } else if let Some(wid) = id.strip_prefix(WALLPAPER_MENU_PREFIX) {
                        select_wallpaper(app, wid);
                    }
                });
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon_as_template(true);
            }
            tray.build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
