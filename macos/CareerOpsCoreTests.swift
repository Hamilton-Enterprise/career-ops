import Foundation
import JavaScriptCore
#if CAREER_OPS_UI_TESTS
import AppKit
import WebKit
#endif

@main
struct CareerOpsCoreTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("Career Ops tests \(UUID().uuidString)")
        try files.createDirectory(at: root.appendingPathComponent("web/.next"), withIntermediateDirectories: true)
        defer { try? files.removeItem(at: root) }
        try Data("build".utf8).write(to: root.appendingPathComponent("web/.next/BUILD_ID"))
        try Data().write(to: root.appendingPathComponent("web/server.mjs"))
        let node = root.appendingPathComponent("node with spaces")
        try Data().write(to: node)
        try files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
        let config = LaunchConfiguration(checkout: root, node: node, dataRoot: root)
        assert(validateConfiguration(config, nodeVersion: "v22.6.0") == nil)
        assert(validateConfiguration(config, nodeVersion: "v26.10.0\n") == nil)
        for version in ["v22.5.9", "v20.19.0", "v22.6.0-beta", "garbage"] {
            assert(validateConfiguration(config, nodeVersion: version) != nil, version)
        }
        try files.removeItem(at: root.appendingPathComponent("web/.next/BUILD_ID"))
        assert(validateConfiguration(config, nodeVersion: "v22.6.0") != nil)
        try Data("build".utf8).write(to: root.appendingPathComponent("web/.next/BUILD_ID"))
        assert(validateConfiguration(LaunchConfiguration(checkout: node, node: node, dataRoot: root), nodeVersion: "v22.6.0") != nil)
        assert(validateConfiguration(LaunchConfiguration(checkout: root, node: root, dataRoot: root), nodeVersion: "v22.6.0") != nil)
        assert(validateConfiguration(LaunchConfiguration(checkout: root, node: node, dataRoot: node), nodeVersion: "v22.6.0") != nil)
        assert(validateConfiguration(LaunchConfiguration(checkout: root, node: node, dataRoot: nil), nodeVersion: "v22.6.0") == nil)

        var parser = ServerURLParser()
        assert(parser.append(Data("\u{1b}[3".utf8)) == nil)
        assert(parser.append(Data("2m  - Local: http://127.0.0.1:54".utf8)) == nil)
        assert(parser.append(Data("321\u{1b}[0m\n".utf8))?.absoluteString == "http://127.0.0.1:54321")
        assert(parser.append(Data("Local: http://localhost:1234\n".utf8))?.port == 54321)
        for address in ["https://127.0.0.1:1234", "http://example.com:1234", "http://localhost:0", "http://localhost:65536", "http://localhost", "http://localhost:2evil", "http://user@localhost:1234", "http://127.0.0.1.evil:1234", "garbage"] {
            var invalid = ServerURLParser()
            assert(invalid.append(Data("Local: \(address)\n".utf8)) == nil, address)
        }
        for address in ["http://localhost:1", "http://127.0.0.1:65535"] {
            var valid = ServerURLParser()
            assert(valid.append(Data("Local: \(address)\r\n".utf8))?.absoluteString == address)
        }
        var noLocal = ServerURLParser()
        assert(noLocal.append(Data("Network: http://127.0.0.1:3427\n".utf8)) == nil)
        let origin = URL(string: "http://127.0.0.1:54321")!
        assert(navigationDisposition(URL(string: "http://127.0.0.1:54321/today?q=a#b"), origin: origin) == .internalPage)
        for address in ["http://127.0.0.1:54322/today", "http://localhost:54321", "https://127.0.0.1:54321", "https://career-ops.org", "mailto:test@example.com", "file:///tmp/example.pdf", "x-apple.systempreferences:com.apple.preference.general"] {
            assert(navigationDisposition(URL(string: address), origin: origin) == .external, address)
        }
        assert(navigationDisposition(nil, origin: origin) == .blocked)
        assert(navigationDisposition(URL(string: "/today"), origin: origin) == .blocked)
        assert(navigationDisposition(URL(string: "javascript:alert(1)"), origin: origin) == .blocked)
        let localBlob = URL(string: "blob:http://127.0.0.1:54321/conversation")!
        assert(navigationDisposition(localBlob, origin: origin) == .blocked)
        assert(navigationDisposition(localBlob, origin: origin, allowingBlobDownload: true) == .download)
        assert(navigationDisposition(URL(string: "blob:http://127.0.0.1:54322/conversation"), origin: origin,
                                     allowingBlobDownload: true) == .blocked)
        assert(navigationDisposition(URL(string: "http://127.0.0.1:54321/export"), origin: origin,
                                     allowingBlobDownload: true) == .internalPage)
        let env = serverEnvironment(config, inherited: ["CAREER_OPS_ROOT": "/wrong", "CAREER_OPS_DATA_DIR": "/wrong", "CAREER_OPS_CODE_ROOT": "/wrong", "CAREER_OPS_WEB_ALLOWED_HOSTS": "*", "PATH": "/bin"])
        assert(env["CAREER_OPS_ROOT"] == root.path)
        assert(env["CAREER_OPS_CODE_ROOT"] == root.path)
        assert(env["CAREER_OPS_DATA_DIR"] == nil && env["CAREER_OPS_WEB_ALLOWED_HOSTS"] == nil)
        assert(env["PATH"] == "\(root.path):/bin")
        let markerConfig = LaunchConfiguration(checkout: root, node: node, dataRoot: nil)
        let markerEnv = serverEnvironment(markerConfig, inherited: ["CAREER_OPS_ROOT": "/wrong", "CAREER_OPS_DATA_DIR": "/wrong", "CAREER_OPS_CODE_ROOT": "/wrong", "PATH": "/bin"])
        assert(markerEnv["CAREER_OPS_ROOT"] == nil, "An unset data root must leave marker resolution available")
        assert(markerEnv["CAREER_OPS_DATA_DIR"] == nil)
        assert(markerEnv["CAREER_OPS_CODE_ROOT"] == root.path)
        assert(markerEnv["PATH"] == "\(root.path):/bin")
        let finderPath = "/usr/bin:/bin:/usr/sbin:/sbin"
        let finderEnv = serverEnvironment(config, inherited: ["PATH": finderPath])
        assert(finderEnv["PATH"] == "\(root.path):/usr/bin:/bin:/usr/sbin:/sbin")
        let resolvedNode = finderEnv["PATH"]!.split(separator: ":").map {
            URL(fileURLWithPath: String($0)).appendingPathComponent(node.lastPathComponent)
        }.first { files.isExecutableFile(atPath: $0.path) }
        assert(resolvedNode == node)
        assert(serverEnvironment(config, inherited: [:])["PATH"] == "\(root.path):/usr/bin:/bin:/usr/sbin:/sbin")
        assert(serverEnvironment(config, inherited: ["PATH": ""])["PATH"] == "\(root.path):/usr/bin:/bin:/usr/sbin:/sbin")
        let destination = root.appendingPathComponent("download.pdf")
        assert(availableDownloadDestination(destination) == destination)
        try Data("keep this file".utf8).write(to: destination)
        assert(availableDownloadDestination(destination) == nil)
        let keptContents = try String(contentsOf: destination, encoding: .utf8)
        assert(keptContents == "keep this file")
        assert(availableDownloadDestination(root) == nil)
        assert(availableDownloadDestination(nil) == nil)
        assert(availableDownloadDestination(URL(string: "https://example.com/download.pdf")) == nil)
        let danglingLink = root.appendingPathComponent("dangling.pdf")
        try files.createSymbolicLink(atPath: danglingLink.path, withDestinationPath: root.appendingPathComponent("missing.pdf").path)
        assert(availableDownloadDestination(danglingLink) == nil)
        try testWebPreferences(root: root, node: node)
        try testRuntimeArtifact(root: root, node: node)
#if CAREER_OPS_UI_TESTS
        testJavaScriptDialogs()
        testPreferenceBridgeInWebKit()
#endif
        print("CareerOpsCore: all assertions passed")
    }

    private static func testRuntimeArtifact(root: URL, node: URL) throws {
        let files = FileManager.default
        let sha = String(repeating: "a", count: 40)
        let checkout = root.appendingPathComponent("checkout")
        let dataRoot = root.appendingPathComponent("runtime data")
        let runtime = root.appendingPathComponent("artifacts/runtime/\(sha)")
        for dir in [checkout, dataRoot, runtime] {
            try files.createDirectory(at: dir.appendingPathComponent("web/.next"), withIntermediateDirectories: true)
            try Data().write(to: dir.appendingPathComponent("web/server.mjs"))
            try Data("build".utf8).write(to: dir.appendingPathComponent("web/.next/BUILD_ID"))
        }
        let identity = runtime.appendingPathComponent("web/.next/career-ops-identity.json")
        func writeIdentity(_ value: String) throws {
            try Data(#"{"CAREER_OPS_BUILD_SHA":"\#(value)","CAREER_OPS_BUILD_VERSION":"1.35.0"}"#.utf8).write(to: identity)
        }
        try writeIdentity(sha)
        try Data(dataRoot.path.utf8).write(to: checkout.appendingPathComponent(".career-ops-data"))

        assert(runtimeArtifactProblem(runtime, buildSHA: sha) == nil)
        let chosen = resolveLaunchConfiguration(checkout: checkout, node: node, dataRoot: nil, runtimePath: runtime.path, buildSHA: sha)
        assert(chosen.notice == nil)
        assert(chosen.config.codeRoot.path == runtime.path, "A valid runtime artifact wins over the checkout preference")
        assert(chosen.config.checkout.path == checkout.path)
        assert(validateConfiguration(chosen.config, nodeVersion: "v22.6.0") == nil)
        assert(effectiveDataRoot(chosen.config).path == dataRoot.resolvingSymlinksInPath().path,
               "The data root still comes from the checkout marker, never from the artifact")
        let env = serverEnvironment(chosen.config, inherited: ["CAREER_OPS_ROOT": "/wrong", "CAREER_OPS_CODE_ROOT": "/wrong", "PATH": "/bin"])
        assert(env["CAREER_OPS_CODE_ROOT"] == runtime.path)
        assert(env["CAREER_OPS_ROOT"] == dataRoot.resolvingSymlinksInPath().path,
               "The artifact has no marker, so the data root must be passed explicitly")
        let explicitData = resolveLaunchConfiguration(checkout: checkout, node: node, dataRoot: root, runtimePath: runtime.path, buildSHA: sha)
        assert(serverEnvironment(explicitData.config, inherited: [:])["CAREER_OPS_ROOT"] == root.path)

        for runtimePath in [nil, ""] as [String?] {
            let legacy = resolveLaunchConfiguration(checkout: checkout, node: node, dataRoot: nil, runtimePath: runtimePath, buildSHA: sha)
            assert(legacy.notice == nil && legacy.config.runtime == nil && legacy.config.codeRoot.path == checkout.path)
            assert(serverEnvironment(legacy.config, inherited: [:])["CAREER_OPS_ROOT"] == nil)
        }

        func assertFallback(_ runtimePath: String, buildSHA: String?, _ label: String) {
            let fallback = resolveLaunchConfiguration(checkout: checkout, node: node, dataRoot: nil, runtimePath: runtimePath, buildSHA: buildSHA)
            assert(fallback.config.runtime == nil && fallback.config.codeRoot.path == checkout.path, label)
            assert(fallback.notice?.contains(checkout.path) == true, label)
            assert(fallback.notice?.hasPrefix("O runtime instalado") == true, label)
            assert(serverEnvironment(fallback.config, inherited: [:])["CAREER_OPS_CODE_ROOT"] == checkout.path, label)
        }
        assertFallback(root.appendingPathComponent("artifacts/runtime/missing").path, buildSHA: sha, "missing artifact")
        assertFallback("relative/runtime", buildSHA: sha, "relative path")
        assertFallback(runtime.path, buildSHA: String(repeating: "b", count: 40), "identity mismatch")
        assertFallback(runtime.path, buildSHA: nil, "bundle without identity")
        assertFallback(runtime.path, buildSHA: "", "bundle with empty identity")
        assert(runtimeArtifactProblem(runtime, buildSHA: String(repeating: "b", count: 40))?.contains("outro commit") == true)

        try writeIdentity("")
        assertFallback(runtime.path, buildSHA: sha, "artifact with empty identity")
        try Data("not json".utf8).write(to: identity)
        assertFallback(runtime.path, buildSHA: sha, "artifact with unreadable identity")
        try files.removeItem(at: identity)
        assertFallback(runtime.path, buildSHA: sha, "artifact without identity")
        try writeIdentity(sha)

        try files.removeItem(at: runtime.appendingPathComponent("web/.next/BUILD_ID"))
        assertFallback(runtime.path, buildSHA: sha, "artifact without web build")
        try Data("build".utf8).write(to: runtime.appendingPathComponent("web/.next/BUILD_ID"))
        try files.removeItem(at: runtime.appendingPathComponent("web/server.mjs"))
        assertFallback(runtime.path, buildSHA: sha, "artifact without launcher")
        try Data().write(to: runtime.appendingPathComponent("web/server.mjs"))
        try files.createDirectory(at: runtime.appendingPathComponent(".git"), withIntermediateDirectories: true)
        assertFallback(runtime.path, buildSHA: sha, "artifact that is a git checkout")
        try files.removeItem(at: runtime.appendingPathComponent(".git"))
        assert(runtimeArtifactProblem(runtime, buildSHA: sha) == nil)

        let noData = resolveLaunchConfiguration(checkout: root.appendingPathComponent("gone"), node: node, dataRoot: nil,
                                                runtimePath: runtime.path, buildSHA: sha)
        assert(noData.config.codeRoot.path == runtime.path)
        assert(validateConfiguration(noData.config, nodeVersion: "v22.6.0")?.contains("pasta de dados") == true,
               "Without a data root or checkout the artifact must not become the data root")
    }

    private static func testWebPreferences(root: URL, node: URL) throws {
        let suite = "test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let files = FileManager.default
        let dataA = root.appendingPathComponent("data A")
        let dataB = root.appendingPathComponent("data B")
        try files.createDirectory(at: dataA, withIntermediateDirectories: true)
        try files.createDirectory(at: dataB, withIntermediateDirectories: true)

        assert(effectiveDataRoot(LaunchConfiguration(checkout: root, node: node, dataRoot: dataA)).path == dataA.resolvingSymlinksInPath().path)
        assert(effectiveDataRoot(LaunchConfiguration(checkout: root, node: node, dataRoot: nil)).path == root.resolvingSymlinksInPath().path)
        try Data("  data B\n".utf8).write(to: root.appendingPathComponent(".career-ops-data"))
        assert(effectiveDataRoot(LaunchConfiguration(checkout: root, node: node, dataRoot: nil)).path == dataB.resolvingSymlinksInPath().path)
        assert(effectiveDataRoot(LaunchConfiguration(checkout: root, node: node, dataRoot: dataA)).path == dataA.resolvingSymlinksInPath().path)
        try Data(" \n".utf8).write(to: root.appendingPathComponent(".career-ops-data"))
        assert(effectiveDataRoot(LaunchConfiguration(checkout: root, node: node, dataRoot: nil)).path == root.resolvingSymlinksInPath().path)
        try files.removeItem(at: root.appendingPathComponent(".career-ops-data"))
        let viaDots = URL(fileURLWithPath: root.appendingPathComponent("data B/../data A").path)
        assert(effectiveDataRoot(LaunchConfiguration(checkout: root, node: node, dataRoot: viaDots)).path == dataA.resolvingSymlinksInPath().path)

        let config = #"{"mode":"cli","cliId":"codex","provider":"anthropic","logos":false}"#
        let shortlist = #"[{"url":"https://example.com/jobs/1","company":"Acme","role":"Engenheira"}]"#
        let hidden = #"["https://example.com/jobs/2"]"#
        for (key, value) in [("career-ops:config", config), ("career-ops:config", #"{"mode":"cli","cliId":"claude"}"#),
                             ("career-ops:config", "{}"), ("career-ops:config", #"{"mode":"key","cliId":"","logos":true}"#),
                             ("career-ops:theme", "light"), ("career-ops:theme", "dark"),
                             ("career-ops:shortlist", shortlist), ("career-ops:shortlist", "[]"),
                             ("career-ops:hidden", hidden), ("career-ops:hidden", "[]")] {
            assert(isValidWebPreference(key: key, value: value), "\(key) \(value)")
        }
        for (key, value) in [("career-ops:config", #"{"mode":"cli","cliId":"codex","apiKey":"sk-secret"}"#),
                             ("career-ops:config", #"{"mode":"cli","extra":1}"#),
                             ("career-ops:config", #"{"mode":"other"}"#), ("career-ops:config", #"{"cliId":7}"#),
                             ("career-ops:config", #"{"logos":"yes"}"#), ("career-ops:config", #"{"logos":1}"#),
                             ("career-ops:config", #"{"cliId":true}"#),
                             ("career-ops:config", "[]"), ("career-ops:config", "garbage"), ("career-ops:config", "null"),
                             ("career-ops:theme", "system"), ("career-ops:theme", #""dark""#), ("career-ops:theme", "Dark"), ("career-ops:theme", ""),
                             ("career-ops:shortlist", #"[{"url":"https://example.com/jobs/1","company":"Acme"}]"#),
                             ("career-ops:shortlist", #"[{"url":"https://example.com/jobs/1","company":"Acme","role":"R","score":4}]"#),
                             ("career-ops:shortlist", #"[{"url":1,"company":"Acme","role":"R"}]"#),
                             ("career-ops:shortlist", #"["https://example.com/jobs/1"]"#), ("career-ops:shortlist", "{}"),
                             ("career-ops:hidden", "[1]"), ("career-ops:hidden", #"[null]"#), ("career-ops:hidden", #"{"url":"x"}"#),
                             ("career-ops:chat", "[]"), ("career-ops:usage-budget", "{}")] {
            assert(!isValidWebPreference(key: key, value: value), "\(key) \(value)")
        }
        let atLimit = "[" + String(repeating: "\"\",", count: (128 * 1024 - 5) / 3) + "\"\"]"
        let padded = atLimit + String(repeating: " ", count: 128 * 1024 - atLimit.utf8.count)
        assert(padded.utf8.count == 128 * 1024 && isValidWebPreference(key: "career-ops:hidden", value: padded))
        assert(!isValidWebPreference(key: "career-ops:hidden", value: padded + " "))
        let multibyte = "[\"" + String(repeating: "é", count: 65536) + "\"]"
        assert(multibyte.count < 128 * 1024 && multibyte.utf8.count > 128 * 1024)
        assert(!isValidWebPreference(key: "career-ops:hidden", value: multibyte))

        let generation = UUID().uuidString
        let firstOrigin = URL(string: "http://127.0.0.1:54321")!
        let main = WebPreferenceSender(isOurWebView: true, isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 54321)
        func message(_ type: String, _ key: String? = nil, _ value: String? = nil, token: String? = nil) -> [String: Any] {
            var body: [String: Any] = ["type": type, "token": token ?? generation]
            if let key { body["key"] = key }
            if let value { body["value"] = value }
            return body
        }
        func change(_ body: Any, _ sender: WebPreferenceSender = main, origin: URL? = firstOrigin) -> WebPreferenceChange? {
            webPreferenceChange(body, from: sender, origin: origin, generation: generation)
        }
        assert(change(message("set", "career-ops:theme", "dark")) == .set("career-ops:theme", "dark"))
        assert(change(message("remove", "career-ops:hidden")) == .remove("career-ops:hidden"))
        assert(change(message("clear")) == .clear)
        for sender in [WebPreferenceSender(isOurWebView: false, isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 54321),
                       WebPreferenceSender(isOurWebView: true, isMainFrame: false, scheme: "http", host: "127.0.0.1", port: 54321),
                       WebPreferenceSender(isOurWebView: true, isMainFrame: true, scheme: "https", host: "127.0.0.1", port: 54321),
                       WebPreferenceSender(isOurWebView: true, isMainFrame: true, scheme: "http", host: "localhost", port: 54321),
                       WebPreferenceSender(isOurWebView: true, isMainFrame: true, scheme: "http", host: "example.com", port: 54321),
                       WebPreferenceSender(isOurWebView: true, isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 54322)] {
            assert(change(message("set", "career-ops:theme", "dark"), sender) == nil, "\(sender)")
            assert(change(message("clear"), sender) == nil, "\(sender)")
        }
        assert(change(message("set", "career-ops:theme", "dark"), origin: nil) == nil)
        assert(change(message("set", "career-ops:theme", "dark"), origin: URL(string: "http://localhost:54321")!) == nil)
        assert(change(message("set", "career-ops:theme", "dark", token: UUID().uuidString)) == nil)
        assert(change(message("clear", token: "")) == nil)
        var tokenless = message("clear")
        tokenless.removeValue(forKey: "token")
        assert(change(tokenless) == nil)
        assert(change(message("set", "career-ops:theme", "system")) == nil)
        assert(change(message("set", "career-ops:config", #"{"mode":"cli","apiKey":"sk-secret"}"#)) == nil)
        assert(change(message("set", "career-ops:chat", "[]")) == nil)
        assert(change(message("remove", "career-ops:chat")) == nil)
        assert(change(message("set", "career-ops:theme")) == nil)
        assert(change(message("explode", "career-ops:theme", "dark")) == nil)
        assert(change(["type": "set", "key": "career-ops:theme", "value": 1, "token": generation]) == nil)
        assert(change("not an object") == nil)

        let storeA = WebPreferenceStore(defaults: defaults, dataRoot: dataA)
        assert(storeA.namespace.hasPrefix("CareerOpsWebPreferences."))
        assert(storeA.namespace.range(of: #"^CareerOpsWebPreferences\.[0-9a-f]{64}$"#, options: .regularExpression) != nil)
        assert(!storeA.namespace.contains(dataA.path))
        assert(storeA.snapshot().isEmpty)
        for body in [message("set", "career-ops:config", config), message("set", "career-ops:theme", "light"),
                     message("set", "career-ops:shortlist", shortlist), message("set", "career-ops:hidden", hidden)] {
            assert(storeA.apply(change(body)!))
        }
        assert(!storeA.apply(.set("career-ops:config", #"{"apiKey":"sk-secret"}"#)))
        assert(!storeA.apply(.set("career-ops:chat", "[]")))
        assert(!storeA.apply(.remove("career-ops:chat")))

        let secondOrigin = URL(string: "http://127.0.0.1:61000")!
        let relaunched = WebPreferenceStore(defaults: defaults, dataRoot: viaDots)
        let expected = ["career-ops:config": config, "career-ops:theme": "light",
                        "career-ops:shortlist": shortlist, "career-ops:hidden": hidden]
        assert(relaunched.namespace == storeA.namespace)
        assert(relaunched.snapshot() == expected)
        let secondSender = WebPreferenceSender(isOurWebView: true, isMainFrame: true, scheme: "http", host: "127.0.0.1", port: 61000)
        assert(webPreferenceChange(message("set", "career-ops:theme", "dark"), from: secondSender, origin: secondOrigin, generation: generation) == .set("career-ops:theme", "dark"))
        assert(webPreferenceChange(message("set", "career-ops:theme", "dark"), from: main, origin: secondOrigin, generation: generation) == nil)

        let storeB = WebPreferenceStore(defaults: defaults, dataRoot: dataB)
        assert(storeB.namespace != storeA.namespace)
        assert(storeB.snapshot().isEmpty)
        assert(storeB.apply(.set("career-ops:theme", "dark")))
        assert(storeA.snapshot()["career-ops:theme"] == "light")

        assert(storeA.apply(.remove("career-ops:hidden")))
        assert(storeA.snapshot()["career-ops:hidden"] == nil && storeA.snapshot().count == 3)
        assert(storeA.apply(.clear))
        assert(storeA.snapshot().isEmpty)
        assert(storeB.snapshot() == ["career-ops:theme": "dark"])

        defaults.set(["career-ops:theme": "system", "career-ops:hidden": hidden, "career-ops:chat": "[]",
                      "career-ops:config": #"{"apiKey":"sk-secret"}"#], forKey: storeA.namespace)
        assert(storeA.snapshot() == ["career-ops:hidden": hidden])
        defaults.set("garbage", forKey: storeA.namespace)
        assert(storeA.snapshot().isEmpty)
        assert(storeA.apply(.clear))

        let hostile = "[\"https://example.com/</script><script>alert(1)</script>\",\"line\u{2028}sep\u{2029}\",\"quote\\\"back\\\\slash\"]"
        assert(isValidWebPreference(key: "career-ops:hidden", value: hostile))
        let script = webPreferenceUserScript(snapshot: ["career-ops:hidden": hostile, "career-ops:theme": "dark",
                                                        "career-ops:chat": "secret chat", "career-ops:shortlist": "invalid"],
                                             generation: generation)
        assert(!script.contains("</script>") && !script.contains("\u{2028}") && !script.contains("\u{2029}"))
        assert(!script.contains("secret chat") && !script.contains("career-ops:chat") && !script.contains("invalid"))
        assert(!script.contains(root.path) && !script.contains(dataA.path))
        assert(script.contains(generation) && script.contains(webPreferenceHandlerName))
        let payloadStart = script.range(of: "var snapshot = ")!.upperBound
        let payloadEnd = script.range(of: ";\n", range: payloadStart..<script.endIndex)!.lowerBound
        let embedded = try JSONSerialization.jsonObject(with: Data(script[payloadStart..<payloadEnd].utf8)) as? [String: Any]
        assert(embedded?["token"] as? String == generation)
        assert((embedded?["values"] as? [String: String]) == ["career-ops:hidden": hostile, "career-ops:theme": "dark"])

        let context = JSContext()!
        var exceptions: [String] = []
        context.exceptionHandler = { _, value in exceptions.append(value?.toString() ?? "?") }
        context.evaluateScript("""
            var window = this;
            function Storage() { this.d = {}; }
            Storage.prototype.getItem = function (k) { return Object.prototype.hasOwnProperty.call(this.d, k) ? this.d[k] : null; };
            Storage.prototype.setItem = function (k, v) { this.d[k] = String(v); };
            Storage.prototype.removeItem = function (k) { delete this.d[k]; };
            Storage.prototype.clear = function () { this.d = {}; };
            var localStorage = new Storage();
            var sessionStorage = new Storage();
            var posted = [];
            window.webkit = { messageHandlers: { careerOpsPrefs: { postMessage: function (m) { posted.push(JSON.stringify(m)); } } } };
            localStorage.setItem("career-ops:theme", "stale");
            localStorage.setItem("other", "kept");
            sessionStorage.setItem("career-ops:theme", "session");
            """)
        context.evaluateScript(script)
        @discardableResult func js(_ source: String) -> JSValue { context.evaluateScript(source) }
        assert(exceptions.isEmpty, exceptions.joined(separator: "\n"))
        assert(js(#"localStorage.getItem("career-ops:theme")"#).toString() == "dark")
        assert(js(#"window.localStorage.getItem("career-ops:hidden")"#).toString() == hostile)
        assert(js(#"localStorage.getItem("career-ops:config")"#).isNull)
        assert(js(#"localStorage.getItem("other")"#).toString() == "kept")
        assert(js(#"sessionStorage.getItem("career-ops:theme")"#).toString() == "session")
        js(#"localStorage.setItem("career-ops:theme", "light"); localStorage.setItem("other", "changed"); sessionStorage.setItem("career-ops:hidden", "[]")"#)
        assert(js(#"localStorage.getItem("career-ops:theme")"#).toString() == "light")
        assert(js(#"localStorage.getItem("other")"#).toString() == "changed")
        js(#"localStorage.removeItem("career-ops:hidden")"#)
        assert(js(#"localStorage.getItem("career-ops:hidden")"#).isNull)
        js("localStorage.clear()")
        assert(js(#"localStorage.getItem("career-ops:theme")"#).isNull && js(#"localStorage.getItem("other")"#).isNull)
        assert(js(#"sessionStorage.getItem("career-ops:hidden")"#).toString() == "[]")
        let posted = js("posted").toArray() as? [String] ?? []
        let messages = try posted.map { try JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any] }
        assert(messages.count == 3, "\(posted)")
        assert(messages.allSatisfy { $0["token"] as? String == generation })
        assert(change(messages[0]) == .set("career-ops:theme", "light"))
        assert(change(messages[1]) == .remove("career-ops:hidden"))
        assert(change(messages[2]) == .clear)
        assert(exceptions.isEmpty, exceptions.joined(separator: "\n"))

        let bare = JSContext()!
        bare.exceptionHandler = { _, value in exceptions.append(value?.toString() ?? "?") }
        bare.evaluateScript(script)
        assert(exceptions.isEmpty, "Without the native handler the script must leave storage alone: \(exceptions)")
    }

#if CAREER_OPS_UI_TESTS
    @MainActor
    private static func testJavaScriptDialogs() {
        _ = NSApplication.shared
        let delegate = AppDelegate()
        for selector in [
            "webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:",
            "webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:",
            "webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:",
        ] {
            assert(delegate.responds(to: NSSelectorFromString(selector)), selector)
        }
        let host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
                            styleMask: [.titled], backing: .buffered, defer: false)

        var alertCalls = 0
        presentJavaScriptAlert("Mensagem", in: host) { alertCalls += 1 }
        finishSheet(on: host, with: .alertFirstButtonReturn)
        assert(alertCalls == 1)

        var confirmation: [Bool] = []
        presentJavaScriptConfirm("Confirmar?", in: host) { confirmation.append($0) }
        finishSheet(on: host, with: .alertSecondButtonReturn)
        assert(confirmation == [false])

        presentJavaScriptConfirm("Confirmar?", in: host) { confirmation.append($0) }
        finishSheet(on: host, with: .alertFirstButtonReturn)
        assert(confirmation == [false, true])

        var answer: [String?] = []
        presentJavaScriptPrompt("Nome", defaultText: "Inicial", in: host) { answer.append($0) }
        finishSheet(on: host, with: .alertFirstButtonReturn)
        assert(answer.count == 1 && answer[0] == "Inicial")

        var cancelledAnswer: [String?] = []
        presentJavaScriptPrompt("Nome", defaultText: nil, in: host) { cancelledAnswer.append($0) }
        finishSheet(on: host, with: .alertSecondButtonReturn)
        assert(cancelledAnswer.count == 1 && cancelledAnswer[0] == nil)

        var unavailableConfirmation: [Bool] = []
        presentJavaScriptConfirm("Confirmar?", in: nil) { unavailableConfirmation.append($0) }
        assert(unavailableConfirmation == [false])
    }

    private final class PreferenceRecorder: NSObject, WKScriptMessageHandler {
        let origin: URL
        let generation: String
        weak var webView: WKWebView?
        var changes: [WebPreferenceChange?] = []
        init(origin: URL, generation: String) { self.origin = origin; self.generation = generation }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            let frame = message.frameInfo.securityOrigin
            let sender = WebPreferenceSender(isOurWebView: message.webView === webView, isMainFrame: message.frameInfo.isMainFrame,
                                             scheme: frame.protocol, host: frame.host, port: frame.port)
            changes.append(webPreferenceChange(message.body, from: sender, origin: origin, generation: generation))
        }
    }

    @MainActor
    private static func testPreferenceBridgeInWebKit() {
        let generation = UUID().uuidString
        let origin = URL(string: "http://127.0.0.1:54321/")!
        let recorder = PreferenceRecorder(origin: origin, generation: generation)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(recorder, name: webPreferenceHandlerName)
        configuration.userContentController.addUserScript(WKUserScript(
            source: webPreferenceUserScript(snapshot: ["career-ops:theme": "dark"], generation: generation),
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 320, height: 240), configuration: configuration)
        recorder.webView = webView
        let frameScript = "<script>window.webkit.messageHandlers.\(webPreferenceHandlerName).postMessage({type:'clear',token:'\(generation)'})</script>"
        webView.loadHTMLString("<!doctype html><script>window.bootTheme = localStorage.getItem('career-ops:theme')</script><iframe srcdoc=\"\(frameScript)\"></iframe>",
                               baseURL: origin)
        func spin(until done: () -> Bool) {
            let deadline = Date().addingTimeInterval(10)
            while !done() && Date() < deadline { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
        }
        func evaluate(_ source: String) -> Any? {
            var result: Any?, finished = false
            webView.evaluateJavaScript(source) { value, _ in result = value; finished = true }
            spin { finished }
            return result
        }
        spin { !webView.isLoading && recorder.changes.count == 1 }
        assert(recorder.changes.count == 1 && recorder.changes[0] == nil, "A subframe message must be rejected: \(recorder.changes)")
        assert(evaluate("window.bootTheme") as? String == "dark")
        assert(evaluate("localStorage.setItem('career-ops:theme', 'light'); localStorage.setItem('other', 'x'); localStorage.getItem('career-ops:theme')") as? String == "light")
        spin { recorder.changes.count == 2 }
        assert(recorder.changes.count == 2 && recorder.changes[1] == .set("career-ops:theme", "light"), "\(recorder.changes)")
        assert(evaluate("localStorage.getItem('other')") as? String == "x")
    }

    @MainActor
    private static func finishSheet(on host: NSWindow, with response: NSApplication.ModalResponse) {
        guard let sheet = host.attachedSheet else { assertionFailure("Expected JavaScript dialog sheet"); return }
        host.endSheet(sheet, returnCode: response)
        let deadline = Date().addingTimeInterval(1)
        while host.attachedSheet != nil && RunLoop.current.run(mode: .default, before: deadline) && Date() < deadline {}
        assert(host.attachedSheet == nil)
    }
#endif
}
