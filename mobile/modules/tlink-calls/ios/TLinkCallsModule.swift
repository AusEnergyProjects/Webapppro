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
  let callerName: String
  let answerToken: String?
  var payload: [String: Any] {
    var value: [String: Any] = ["callId": uuid.uuidString.lowercased(), "threadId": threadId, "mode": mode, "expiresAt": expiresAt, "callerName": callerName]
    if let answerToken { value["answerToken"] = answerToken }
    return value
  }
  func connecting() -> TLinkCall {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return TLinkCall(uuid: uuid, threadId: threadId, mode: mode, expiresAt: formatter.string(from: Date().addingTimeInterval(45)), callerName: callerName, answerToken: answerToken)
  }
  static func parse(_ data: [String: Any]) -> TLinkCall? {
    guard let callId = data["callId"] as? String, let uuid = UUID(uuidString: callId),
      let threadId = data["threadId"] as? String,
      threadId.range(of: "^[a-zA-Z0-9_-]{8,120}$", options: .regularExpression) != nil,
      let mode = data["mode"] as? String, ["audio", "video"].contains(mode),
      let expiresAt = data["expiresAt"] as? String, let expiry = date(expiresAt), expiry > Date()
    else { return nil }
    let name = (data["callerName"] as? String ?? "").components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
    let token = (data["answerToken"] as? String).flatMap { $0.isEmpty || $0.count > 4096 ? nil : $0 }
    return TLinkCall(uuid: uuid, threadId: threadId, mode: mode, expiresAt: expiresAt,
      callerName: name.isEmpty ? "Team call" : String(name.prefix(120)),
      answerToken: token)
  }
  static func date(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
  static func rejectionReason(_ data: [String: Any]) -> TLinkCallDiagnostic.Rejection? {
    // Explain the same ordered checks as parse above. This diagnostic never
    // decides whether a call is accepted or changes the existing expiry check.
    guard let id = data["callId"] as? String, UUID(uuidString: id) != nil else { return .invalidCallId }
    guard let thread = data["threadId"] as? String,
      thread.range(of: "^[a-zA-Z0-9_-]{8,120}$", options: .regularExpression) != nil else { return .invalidThreadId }
    guard let mode = data["mode"] as? String, ["audio", "video"].contains(mode) else { return .invalidMode }
    guard let expiry = data["expiresAt"] as? String, let deadline = date(expiry) else { return .invalidExpiry }
    return deadline > Date() ? nil : .expired
  }
}

// This short local history survives a locked-screen launch without reading any
// account credentials. Only these fixed facts can cross the diagnostics bridge.
private struct TLinkCallDiagnostic: Codable {
  enum Stage: String, Codable {
    case nativeStart = "native_start", configurationChanged = "configuration_changed"
    case pushReceived = "push_received", pushRejected = "push_rejected"
    case callReported = "call_reported", callReportFailed = "call_report_failed"
    case duplicateReported = "duplicate_reported", duplicateReportFailed = "duplicate_report_failed"
  }
  enum Rejection: String, Codable {
    case disabled, invalidCallId = "invalid_call_id", invalidThreadId = "invalid_thread_id"
    case invalidMode = "invalid_mode", invalidExpiry = "invalid_expiry", expired
  }
  enum AppState: String, Codable { case active, inactive, background, unknown }
  enum ErrorDomain: String, Codable { case callkitIncoming = "callkit_incoming", other }
  let timestamp: String
  let stage: Stage
  let localEnabled: Bool
  let appState: AppState
  let managedCallCount: Int
  let managedConnectedCount: Int
  let systemCallCount: Int
  let systemConnectedCount: Int
  let rejectionReason: Rejection?
  let errorDomain: ErrorDomain?
  let errorCode: Int?
  var payload: [String: Any] {
    var value: [String: Any] = ["timestamp": timestamp, "stage": stage.rawValue,
      "localEnabled": localEnabled, "appState": appState.rawValue,
      "managedCallCount": managedCallCount, "managedConnectedCount": managedConnectedCount,
      "systemCallCount": systemCallCount, "systemConnectedCount": systemConnectedCount]
    if let rejectionReason { value["rejectionReason"] = rejectionReason.rawValue }
    if let errorDomain { value["errorDomain"] = errorDomain.rawValue }
    if let errorCode { value["errorCode"] = errorCode }
    return value
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
  private var timers: [UUID: Timer] = [:]
  private var events: [[String: Any]] = []
  private var connectedCalls: Set<UUID> = []
  private var outgoingCalls: Set<UUID> = []
  private var ringExpiredCalls: Set<UUID> = []
  private var acceptedCalls: Set<UUID> = []
  private var pendingAnswers: [UUID: CXAnswerCallAction] = [:]
  private var serverJoinedCalls: Set<UUID> = []
  private var heartbeat: Timer?
  private var ringback: AVAudioPlayer?
  private var audioActive = false
  var notify: (() -> Void)?
  var tokenChanged: (() -> Void)?
  private(set) var token = ""
  private var enabled: Bool { UserDefaults.standard.bool(forKey: "tlink.nativeCalls.enabled") }
  private let diagnosticsKey = "tlink.nativeCalls.diagnostics.v1"

  private func recentDiagnostics() -> [TLinkCallDiagnostic] {
    let saved = UserDefaults.standard.data(forKey: diagnosticsKey)
      .flatMap { try? JSONDecoder().decode([TLinkCallDiagnostic].self, from: $0) } ?? []
    let now = Date()
    return Array(saved.filter {
      guard let date = TLinkCall.date($0.timestamp) else { return false }
      return date <= now && now.timeIntervalSince(date) <= 24 * 60 * 60
    }.suffix(12))
  }
  private func saveDiagnostics(_ events: [TLinkCallDiagnostic]) {
    if let data = try? JSONEncoder().encode(events) { UserDefaults.standard.set(data, forKey: diagnosticsKey) }
  }
  func diagnostics() -> [[String: Any]] {
    return recentDiagnostics().map { $0.payload }
  }
  private func recordDiagnostic(_ stage: TLinkCallDiagnostic.Stage,
    rejection: TLinkCallDiagnostic.Rejection? = nil, error: Error? = nil) {
    let timestamp = Date()
    // Reporting CallKit and completing PushKit must never wait for preference
    // storage. Main-queue FIFO preserves event order after those immediate calls.
    DispatchQueue.main.async {
      self.persistDiagnostic(stage, timestamp: timestamp, rejection: rejection, error: error)
    }
  }
  private func persistDiagnostic(_ stage: TLinkCallDiagnostic.Stage, timestamp: Date,
    rejection: TLinkCallDiagnostic.Rejection?, error: Error?) {
    // PushKit, the module bridge and CallKit's delegate/completion queue are
    // all main. Keep UIKit reads and this bounded history on that same queue.
    let state: TLinkCallDiagnostic.AppState
    switch UIApplication.shared.applicationState {
    case .active: state = .active
    case .inactive: state = .inactive
    case .background: state = .background
    @unknown default: state = .unknown
    }
    let systemCalls = controller.callObserver.calls.filter { !$0.hasEnded }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let failure = error.map { $0 as NSError }
    let event = TLinkCallDiagnostic(timestamp: formatter.string(from: timestamp), stage: stage,
      localEnabled: enabled, appState: state,
      managedCallCount: min(32, calls.count), managedConnectedCount: min(32, connectedCalls.count),
      systemCallCount: min(32, systemCalls.count), systemConnectedCount: min(32, systemCalls.filter { $0.hasConnected }.count),
      rejectionReason: rejection,
      errorDomain: failure.map { $0.domain == CXErrorDomainIncomingCall ? .callkitIncoming : .other },
      errorCode: failure.map { (0...100).contains($0.code) ? $0.code : -1 })
    saveDiagnostics(Array((recentDiagnostics() + [event]).suffix(12)))
  }

  private override init() {
    let configuration = CXProviderConfiguration()
    configuration.supportsVideo = true
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    configuration.includesCallsInRecents = false
    configuration.ringtoneSound = "TLinkIncoming.wav"
    provider = CXProvider(configuration: configuration)
    super.init()
    provider.setDelegate(self, queue: .main)
    RTCAudioSession.sharedInstance().useManualAudio = true
    RTCAudioSession.sharedInstance().isAudioEnabled = false
  }

  func start() {
    guard registry == nil else { return }
    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    self.registry = registry
    if enabled { registry.desiredPushTypes = [.voIP] }
    recordDiagnostic(.nativeStart)
  }
  func configure(_ enabled: Bool, preserveActiveCalls: Bool) {
    let changed = self.enabled != enabled
    UserDefaults.standard.set(enabled, forKey: "tlink.nativeCalls.enabled")
    start()
    registry?.desiredPushTypes = enabled ? [.voIP] : []
    if changed { recordDiagnostic(.configurationChanged) }
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
    recordDiagnostic(.pushReceived)
    guard enabled, let call = TLinkCall.parse(data) else {
      recordDiagnostic(.pushRejected, rejection: enabled ? TLinkCall.rejectionReason(data) : .disabled)
      // Even an expired VoIP notification must be reported to CallKit. End it
      // immediately and never queue an answer or access protected account data.
      let id = UUID(uuidString: data["callId"] as? String ?? "") ?? UUID()
      let update = CXCallUpdate()
      update.remoteHandle = CXHandle(type: .generic, value: "TLink")
      provider.reportNewIncomingCall(with: id, update: update) { error in
        self.recordDiagnostic(error == nil ? .callReported : .callReportFailed, error: error)
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
    return events
  }
  func acknowledge(_ ids: [String]) {
    let delivered = Set(ids)
    events.removeAll { event in (event["id"] as? String).map { delivered.contains($0) } ?? false }
  }
  func incoming(_ data: [String: Any]) throws {
    guard let call = TLinkCall.parse(data) else { throw CallError.invalid }
    if calls[call.uuid] != nil {
      // A JS refresh must not replace the accepted deadline or the push token.
      let update = CXCallUpdate()
      update.localizedCallerName = call.callerName
      provider.reportCall(with: call.uuid, updated: update)
      return
    }
    incoming(call, completion: {})
  }
  private func incoming(_ call: TLinkCall, completion: @escaping () -> Void) {
    let update = CXCallUpdate()
    update.remoteHandle = CXHandle(type: .generic, value: call.callerName)
    update.localizedCallerName = call.callerName
    update.hasVideo = call.mode == "video"
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false
    if calls[call.uuid] != nil {
      // Every PushKit delivery is reported, including a duplicate UUID. The
      // system rejects duplicate presentation; do not queue a second answer.
      provider.reportNewIncomingCall(with: call.uuid, update: update) { error in
        self.recordDiagnostic(error == nil ? .duplicateReported : .duplicateReportFailed, error: error)
        completion()
      }
      return
    }
    calls[call.uuid] = call
    provider.reportNewIncomingCall(with: call.uuid, update: update) { error in
      self.recordDiagnostic(error == nil ? .callReported : .callReportFailed, error: error)
      if error != nil { self.calls.removeValue(forKey: call.uuid) }
      else {
        self.enqueue("incoming", call)
        self.expireUnconnected(call, after: min(45, TLinkCall.date(call.expiresAt)!.timeIntervalSinceNow))
      }
      completion()
    }
  }
  func outgoing(_ data: [String: Any]) throws {
    guard let call = TLinkCall.parse(data) else { throw CallError.invalid }
    if calls[call.uuid] != nil { return }
    calls[call.uuid] = call
    let action = CXStartCallAction(call: call.uuid, handle: CXHandle(type: .generic, value: call.callerName))
    outgoingCalls.insert(call.uuid)
    timers[call.uuid] = Timer.scheduledTimer(withTimeInterval: max(1, min(45, TLinkCall.date(call.expiresAt)!.timeIntervalSinceNow)), repeats: false) { _ in
      guard self.calls[call.uuid] != nil, !self.acceptedCalls.contains(call.uuid), !self.connectedCalls.contains(call.uuid) else { return }
      // Stop audible ringing at45 seconds, but let the final authenticated
      // status response confirm an Answer that happened just before deadline.
      self.ringExpiredCalls.insert(call.uuid)
      self.refreshRingback()
      self.expireUnconnected(call, after: 5)
      self.enqueue("heartbeat", call)
    }
    action.isVideo = call.mode == "video"
    controller.request(CXTransaction(action: action)) { error in
      if error != nil { self.end(call.uuid, reason: .failed) }
    }
  }
  func answer(_ value: String) throws {
    guard let uuid = UUID(uuidString: value), calls[uuid] != nil else { throw CallError.invalid }
    serverJoinedCalls.insert(uuid)
    // Acceptance stops the caller's ringback, but SDP/ICE may still be pending.
    // Return to JS immediately so it can create tracks and negotiate transport.
    // Fulfilling here would start the system call timer before a connection.
    completeAnswerIfReady(uuid)
    if acceptedCalls.contains(uuid) { return }
    controller.request(CXTransaction(action: CXAnswerCallAction(call: uuid))) { error in
      if error != nil { self.end(uuid, reason: .failed) }
    }
  }
  private func completeAnswerIfReady(_ id: UUID) {
    guard serverJoinedCalls.contains(id), connectedCalls.contains(id),
      let action = pendingAnswers.removeValue(forKey: id) else { return }
    timers.removeValue(forKey: id)?.invalidate()
    // This is transport readiness, not an audio-activation callback. CallKit
    // can now activate audio in didActivate; waiting for captured/received audio
    // before fulfilling would deadlock manual WebRTC audio on a locked phone.
    action.fulfill(withDateConnected: Date())
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
  private func expireUnconnected(_ call: TLinkCall, after seconds: TimeInterval) {
    timers.removeValue(forKey: call.uuid)?.invalidate()
    timers[call.uuid] = Timer.scheduledTimer(withTimeInterval: max(1, seconds), repeats: false) { _ in
      if !self.connectedCalls.contains(call.uuid) { self.end(call.uuid, reason: .unanswered) }
    }
  }
  private func prepareRingback() throws {
    guard let url = Bundle.main.url(forResource: "TLinkRingback", withExtension: "wav") else { throw CallError.missingSound }
    ringback = try AVAudioPlayer(contentsOf: url)
    ringback?.numberOfLoops = -1
    ringback?.volume = 0.65
    // prepareToPlay activates AVAudioSession too. Let play prepare it only
    // after CallKit's didActivate callback has granted the call audio session.
  }
  private func refreshRingback() {
    if audioActive && outgoingCalls.contains(where: { !ringExpiredCalls.contains($0) && !acceptedCalls.contains($0) && !connectedCalls.contains($0) }) { ringback?.play() }
    else { ringback?.pause() }
  }
  func connecting(_ value: String) {
    guard let id = UUID(uuidString: value), let call = calls[id],
      outgoingCalls.contains(id), !acceptedCalls.contains(id), !connectedCalls.contains(id) else { return }
    acceptedCalls.insert(id)
    let joining = call.connecting()
    calls[id] = joining
    expireUnconnected(joining, after: 45)
    refreshRingback()
  }
  func connected(_ value: String) {
    guard let id = UUID(uuidString: value), let call = calls[id] else { return }
    guard connectedCalls.insert(id).inserted else { return }
    timers.removeValue(forKey: id)?.invalidate()
    let update = CXCallUpdate()
    update.localizedCallerName = call.callerName
    provider.reportCall(with: id, updated: update)
    refreshRingback()
    if outgoingCalls.contains(id) { provider.reportOutgoingCall(with: id, connectedAt: Date()) }
    else { completeAnswerIfReady(id) }
  }
  func end(_ value: String) { if let id = UUID(uuidString: value) { end(id, reason: .remoteEnded) } }
  private func end(_ id: UUID, reason: CXCallEndedReason) {
    guard let call = calls.removeValue(forKey: id) else { return }
    timers.removeValue(forKey: id)?.invalidate()
    connectedCalls.remove(id)
    outgoingCalls.remove(id)
    ringExpiredCalls.remove(id)
    acceptedCalls.remove(id)
    serverJoinedCalls.remove(id)
    pendingAnswers.removeValue(forKey: id)?.fail()
    refreshRingback()
    provider.reportCall(with: id, endedAt: Date(), reason: reason)
    enqueue("end", call)
    if calls.isEmpty { heartbeat?.invalidate(); heartbeat = nil; ringback = nil }
  }
  func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
    do { try prepareAudio(); try prepareRingback(); action.fulfill(); provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date()); refreshRingback() }
    catch { action.fail(); end(action.callUUID, reason: .failed) }
  }
  func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    guard let call = calls[action.callUUID], let date = TLinkCall.date(call.expiresAt), date > Date() else { action.fail(); return }
    acceptedCalls.insert(call.uuid)
    do { try prepareAudio() } catch { action.fail(); end(action.callUUID, reason: .failed); return }
    // Keep both lock-screen and in-app answers pending until authenticated
    // acceptance and WebRTC transport readiness. Track creation and SDP/ICE
    // negotiation do not require the audio unit to be activated first.
    pendingAnswers[call.uuid] = action
    let joining = call.connecting()
    calls[call.uuid] = joining
    expireUnconnected(joining, after: 45)
    enqueue("answer", joining)
    // Transport can become ready before an in-app CXAnswerCallAction reaches
    // this delegate. Reconcile here too instead of leaving that action pending.
    completeAnswerIfReady(call.uuid)
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
    audioActive = true
    RTCAudioSession.sharedInstance().audioSessionDidActivate(audioSession)
    RTCAudioSession.sharedInstance().isAudioEnabled = true
    refreshRingback()
  }
  func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    audioActive = false
    refreshRingback()
    RTCAudioSession.sharedInstance().isAudioEnabled = false
    RTCAudioSession.sharedInstance().audioSessionDidDeactivate(audioSession)
  }
  func speaker(_ enabled: Bool) throws { try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none) }
  enum CallError: Error { case invalid, missingSound }
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
    AsyncFunction("diagnostics") { TLinkCallCoordinator.shared.diagnostics() }.runOnQueue(.main)
    AsyncFunction("drainEvents") { TLinkCallCoordinator.shared.drain() }.runOnQueue(.main)
    AsyncFunction("acknowledgeEvents") { (ids: [String]) in TLinkCallCoordinator.shared.acknowledge(ids) }.runOnQueue(.main)
    AsyncFunction("incoming") { (call: [String: Any]) in try TLinkCallCoordinator.shared.incoming(call) }.runOnQueue(.main)
    AsyncFunction("outgoing") { (call: [String: Any]) in try TLinkCallCoordinator.shared.outgoing(call) }.runOnQueue(.main)
    AsyncFunction("connecting") { (id: String) in TLinkCallCoordinator.shared.connecting(id) }.runOnQueue(.main)
    AsyncFunction("answer") { (id: String) in try TLinkCallCoordinator.shared.answer(id) }.runOnQueue(.main)
    AsyncFunction("connected") { (id: String) in TLinkCallCoordinator.shared.connected(id) }.runOnQueue(.main)
    AsyncFunction("end") { (id: String) in TLinkCallCoordinator.shared.end(id) }.runOnQueue(.main)
    AsyncFunction("speaker") { (enabled: Bool) in try TLinkCallCoordinator.shared.speaker(enabled) }.runOnQueue(.main)
  }
}
