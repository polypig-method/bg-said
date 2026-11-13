// BG Said for Mac — a native window around the BG Said web app.
// - Loads the live site; falls back to the copy bundled in the app when offline.
// - While the app is running (window open or closed), checks data/latest.json every 30 minutes
//   and posts a macOS notification when a new trading day's Top 5 appears.
import AppKit
import UserNotifications
import WebKit

let siteURL = URL(string: "https://polypig-method.github.io/bg-said/")!
let dataURL = URL(string: "https://polypig-method.github.io/bg-said/data/latest.json")!
let lastSeenKey = "lastNotifiedMarketDate"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var timer: Timer?
    var showingOffline = false

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        // Make room for the window's traffic-light buttons above the sticky header.
        let css = ".top{padding-top:34px !important}"
        let js = "var s=document.createElement('style');s.textContent='\(css)';document.documentElement.appendChild(s);"
        cfg.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.setValue(false, forKey: "drawsBackground")  // no white flash in dark mode

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 880),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "BG Said"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 380, height: 520)
        window.backgroundColor = NSColor(name: nil) { a in
            a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(red: 0.059, green: 0.078, blue: 0.071, alpha: 1)
                : NSColor(red: 0.957, green: 0.945, blue: 0.918, alpha: 1)
        }
        window.contentView = web
        window.setFrameAutosaveName("BGSaidMain")
        if !window.setFrameUsingName("BGSaidMain") { window.center() }
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)

        loadLive()

        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        checkForNewTop5()
        timer = Timer.scheduledTimer(withTimeInterval: 30 * 60, repeats: true) { [weak self] _ in self?.checkForNewTop5() }
        NSApp.activate(ignoringOtherApps: true)
    }

    // Keep running in the background when the window closes, so the notification check keeps working.
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { window.makeKeyAndOrderFront(nil) }
        return true
    }

    // MARK: loading
    func loadLive(hash: String? = nil) {
        showingOffline = false
        var c = URLComponents(url: siteURL, resolvingAgainstBaseURL: false)!
        c.fragment = hash
        web.load(URLRequest(url: c.url!, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 15))
    }

    func loadOffline() {
        guard !showingOffline, let dir = Bundle.main.resourceURL?.appendingPathComponent("web"),
              FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path) else { return }
        showingOffline = true
        web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        window.subtitle = "ออฟไลน์ · ข้อมูลอาจไม่ใช่ล่าสุด"
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        if !showingOffline { window.subtitle = "" }
    }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { loadOffline() }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { loadOffline() }

    // Links to Yahoo Finance / SEC etc. open in the default browser.
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, a.navigationType == .linkActivated,
           u.scheme?.hasPrefix("http") == true, u.host != siteURL.host {
            NSWorkspace.shared.open(u)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    // MARK: notifications
    func checkForNewTop5() {
        var req = URLRequest(url: dataURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        URLSession.shared.dataTask(with: req) { data, _, _ in
            guard let data = data,
                  let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let date = j["market_date"] as? String,
                  let top = j["top5"] as? [[String: Any]], !top.isEmpty else { return }
            let d = UserDefaults.standard
            let last = d.string(forKey: lastSeenKey)
            d.set(date, forKey: lastSeenKey)
            guard let last = last, date > last else { return }  // first launch only records the date
            let lines = top.enumerated().map { i, x -> String in
                let sym = x["sym"] as? String ?? "?"
                let mos = (x["mos"] as? Double ?? 0) * 100
                return "\(i + 1). \(sym)  MOS \(Int(mos.rounded()))%"
            }
            let c = UNMutableNotificationContent()
            c.title = "BG Said · 5 หุ้นน่าศึกษา (\(date))"
            c.body = lines.joined(separator: "\n")
            c.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "top5-\(date)", content: c, trigger: nil))
            DispatchQueue.main.async { if !self.showingOffline { self.web.reload() } }
        }.resume()
    }
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification,
                                withCompletionHandler h: @escaping (UNNotificationPresentationOptions) -> Void) {
        h([.banner, .sound])
    }
    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse,
                                withCompletionHandler h: @escaping () -> Void) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        loadLive(hash: "today")
        h()
    }

    // MARK: menu
    @objc func reloadPage() { if showingOffline { loadLive() } else { web.reload() } }
    @objc func go(_ s: NSMenuItem) {
        window.makeKeyAndOrderFront(nil)
        if showingOffline { web.evaluateJavaScript("location.hash='\(s.representedObject as! String)'") }
        else { loadLive(hash: s.representedObject as? String) }
    }
    @objc func openInBrowser() { NSWorkspace.shared.open(siteURL) }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "เกี่ยวกับ BG Said", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "ซ่อน BG Said", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(.separator())
        app.addItem(withTitle: "ออกจาก BG Said", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "แก้ไข")
        edit.addItem(withTitle: "คัดลอก", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "วาง", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "เลือกทั้งหมด", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "มุมมอง")
        view.addItem(withTitle: "รีเฟรชข้อมูล", action: #selector(reloadPage), keyEquivalent: "r")
        view.addItem(.separator())
        for (i, (t, h)) in [("วันนี้", "today"), ("ทั้งหมด", "all"), ("ปรับสูตร", "lab"), ("ย้อนหลัง", "hist"), ("สูตร", "about")].enumerated() {
            let it = NSMenuItem(title: t, action: #selector(go(_:)), keyEquivalent: "\(i + 1)")
            it.representedObject = h
            view.addItem(it)
        }
        view.addItem(.separator())
        view.addItem(withTitle: "เปิดในเบราว์เซอร์", action: #selector(openInBrowser), keyEquivalent: "")
        viewItem.submenu = view

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "หน้าต่าง")
        win.addItem(withTitle: "หน้าต่าง BG Said", action: #selector(showWindow), keyEquivalent: "0")
        win.addItem(withTitle: "ย่อ", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "ปิด", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
