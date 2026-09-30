package au.com.australianenergyassessments.calls

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.*
import android.view.Gravity
import android.widget.*
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

private const val CHANNEL = "tlink-native-calls"
private const val ONGOING_CHANNEL = "tlink-ongoing-calls"
private const val NOTIFICATION_ID = 81742
private const val ONGOING_ID = 81743
private const val PREFS = "tlink-native-calls"
private const val ANSWER = "tlink.call.ANSWER"
private const val END = "tlink.call.END"
private fun expiryMillis(value: String): Long {
  val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US)
  formatter.isLenient = false
  return formatter.parse(value)?.time ?: 0L
}

internal data class Call(val callId: String, val threadId: String, val mode: String, val expiresAt: String) {
  fun json() = JSONObject(mapOf("callId" to callId, "threadId" to threadId, "mode" to mode, "expiresAt" to expiresAt))
  fun connecting(): Call {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US)
    formatter.timeZone = java.util.TimeZone.getTimeZone("UTC")
    return copy(expiresAt = formatter.format(java.util.Date(System.currentTimeMillis() + 45_000)))
  }
  companion object {
    fun parse(value: JSONObject, allowExpired: Boolean = false): Call? = try {
      val id = value.getString("callId")
      val thread = value.getString("threadId")
      val mode = value.getString("mode")
      val expires = value.getString("expiresAt")
      if (UUID.fromString(id).toString() != id.lowercase() || !Regex("^[a-zA-Z0-9_-]{8,120}$").matches(thread)
        || mode !in listOf("audio", "video") || (!allowExpired && expiryMillis(expires) <= System.currentTimeMillis())) null
      else Call(id, thread, mode, expires)
    } catch (_: Exception) { null }
  }
}

internal object Calls {
  var changed: (() -> Unit)? = null
  private val handler = Handler(Looper.getMainLooper())
  private var initialized = false
  private var ringback: ToneGenerator? = null
  private var outgoingId: String? = null
  private var awaitingAnswerId: String? = null
  private var connectingId: String? = null
  @Synchronized private fun prefs(context: Context): android.content.SharedPreferences {
    val storage = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!initialized) {
      initialized = true
      // A new process cannot restore the old process's WebRTC media. Preserve
      // pending incoming/Answer events, but never let a dead ongoing call block
      // new invitations for the remainder of its one-hour server lease.
      if (storage.getBoolean("ongoing", false)) {
        storage.edit().remove("call").remove("events").remove("answerUntil").putBoolean("ongoing", false).apply()
        context.getSystemService(NotificationManager::class.java).cancel(ONGOING_ID)
      }
    }
    return storage
  }
  private fun stored(context: Context): Call? = try {
    Call.parse(JSONObject(prefs(context).getString("call", "")!!), allowExpired = true)
  } catch (_: Exception) { null }
  fun current(context: Context): Call? {
    val storage = prefs(context)
    // expiresAt is the invitation deadline, not a connected call's lifetime.
    return stored(context)?.takeIf { expiryMillis(it.expiresAt) > System.currentTimeMillis()
      || storage.getBoolean("ongoing", false) || storage.getLong("answerUntil", 0) > System.currentTimeMillis() }
  }
  fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)
  @Synchronized fun enqueue(context: Context, type: String, call: Call) {
    val queue = JSONArray(prefs(context).getString("events", "[]"))
    val event = call.json().put("id", UUID.randomUUID().toString()).put("type", type)
    val next = JSONArray()
    for (i in maxOf(0, queue.length() - 31) until queue.length()) next.put(queue.getJSONObject(i))
    next.put(event)
    prefs(context).edit().putString("events", next.toString()).apply()
    handler.post { changed?.invoke() }
  }
  @Synchronized fun drain(context: Context): List<Map<String, Any>> {
    val queue = JSONArray(prefs(context).getString("events", "[]"))
    prefs(context).edit().remove("events").apply()
    return (0 until queue.length()).map { index ->
      val value = queue.getJSONObject(index)
      value.keys().asSequence().associateWith { value.get(it) }
    }
  }
  @Synchronized fun configure(context: Context, enabled: Boolean, preserveActiveCalls: Boolean) {
    prefs(context).edit().putBoolean("enabled", enabled).apply()
    if (!enabled && !(preserveActiveCalls && prefs(context).getBoolean("ongoing", false))) {
      current(context)?.let { end(context, it.callId) }
      prefs(context).edit().remove("events").remove("call").apply()
    }
  }
  private fun channels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = NotificationChannel(CHANNEL, "Incoming team calls", NotificationManager.IMPORTANCE_HIGH)
    channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
    channel.enableVibration(true)
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    manager.createNotificationChannel(channel)
    manager.createNotificationChannel(NotificationChannel(ONGOING_CHANNEL, "Ongoing team calls", NotificationManager.IMPORTANCE_LOW))
  }
  private fun activity(context: Context, call: Call, action: String, request: Int): PendingIntent {
    val intent = Intent(context, TLinkIncomingCallActivity::class.java).setAction(action).putExtra("call", call.json().toString())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
  private fun endAction(context: Context, call: Call): PendingIntent = PendingIntent.getBroadcast(context, 3,
    Intent(context, TLinkCallActionReceiver::class.java).setAction(END).putExtra("callId", call.callId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  @Synchronized fun incoming(context: Context, call: Call, fromPush: Boolean = false) {
    if (fromPush && !enabled(context)) return
    val current = current(context)
    if (current != null && current.callId == call.callId) {
      if (!prefs(context).getBoolean("ongoing", false)) prefs(context).edit().putString("call", call.json().toString()).apply()
      return
    }
    if (current != null) return // One system call owns the phone's audio session.
    channels(context)
    prefs(context).edit().putString("call", call.json().toString()).putBoolean("ongoing", false).remove("answerUntil").apply()
    val answer = activity(context, call, ANSWER, 1)
    val open = activity(context, call, "tlink.call.SHOW", 2)
    val person = Person.Builder().setName("TLink team").setImportant(true).build()
    val remaining = (expiryMillis(call.expiresAt) - System.currentTimeMillis()).coerceIn(1, 45_000)
    val builder = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(context.applicationInfo.icon).setContentTitle("TLink")
      .setContentText(if (call.mode == "video") "Incoming team video call" else "Incoming team voice call")
      .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC).setOngoing(true).setTimeoutAfter(remaining)
      .setContentIntent(open).setStyle(NotificationCompat.CallStyle.forIncomingCall(person, endAction(context, call), answer))
    val manager = context.getSystemService(NotificationManager::class.java)
    // Android 14+ can refuse full-screen access. A high-importance call
    // notification remains available; do not claim the full-screen UI opened.
    if (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()) builder.setFullScreenIntent(open, true)
    val notification = builder.build().apply { flags = flags or Notification.FLAG_INSISTENT }
    manager.notify(NOTIFICATION_ID, notification)
    enqueue(context, "incoming", call)
    handler.postDelayed({
      if (stored(context)?.callId == call.callId && !prefs(context).getBoolean("ongoing", false)
        && prefs(context).getLong("answerUntil", 0) <= System.currentTimeMillis()) end(context, call.callId)
    }, remaining)
  }
  @Synchronized fun answer(context: Context, call: Call) {
    if (current(context)?.callId != call.callId) return
    prefs(context).edit().putLong("answerUntil", System.currentTimeMillis() + 45_000).apply()
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    // An explicit Answer at the end of the ringing window remains usable while
    // JS resumes; the authenticated server still decides whether it can join.
    enqueue(context, "answer", call.connecting())
    handler.postDelayed({
      if (stored(context)?.callId == call.callId && !prefs(context).getBoolean("ongoing", false)) end(context, call.callId)
    }, 45_000)
  }
  fun launchApp(context: Activity) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    context.startActivity(launch)
    context.finish()
  }
  @Synchronized fun ongoing(context: Context, call: Call) {
    check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "Allow microphone access before answering." }
    channels(context)
    prefs(context).edit().putString("call", call.json().toString()).putBoolean("ongoing", true).apply()
    ContextCompat.startForegroundService(context, Intent(context, TLinkOngoingCallService::class.java))
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
  }
  @Synchronized fun outgoing(context: Context, call: Call) {
    ongoing(context, call)
    stopRingback()
    outgoingId = call.callId
    try {
      ringback = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 65)
      check(ringback!!.startTone(ToneGenerator.TONE_SUP_RINGTONE)) { "Your phone could not play the call tone." }
    } catch (error: RuntimeException) {
      end(context, call.callId)
      throw error
    }
    handler.postDelayed({ expireOutgoing(context, call.callId) },
      (expiryMillis(call.expiresAt) - System.currentTimeMillis()).coerceIn(1, 45_000))
  }
  @Synchronized private fun expireOutgoing(context: Context, id: String) {
    if (outgoingId != id) return
    stopRingback()
    awaitingAnswerId = id
    current(context)?.let { enqueue(context, "heartbeat", it) }
    handler.postDelayed({ expireAnswerConfirmation(context, id) }, 5_000)
  }
  @Synchronized private fun expireAnswerConfirmation(context: Context, id: String) {
    if (awaitingAnswerId == id) end(context, id)
  }
  private fun stopRingback() {
    ringback?.stopTone()
    ringback?.release()
    ringback = null
    outgoingId = null
  }
  @Synchronized fun connecting(context: Context, id: String) {
    if (current(context)?.callId != id || (outgoingId != id && awaitingAnswerId != id)) return
    stopRingback()
    awaitingAnswerId = null
    connectingId = id
    handler.postDelayed({ expireConnecting(context, id) }, 45_000)
  }
  @Synchronized private fun expireConnecting(context: Context, id: String) {
    if (connectingId == id) end(context, id)
  }
  @Synchronized fun connected(context: Context, id: String) {
    if (current(context)?.callId != id) return
    stopRingback()
    awaitingAnswerId = null
    connectingId = null
  }
  fun ongoingNotification(context: Context, call: Call): Notification {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)!!
    val pending = PendingIntent.getActivity(context, 4, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(context, ONGOING_CHANNEL).setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("TLink call").setContentText("Call in progress").setContentIntent(pending).setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(Person.Builder().setName("TLink team").build(), endAction(context, call))).build()
  }
  @Synchronized fun end(context: Context, id: String) {
    val call = stored(context)
    if (call != null && call.callId != id) return
    stopRingback()
    awaitingAnswerId = null
    connectingId = null
    context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    context.stopService(Intent(context, TLinkOngoingCallService::class.java))
    prefs(context).edit().remove("call").remove("answerUntil").putBoolean("ongoing", false).apply()
    if (call != null) enqueue(context, "end", call)
  }
}

class TLinkCallMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    when (message.data["type"]) {
      "team_call" -> Call.parse(JSONObject(message.data))?.let { Calls.incoming(this, it, fromPush = true) }
      "team_call_ended" -> message.data["callId"]?.let { Calls.end(this, it) }
      else -> super.onMessageReceived(message)
    }
  }
}

class TLinkCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == END) intent.getStringExtra("callId")?.let { Calls.end(context, it) }
  }
}

class TLinkIncomingCallActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var call: Call? = null
  private val expiry = object : Runnable {
    override fun run() {
      if (call == null || Calls.current(this@TLinkIncomingCallActivity)?.callId != call?.callId) finish()
      else handler.postDelayed(this, 1000)
    }
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
    display(intent)
  }
  override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); display(intent) }
  private fun display(intent: Intent) {
    call = try { Call.parse(JSONObject(intent.getStringExtra("call") ?: "")) } catch (_: Exception) { null }
    val invitation = call
    if (invitation == null || Calls.current(this)?.callId != invitation.callId) { finish(); return }
    if (intent.action == ANSWER) { accept(invitation); return }
    fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(24), dp(40), dp(24), dp(40)); setBackgroundColor(Color.rgb(6, 19, 31))
    }
    val mint = Color.rgb(84, 227, 178)
    val navy = Color.rgb(7, 24, 43)
    layout.addView(TextView(this).apply { text = "TLink"; textSize = 34f; setTextColor(mint); gravity = Gravity.CENTER })
    layout.addView(TextView(this).apply { text = if (invitation.mode == "video") "Incoming team video call" else "Incoming team voice call"; textSize = 20f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; setPadding(0, dp(24), 0, dp(40)) })
    fun action(label: String, primary: Boolean, pressed: () -> Unit) = Button(this).apply {
      text = label; contentDescription = label; textSize = 17f; isAllCaps = false; minimumHeight = dp(56)
      setTextColor(if (primary) navy else Color.WHITE); setPadding(dp(20), dp(14), dp(20), dp(14))
      val surface = GradientDrawable().apply {
        cornerRadius = dp(28).toFloat(); setColor(if (primary) mint else navy)
        setStroke(dp(1), if (primary) mint else Color.rgb(41, 70, 87))
      }
      background = RippleDrawable(ColorStateList.valueOf(Color.argb(45, 255, 255, 255)), surface, null)
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }
      setOnClickListener { pressed() }
    }
    layout.addView(action("Answer", true) { accept(invitation) })
    layout.addView(action("Decline", false) { Calls.end(this, invitation.callId); finish() })
    setContentView(layout)
    handler.removeCallbacks(expiry); handler.post(expiry)
  }
  private fun accept(call: Call) {
    val manager = getSystemService(KeyguardManager::class.java)
    if (Build.VERSION.SDK_INT >= 26 && manager.isKeyguardLocked) {
      manager.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() { Calls.answer(this@TLinkIncomingCallActivity, call); Calls.launchApp(this@TLinkIncomingCallActivity) }
      })
    } else { Calls.answer(this, call); Calls.launchApp(this) }
  }
  override fun onDestroy() { handler.removeCallbacks(expiry); super.onDestroy() }
}

class TLinkOngoingCallService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val heartbeat = object : Runnable {
    override fun run() {
      val call = Calls.current(this@TLinkOngoingCallService)
      if (call == null) { stopSelf(); return }
      Calls.enqueue(this@TLinkOngoingCallService, "heartbeat", call)
      handler.postDelayed(this, 1500)
    }
  }
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val call = Calls.current(this)
    if (call == null) { stopSelf(); return START_NOT_STICKY }
    if (Build.VERSION.SDK_INT >= 29) startForeground(ONGOING_ID, Calls.ongoingNotification(this, call), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    else startForeground(ONGOING_ID, Calls.ongoingNotification(this, call))
    handler.removeCallbacks(heartbeat); handler.post(heartbeat)
    return START_NOT_STICKY
  }
  override fun onDestroy() { handler.removeCallbacks(heartbeat); super.onDestroy() }
}

class TLinkCallsModule : Module() {
  private fun context(): Context = appContext.reactContext ?: throw IllegalStateException("TLink is not ready.")
  private fun activityIsResumed() = (appContext.currentActivity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true
  override fun definition() = ModuleDefinition {
    Name("TLinkCalls")
    Events("callEvent", "tokenChanged")
    OnCreate { Calls.changed = { sendEvent("callEvent", emptyMap<String, Any>()) } }
    OnDestroy { Calls.changed = null }
    AsyncFunction("configure") { enabled: Boolean, preserveActiveCalls: Boolean -> Calls.configure(context(), enabled, preserveActiveCalls) }
    AsyncFunction("registration") { mapOf("voipPushToken" to "", "nativeCallCapable" to true) }
    AsyncFunction("drainEvents") { Calls.drain(context()) }
    AsyncFunction("incoming") { value: Map<String, Any> ->
      val call = Call.parse(JSONObject(value)) ?: throw IllegalArgumentException("This call has expired.")
      Calls.incoming(context(), call)
    }
    AsyncFunction("answer") { id: String ->
      val call = Calls.current(context()) ?: throw IllegalStateException("This call has ended.")
      check(call.callId == id) { "This call has ended." }
      check(activityIsResumed()) { "Open TLink to answer this call." }
      // JS calls this only after authenticated Answer has acquired microphone.
      Calls.ongoing(context(), call)
    }
    AsyncFunction("outgoing") { value: Map<String, Any> ->
      val call = Call.parse(JSONObject(value)) ?: throw IllegalArgumentException("This call has expired.")
      check(activityIsResumed()) { "Open TLink to start this call." }
      Calls.outgoing(context(), call)
    }
    AsyncFunction("connected") { id: String -> Calls.connected(context(), id) }
    AsyncFunction("connecting") { id: String -> Calls.connecting(context(), id) }
    AsyncFunction("end") { id: String -> Calls.end(context(), id) }
    AsyncFunction("speaker") { enabled: Boolean ->
      @Suppress("DEPRECATION")
      context().getSystemService(AudioManager::class.java).isSpeakerphoneOn = enabled
    }
  }
}
