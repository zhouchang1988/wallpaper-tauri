#!/bin/sh
# 构建锁屏屏保 WallpaperTauri.saver（供「锁屏时展示动态壁纸」使用）。
# 用法：saver/build.sh
# 产物：saver/build/WallpaperTauri.saver；`npm run tauri build` 会把它打进 .app 资源。
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/saver/build/WallpaperTauri.saver"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

# .saver 本质是 BNDL bundle，直接用 clang 编译，无需 Xcode 工程
clang -fobjc-arc -fmodules -O2 -bundle \
    -Wno-deprecated-declarations \
    -framework Foundation -framework AppKit -framework ScreenSaver -framework WebKit \
    -o "$OUT/Contents/MacOS/WallpaperTauri" \
    "$ROOT/saver/WallpaperSaverView.m"

cp "$ROOT/saver/Info.plist" "$OUT/Contents/Info.plist"

# 壁纸页面与 Three.js 运行库原样打包，保持相对路径结构（wallpapers/<id>/ 与 vendor/ 同级）
rsync -a --delete "$ROOT/src/wallpapers" "$ROOT/src/vendor" "$OUT/Contents/Resources/"

# Apple Silicon 要求可执行文件带签名，使用 ad-hoc 签名
codesign --force --sign - "$OUT"

echo "Built: $OUT"
