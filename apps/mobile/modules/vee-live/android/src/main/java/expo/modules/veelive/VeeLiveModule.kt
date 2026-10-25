// SPDX-License-Identifier: AGPL-3.0-or-later
// Live Update for the session runner (SDD "Live Update module"). Android 16+:
// a promoted ongoing notification with ProgressStyle (one segment per
// exercise), a short critical text for the status chip and a countdown
// chronometer to the end of the rest; One UI shows it in the Now Bar. Older
// Android: the same ongoing notification without promotion or segments.
// "Set done" and "+30 s" come back to the runner as events.
package expo.modules.veelive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.time.Instant

private const val CHANNEL = "live"
private const val NOTIFICATION_ID = 4711
private const val ACTION = "app.vee.live.ACTION"

data class LiveState(
  var sessionTitle: String = "",
  var exercise: String = "",
  var setLabel: String = "",
  var restEndsAt: String? = null,
  /** Exercises done, out of segments. */
  var progress: Int = 0,
  var segments: Int = 1,
)

class VeeLiveModule : Module() {
  private val state = LiveState()

  override fun definition() = ModuleDefinition {
    Name("VeeLive")
    Events("onAction")

    OnCreate { listener = { action -> sendEvent("onAction", mapOf("action" to action)) } }
    OnDestroy { listener = null }

    Function("start") { p: Map<String, Any?> ->
      apply(p)
      show()
    }
    Function("update") { p: Map<String, Any?> ->
      apply(p)
      show()
    }
    Function("end") {
      manager()?.cancel(NOTIFICATION_ID)
    }
  }

  private fun apply(p: Map<String, Any?>) {
    (p["sessionTitle"] as? String)?.let { state.sessionTitle = it }
    (p["exercise"] as? String)?.let { state.exercise = it }
    (p["setLabel"] as? String)?.let { state.setLabel = it }
    if (p.containsKey("restEndsAt")) state.restEndsAt = p["restEndsAt"] as? String
    (p["progress"] as? Number)?.let { state.progress = it.toInt() }
    (p["segments"] as? Number)?.let { state.segments = maxOf(1, it.toInt()) }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "no React context" }

  private fun manager(): NotificationManager? =
    appContext.reactContext?.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

  private fun action(label: String, name: String, code: Int): Notification.Action {
    val intent = Intent(context, VeeLiveActionReceiver::class.java).setAction(ACTION).putExtra("action", name)
    val pending = PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return Notification.Action.Builder(Icon.createWithResource(context, context.applicationInfo.icon), label, pending).build()
  }

  private fun show() {
    val nm = manager() ?: return
    if (nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Session", NotificationManager.IMPORTANCE_LOW))
    }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val restEnd = state.restEndsAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    val resting = restEnd != null && restEnd > System.currentTimeMillis()
    val b = Notification.Builder(context, CHANNEL)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(if (resting) "Rest · next: ${state.exercise}" else state.exercise)
      .setContentText(state.setLabel)
      .setSubText(state.sessionTitle)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_WORKOUT)
      .setContentIntent(tap)
      .addAction(action("Set done", "done", 1))
      .addAction(action("+30 s", "add30", 2))
    if (resting && restEnd != null) {
      b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(restEnd).setShowWhen(true)
    }
    if (Build.VERSION.SDK_INT >= 36) {
      b.setRequestPromotedOngoing(true)
      b.setShortCriticalText(if (resting) "Rest" else state.setLabel.take(7))
      val style = Notification.ProgressStyle()
        .setProgressSegments(List(state.segments) { Notification.ProgressStyle.Segment(1) })
        .setProgress(state.progress)
      b.setStyle(style)
    }
    nm.notify(NOTIFICATION_ID, b.build())
  }

  companion object {
    @Volatile var listener: ((String) -> Unit)? = null
  }
}

/** Notification actions go to the runner while the app process lives. */
class VeeLiveActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.getStringExtra("action") ?: return
    VeeLiveModule.listener?.invoke(action)
  }
}
