#!/bin/bash
# Builds "BG Said.app" + BG Said.dmg with Command Line Tools only (no Xcode needed).
#   ./mac/build.sh [version]
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${1:-1.0}"
APP="build/BG Said.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"

swiftc -O -swift-version 5 -target arm64-apple-macos14.0 Sources/main.swift -o "$APP/Contents/MacOS/BGSaid"

# offline copy of the web app (used only when the live site can't be reached)
rsync -a --exclude 'data/history/' ../docs/ "$APP/Contents/Resources/web/"

# icon: the app's SVG at 80% on a 1024 canvas (macOS icon grid)
qlmanage -t -s 824 -o build ../docs/icon.svg >/dev/null 2>&1
sips --padToHeightWidth 1024 1024 build/icon.svg.png --out build/icon.png >/dev/null
mkdir build/AppIcon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.png --out build/AppIcon.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s*2)) $((s*2)) build/icon.png --out build/AppIcon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<P
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>BG Said</string>
<key>CFBundleDisplayName</key><string>BG Said</string>
<key>CFBundleIdentifier</key><string>local.bgsaid.app</string>
<key>CFBundleExecutable</key><string>BGSaid</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.finance</string>
<key>NSHumanReadableCopyright</key><string>Graham formula screener · ไม่ใช่คำแนะนำการลงทุน</string>
</dict></plist>
P
codesign --force --deep -s - "$APP"

rm -rf build/dmg && mkdir build/dmg && cp -R "$APP" build/dmg/ && ln -s /Applications build/dmg/Applications
rm -f "../BG Said.dmg"
hdiutil create -volname "BG Said" -srcfolder build/dmg -ov -format UDZO "../BG Said.dmg" >/dev/null
echo "built: $(cd .. && pwd)/BG Said.dmg (v$VERSION)"
