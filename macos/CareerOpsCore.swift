import CryptoKit
import Foundation

struct LaunchConfiguration {
    let checkout: URL
    let node: URL
    let dataRoot: URL?
}

func validateConfiguration(_ config: LaunchConfiguration, nodeVersion: String? = nil) -> String? {
    let files = FileManager.default
    func isDirectory(_ url: URL) -> Bool {
        var directory: ObjCBool = false
        return url.isFileURL && files.fileExists(atPath: url.path, isDirectory: &directory) && directory.boolValue
    }
    guard isDirectory(config.checkout) else { return "A pasta do projeto não existe: \(config.checkout.path). Escolha a pasta Career Ops." }
    guard files.isReadableFile(atPath: config.checkout.appendingPathComponent("web/server.mjs").path) else {
        return "A pasta escolhida não contém web/server.mjs. Escolha a pasta Career Ops."
    }
    guard files.isReadableFile(atPath: config.checkout.appendingPathComponent("web/.next/BUILD_ID").path) else {
        return "Falta a compilação web em \(config.checkout.path)/web. Execute npm run build nessa pasta e tente novamente."
    }
    guard config.node.isFileURL, !isDirectory(config.node), files.isExecutableFile(atPath: config.node.path) else {
        return "O executável Node não existe ou não pode ser executado: \(config.node.path). Escolha o executável Node."
    }
    if let root = config.dataRoot, !isDirectory(root) || !files.isReadableFile(atPath: root.path) {
        return "A pasta de dados não existe ou não pode ser lida: \(root.path). Escolha a pasta de dados."
    }
    if let nodeVersion {
        let value = nodeVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^v?\d+\.\d+\.\d+$"#, options: .regularExpression) != nil else {
            return "Não foi possível confirmar a versão do Node. Escolha um executável Node 22.6.0 ou posterior."
        }
        let parts = value.drop(while: { $0 == "v" }).split(separator: ".").compactMap { Int($0) }
        guard parts.count == 3, !parts.lexicographicallyPrecedes([22, 6, 0]) else {
            return "O Node \(value) é demasiado antigo. É necessário Node 22.6.0 ou posterior."
        }
    }
    return nil
}

struct ServerURLParser {
    private var buffer = Data()
    private(set) var url: URL?

    mutating func append(_ chunk: Data) -> URL? {
        if let url { return url }
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 10) {
            let line = String(decoding: buffer[..<newline], as: UTF8.self)
                .replacingOccurrences(of: #"\x1B\[[0-?]*[ -/]*[@-~]"#, with: "", options: .regularExpression)
            buffer.removeSubrange(...newline)
            guard let marker = line.range(of: "Local:") else { continue }
            let address = line[marker.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
            guard let components = URLComponents(string: address), components.scheme == "http",
                  ["localhost", "127.0.0.1"].contains(components.host ?? ""),
                  let port = components.port, (1...65535).contains(port),
                  components.user == nil, components.password == nil,
                  components.path.isEmpty || components.path == "/",
                  components.query == nil, components.fragment == nil,
                  let parsed = components.url else { continue }
            url = parsed
            return parsed
        }
        // ponytail: retain at most one 64 KiB line; increase only if Next emits longer startup lines.
        if buffer.count > 65536 { buffer.removeAll(keepingCapacity: true) }
        return nil
    }
}

enum NavigationDisposition { case internalPage, download, external, blocked }

func navigationDisposition(_ url: URL?, origin: URL,
                           allowingBlobDownload: Bool = false) -> NavigationDisposition {
    guard let url, let scheme = url.scheme?.lowercased() else { return .blocked }
    if scheme == "blob" {
        guard allowingBlobDownload,
              let embedded = URL(string: String(url.absoluteString.dropFirst("blob:".count))),
              embedded.user == nil, embedded.password == nil,
              embedded.scheme == origin.scheme, embedded.host == origin.host, embedded.port == origin.port else {
            return .blocked
        }
        return .download
    }
    guard !["javascript", "data", "about"].contains(scheme) else { return .blocked }
    if ["http", "https"].contains(scheme), url.host == nil { return .blocked }
    if url.user == nil, url.password == nil, scheme == origin.scheme,
       url.host == origin.host, url.port == origin.port { return .internalPage }
    return .external
}

func serverEnvironment(_ config: LaunchConfiguration, inherited: [String: String]) -> [String: String] {
    var environment = inherited
    for key in ["CAREER_OPS_WEB_ALLOWED_HOSTS", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_CODE_ROOT"] {
        environment.removeValue(forKey: key)
    }
    if let dataRoot = config.dataRoot { environment["CAREER_OPS_ROOT"] = dataRoot.path }
    environment["CAREER_OPS_CODE_ROOT"] = config.checkout.path
    let path = inherited["PATH"].flatMap { $0.isEmpty ? nil : $0 } ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    environment["PATH"] = "\(config.node.deletingLastPathComponent().path):\(path)"
    return environment
}

func availableDownloadDestination(_ proposed: URL?) -> URL? {
    guard let proposed, proposed.isFileURL,
          !FileManager.default.fileExists(atPath: proposed.path),
          (try? FileManager.default.destinationOfSymbolicLink(atPath: proposed.path)) == nil else { return nil }
    return proposed
}

func effectiveDataRoot(_ config: LaunchConfiguration) -> URL {
    func canonical(_ url: URL) -> URL { url.standardizedFileURL.resolvingSymlinksInPath() }
    if let root = config.dataRoot { return canonical(root) }
    let marker = config.checkout.appendingPathComponent(".career-ops-data")
    if let content = try? String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
       !content.isEmpty {
        return canonical(content.hasPrefix("/") ? URL(fileURLWithPath: content) : config.checkout.appendingPathComponent(content))
    }
    return canonical(config.checkout)
}

let webPreferenceHandlerName = "careerOpsPrefs"
let webPreferenceKeys = ["career-ops:config", "career-ops:theme", "career-ops:shortlist", "career-ops:hidden"]
let webPreferenceMaxBytes = 128 * 1024

func isValidWebPreference(key: String, value: String) -> Bool {
    guard webPreferenceKeys.contains(key), value.utf8.count <= webPreferenceMaxBytes else { return false }
    if key == "career-ops:theme" { return value == "light" || value == "dark" }
    guard let parsed = try? JSONSerialization.jsonObject(with: Data(value.utf8)) else { return false }
    func isBoolean(_ value: Any) -> Bool {
        guard let number = value as? NSNumber else { return false }
        return CFGetTypeID(number) == CFBooleanGetTypeID()
    }
    switch key {
    case "career-ops:config":
        guard let object = parsed as? [String: Any] else { return false }
        return object.allSatisfy { field, value in
            switch field {
            case "mode": return ["cli", "key", "manual"].contains(value as? String ?? "")
            case "cliId", "provider": return value is String
            case "logos": return isBoolean(value)
            default: return false
            }
        }
    case "career-ops:shortlist":
        guard let items = parsed as? [Any] else { return false }
        return items.allSatisfy { item in
            guard let fields = item as? [String: Any] else { return false }
            return Set(fields.keys) == ["url", "company", "role"] && fields.values.allSatisfy { $0 is String }
        }
    default:
        return (parsed as? [Any])?.allSatisfy { $0 is String } ?? false
    }
}

enum WebPreferenceChange: Equatable {
    case set(String, String)
    case remove(String)
    case clear
}

struct WebPreferenceSender {
    let isOurWebView: Bool
    let isMainFrame: Bool
    let scheme: String
    let host: String
    let port: Int
}

func webPreferenceChange(_ body: Any, from sender: WebPreferenceSender, origin: URL?, generation: String) -> WebPreferenceChange? {
    guard sender.isOurWebView, sender.isMainFrame, let origin, origin.scheme == "http", origin.host == "127.0.0.1",
          let port = origin.port, sender.scheme == "http", sender.host == "127.0.0.1", sender.port == port,
          !generation.isEmpty, let message = body as? [String: Any], message["token"] as? String == generation,
          let type = message["type"] as? String else { return nil }
    let key = message["key"] as? String
    switch type {
    case "set":
        guard let key, let value = message["value"] as? String, isValidWebPreference(key: key, value: value) else { return nil }
        return .set(key, value)
    case "remove":
        guard let key, webPreferenceKeys.contains(key) else { return nil }
        return .remove(key)
    case "clear": return .clear
    default: return nil
    }
}

final class WebPreferenceStore {
    let namespace: String
    private let defaults: UserDefaults

    init(defaults: UserDefaults, dataRoot: URL) {
        self.defaults = defaults
        let path = dataRoot.standardizedFileURL.resolvingSymlinksInPath().path
        namespace = "CareerOpsWebPreferences." + SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func snapshot() -> [String: String] {
        let stored = defaults.dictionary(forKey: namespace)?.compactMapValues { $0 as? String } ?? [:]
        return stored.filter { isValidWebPreference(key: $0.key, value: $0.value) }
    }

    @discardableResult
    func apply(_ change: WebPreferenceChange) -> Bool {
        var values = snapshot()
        switch change {
        case let .set(key, value):
            guard isValidWebPreference(key: key, value: value) else { return false }
            values[key] = value
        case let .remove(key):
            guard webPreferenceKeys.contains(key) else { return false }
            values.removeValue(forKey: key)
        case .clear: values.removeAll()
        }
        if values.isEmpty { defaults.removeObject(forKey: namespace) } else { defaults.set(values, forKey: namespace) }
        return true
    }
}

// The page sees only the four allowlisted values and the launch token. JSONSerialization escapes
// "/" (so no "</script>"); U+2028/U+2029 are escaped too so the literal stays one JS line.
func webPreferenceUserScript(snapshot: [String: String], generation: String) -> String {
    let values = snapshot.filter { isValidWebPreference(key: $0.key, value: $0.value) }
    let data = (try? JSONSerialization.data(withJSONObject: ["token": generation, "values": values], options: [.sortedKeys])) ?? Data()
    let payload = String(decoding: data, as: UTF8.self)
        .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
        .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    let keys = String(decoding: (try? JSONSerialization.data(withJSONObject: webPreferenceKeys)) ?? Data(), as: UTF8.self)
    return """
    (function () {
      "use strict";
      var snapshot = \(payload.isEmpty ? #"{"token":"","values":{}}"# : payload);
      var keys = \(keys);
      var handler, storage, proto;
      try {
        handler = window.webkit.messageHandlers.\(webPreferenceHandlerName);
        storage = window.localStorage;
        proto = Object.getPrototypeOf(storage);
      } catch (error) { return; }
      if (!handler || !storage || !proto) return;
      var values = Object.create(null);
      Object.keys(snapshot.values).forEach(function (key) { values[key] = snapshot.values[key]; });
      var getItem = proto.getItem, setItem = proto.setItem, removeItem = proto.removeItem, clear = proto.clear;
      function managed(target, key) { return target === storage && keys.indexOf(String(key)) !== -1; }
      function post(message) {
        message.token = snapshot.token;
        try { handler.postMessage(message); } catch (error) {}
      }
      proto.getItem = function (key) {
        if (!managed(this, key)) return getItem.apply(this, arguments);
        key = String(key);
        return key in values ? values[key] : null;
      };
      proto.setItem = function (key, value) {
        if (!managed(this, key)) return setItem.apply(this, arguments);
        key = String(key);
        values[key] = String(value);
        post({ type: "set", key: key, value: values[key] });
      };
      proto.removeItem = function (key) {
        if (!managed(this, key)) return removeItem.apply(this, arguments);
        key = String(key);
        delete values[key];
        post({ type: "remove", key: key });
      };
      proto.clear = function () {
        if (this !== storage) return clear.apply(this, arguments);
        values = Object.create(null);
        post({ type: "clear" });
        return clear.apply(this, arguments);
      };
    })();
    """
}
