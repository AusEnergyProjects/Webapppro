import ExpoModulesCore
import CallKit
import PushKit
import AVFoundation
import WebRTC

private struct TLinkCall {
  let uuid: UUID
  let threadId: String
  let mode: String
  let expiresAt: String
  var payload: [String: Any] {
    ["callId": uuid.uuidString.lowercased(), "threadId": threadId, "mode": mode, "expiresAt": expiresAt]
  }
  static func parse(_ data: [String: Any]) -> TLinkCall? {
    guard let callId = data["callId"] as? String, let uuid = UUID(uuidString: callId),
      let threadId = data["threadId"] as? String,
      threadId.range(of: "^[a-zA-Z0-9_-]{8,120}$", options: .regularExpression) != nil,
      let mode = data["mode"] as? String, ["audio", "video"].contains(mode),
      let expiresAt = data["expiresAt"] as? String, let expiry = date(expiresAt), expiry > Date()
    else { return nil }
    return TLinkCall(uuid: uuid, threadId: threadId, mode: mode, expiresAt: expiresAt)
  }
  static func date(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
}

// Created before the React Native bridge. PushKit must report CallKit promptly,
// including a cold launch; authentication and accepting media remain in JS.
private final class TLinkCallCoordinator: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
  static let shared = TLinkCallCoordinator()
  private let provider: CXProvider
  private let controller = CXCallController(queue: .main)
  private var registry: PKPushRegistry?
  private var calls: [UUID: TLinkCall] = [:]
  private var answers: [UUID: CXAnswerCallAction] = [:]
  private var timers: [UUID: Timer] = [:]
  private var events: [[String: Any]] = []
  private var connectedCalls: Set<UUID> = []
  private var outgoingCalls: Set<UUID> = []
  private var acceptedCalls: Set<UUID> = []
  private var heartbeat: Timer?
  var notify: (() -> Void)?
  var tokenChanged: (() -> Void)?
  private(set) var token = ""
  private var enabled: Bool { UserDefaults.standard.bool(forKey: "tlink.nativeCalls.enabled") }

  private override init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = true
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    configuration.includesCallsInRecents = false
    provider = CXProvider(configuration: configuration)
    super.init()
    provider.setDelegate(self, queue: .main)
    RTCAudioSession.sharedInstance().useManualAudio = true
  }

  func start() {
    guard registry == nil else { return }
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    self.registry = registry
    if enabled { registry.desiredPushTypes = [.voIP] }
  }
  func configure(_ enabled: Bool, preserveActiveCalls: Bool) {
    UserDefaults.standard.set(enabled, forKey: "tlink.nativeCalls.enabled")
    start()
    registry?.desiredPushTypes = enabled ? [.voIP] : []
    if !enabled {
      for id in Array(calls.keys) {
        if !preserveActiveCalls || (!acceptedCalls.contains(id) && !outgoingCalls.contains(id)) { end(id, reason: .remoteEnded) }
      }
      if !preserveActiveCalls { events.removeAll() }
      token = ""
    }
  }
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    tokenChanged?()
  }
  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    token = ""
    tokenChanged?()
  }
  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    let data = payload.dictionaryPayload.reduce(into: [String: Any]()) { result, entry in
      if let key = entry.key as? String { result[key] = entry.value }
    }
    guard type == .voIP else { completion(); return }
    guard enabled, let call = TLinkCall.parse(data) else {
      // Even an expired VoIP notification must be reported to CallKit. End it
      // immediately and never queue an answer or access protected account data.
      let id = UUID(uuidString: data["callId"] as? String ?? "") ?? UUID()
      let update = CXCallUpdate()
      update.remoteHandle = CXHandle(type: .generic, value: "TLink")
      provider.reportNewIncomingCall(with: id, update: update) { _ in
        self.provider.reportCall(with: id, endedAt: Date(), reason: .remoteEnded)
        completion()
      }
      return
    }
    incoming(call, completion: completion)
  }
  private func enqueue(_ type: String, _ call: TLinkCall, muted: Bool? = nil) {
    var event = call.payload
    event["id"] = UUID().uuidString
    event["type"] = type
    if let muted { event["muted"] = muted }
    events.append(event)
    if events.count > 32 { events.removeFirst(events.count - 32) }
    notify?()
  }
  func drain() -> [[String: Any]] {
    let pending = events
    events.removeAll()
    return pending
  }
  func incoming(_ data: [String: Any]) throws {
    guard let call = TLinkCall.parse(data) else { throw CallError.invalid }
    if calls[call.uuid] != nil { calls[call.uuid] = call; return }
    incoming(call, completion: {})
  }
  private func incoming(_ call: TLinkCall, completion: @escaping () -> Void) {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: "TLink team")
    update.localizedCallerName = "TLink"
    update.hasVideo = call.mode == "video"
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    if calls[call.uuid] != nil {
      // Every PushKit delivery is reported, including a duplicate UUID. The
      // system rejects duplicate presentation; do not queue a second answer.
      provider.reportNewIncomingCall(with: call.uuid, update: update) { _ in completion() }
      return
    }
    calls[call.uuid] = call
    provider.reportNewIncomingCall(with: call.uuid, update: update) { error in
      if error != nil { self.calls.removeValue(forKey: call.uuid) }
      else {
        self.enqueue("incoming", call)
        let delay = max(1, min(90, TLinkCall.date(call.expiresAt)!.timeIntervalSinceNow))
        self.timers[call.uuid] = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
          if !self.connectedCalls.contains(call.uuid) { self.end(call.uuid, reason: .unanswered) }
        }
      }
      completion()
    }
  }
  func outgoing(_ data: [String: Any]) throws {
    guard let call = TLinkCall.parse(data) else { throw CallError.invalid }
    if calls[call.uuid] != nil { return }
    calls[call.uuid] = call
    let action = CXStartCallAction(call: call.uuid, handle: CXHandle(type: .generic, value: "TLink team"))
    outgoingCalls.insert(call.uuid)
    action.isVideo = call.mode == "video"
    controller.request(CXTransaction(action: action)) { error in
      if error != nil { self.end(call.uuid, reason: .failed) }
    }
  }
  func answer(_ value: String) throws {
    guard let uuid = UUID(uuidString: value), calls[uuid] != nil else { throw CallError.invalid }
    if let action = answers.removeValue(forKey: uuid) { action.fulfill(); return }
    controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { error in
      if error != nil { self.end(uuid, reason: .failed) }
    }
  }
  private func prepareAudio() throws {
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
    RTCAudioSession.sharedInstance().useManualAudio = true
    if heartbeat == nil {
      heartbeat = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { _ in
        for call in self.calls.values { self.enqueue("heartbeat", call) }
      }
    }
    // CallKit activates the audio session. Do not call setActive here.
  }
  func connected(_ value: String) {
    guard let id = UUID(uuidString: value), calls[id] != nil else { return }
    connectedCalls.insert(id)
    timers.removeValue(forKey: id)?.invalidate()
    answers.removeValue(forKey: id)?.fulfill()
    if outgoingCalls.contains(id) { provider.reportOutgoingCall(with: id, connectedAt: Date()) }
  }
  func end(_ value: String) { if let id = UUID(uuidString: value) { end(id, reason: .remoteEnded) } }
  private func end(_ id: UUID, reason: CXCallEndedReason) {
    guard let call = calls.removeValue(forKey: id) else { return }
    timers.removeValue(forKey: id)?.invalidate()
    answers.removeValue(forKey: id)?.fail()
    connectedCalls.remove(id)
    outgoingCalls.remove(id)
    acceptedCalls.remove(id)
    provider.reportCall(with: id, endedAt: Date(), reason: reason)
    enqueue("end", call)
    if calls.isEmpty { heartbeat?.invalidate(); heartbeat = nil }
  }
  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    do { try prepareAudio(); action.fulfill(); provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date()) }
    catch { action.fail(); end(action.callUUID, reason: .failed) }
  }
  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let call = calls[action.callUUID], let date = TLinkCall.date(call.expiresAt), date > Date() else { action.fail(); return }
    acceptedCalls.insert(call.uuid)
    do { try prepareAudio() } catch { action.fail(); end(action.callUUID, reason: .failed); return }
    if !UIApplication.shared.isProtectedDataAvailable {
      let update = CXCallUpdate()
      update.localizedCallerName = "Unlock iPhone and open TLink to answer"
      provider.reportCall(with: call.uuid, updated: update)
    }
    answers[action.callUUID] = action
    enqueue("answer", call)
  }
  func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    end(action.callUUID, reason: .remoteEnded)
    action.fulfill()
  }
  func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    guard let call = calls[action.callUUID] else { action.fail(); return }
    enqueue("mute", call, muted: action.isMuted)
    action.fulfill()
  }
  func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
    if let callAction = action as? CXCallAction { end(callAction.callUUID, reason: .failed) }
  }
  func providerDidReset(_ provider: CXProvider) {
    for id in Array(calls.keys) { end(id, reason: .failed) }
  }
  func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    RTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
    RTCAudioSession.sharedInstance().isAudioEnabled = true
  }
  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    RTCAudioSession.sharedInstance().isAudioEnabled = false
    RTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
  }
  func speaker(_ enabled: Bool) throws { try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none) }
  enum CallError: Error { case invalid }
}

public final class TLinkCallsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    TLinkCallCoordinator.shared.start()
    return true
  }
  public func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    if userInfo["type"] as? String == "team_call_ended", let id = userInfo["callId"] as? String {
      TLinkCallCoordinator.shared.end(id)
    }
    completionHandler(.noData)
  }
}

public final class TLinkCallsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TLinkCalls")
    Events("callEvent", "tokenChanged")
    OnCreate {
      DispatchQueue.main.async {
        TLinkCallCoordinator.shared.notify = { [weak self] in self?.sendEvent("callEvent", [:]) }
        TLinkCallCoordinator.shared.tokenChanged = { [weak self] in self?.sendEvent("tokenChanged", [:]) }
      }
    }
    AsyncFunction("configure") { (enabled: Bool, preserveActiveCalls: Bool) in TLinkCallCoordinator.shared.configure(enabled, preserveActiveCalls: preserveActiveCalls) }.runOnQueue(.main)
    AsyncFunction("registration") { ["voipPushToken": TLinkCallCoordinator.shared.token, "nativeCallCapable": true] as [String: Any] }.runOnQueue(.main)
    AsyncFunction("drainEvents") { TLinkCallCoordinator.shared.drain() }.runOnQueue(.main)
    AsyncFunction("incoming") { (call: [String: Any]) in try TLinkCallCoordinator.shared.incoming(call) }.runOnQueue(.main)
    AsyncFunction("outgoing") { (call: [String: Any]) in try TLinkCallCoordinator.shared.outgoing(call) }.runOnQueue(.main)
    AsyncFunction("answer") { (id: String) in try TLinkCallCoordinator.shared.answer(id) }.runOnQueue(.main)
    AsyncFunction("connected") { (id: String) in TLinkCallCoordinator.shared.connected(id) }.runOnQueue(.main)
    AsyncFunction("end") { (id: String) in TLinkCallCoordinator.shared.end(id) }.runOnQueue(.main)
    AsyncFunction("speaker") { (enabled: Bool) in try TLinkCallCoordinator.shared.speaker(enabled) }.runOnQueue(.main)
  }
}
