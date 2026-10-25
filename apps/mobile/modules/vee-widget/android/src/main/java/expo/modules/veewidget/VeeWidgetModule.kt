// SPDX-License-Identifier: AGPL-3.0-or-later
// Home widget (SDD "Home widget"): the next session, its minutes and the
// 4-week consistency. The app writes a small JSON snapshot to
// SharedPreferences after each session change; the widget reads it. A tap
// opens the app on Today. RemoteViews, not Glance: three lines of text need
// no Compose toolchain in a local module.
package expo.modules.veewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

private const val PREFS = "vee_widget"
private const val KEY = "snapshot"

class VeeWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VeeWidget")
    Function("setSnapshot") { json: String ->
      val context = requireNotNull(appContext.reactContext) { "no React context" }
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      VeeWidgetProvider.updateAll(context)
    }
  }
}

class VeeWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, VeeWidgetProvider::class.java))
      for (id in ids) manager.updateAppWidget(id, views(context))
    }

    private fun views(context: Context): RemoteViews {
      val v = RemoteViews(context.packageName, R.layout.vee_widget)
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
      val s = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
      v.setTextViewText(R.id.vee_widget_title, s?.optString("title")?.takeIf { it.isNotEmpty() } ?: "Open Vee")
      v.setTextViewText(R.id.vee_widget_minutes, s?.optString("minutes") ?: "")
      v.setTextViewText(R.id.vee_widget_consistency, s?.optString("consistency") ?: "")
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      v.setOnClickPendingIntent(
        R.id.vee_widget_root,
        PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT),
      )
      return v
    }
  }
}
