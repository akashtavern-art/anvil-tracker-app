package com.anvil.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import android.app.usage.UsageStatsManager
import android.app.AppOpsManager
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

class AnvilBridge(private val activity: AppCompatActivity) {

    private val tag = "AnvilBridge"
    private val recorderMap = HashMap<String, MediaRecorder>()
    private var activeAudioPath = ""

    @JavascriptInterface
    fun hasUsagePermission(): Boolean {
        return try {
            val appOps = activity.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                activity.packageName
            )
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            Log.e(tag, "hasUsagePermission failed", e)
            false
        }
    }

    @JavascriptInterface
    fun requestUsageAccess() {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
    }

    @JavascriptInterface
    fun getDailyUsage(days: Int): String {
        if (!hasUsagePermission()) {
            return "[]"
        }
        val safeDays = max(1, days)
        val now = System.currentTimeMillis()
        val start = now - safeDays * 24L * 60 * 60 * 1000

        val manager = activity.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val query = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now)
            ?: emptyList()

        val appManager = activity.packageManager
        val buckets = HashMap<String, Long>()
        for (stat in query) {
            if (stat.totalTimeInForeground <= 0) continue
            val name = stat.packageName
            buckets[name] = (buckets[name] ?: 0L) + stat.totalTimeInForeground
        }

        val list = buckets.entries
            .sortedByDescending { it.value }
            .take(20)

        val json = JSONArray()
        for (entry in list) {
            val obj = JSONObject()
            obj.put("package", entry.key)
            obj.put("app", getAppName(appManager, entry.key))
            obj.put("ms", entry.value)
            json.put(obj)
        }
        return json.toString()
    }

    private fun getAppName(pm: PackageManager, pkg: String): String {
        return try {
            val info: ApplicationInfo = pm.getApplicationInfo(pkg, 0)
            pm.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            pkg
        }
    }

    @JavascriptInterface
    fun scheduleNotification(id: Int, title: String, body: String, triggerAtMillis: Long, repeatDaily: Boolean): Boolean {
        return try {
            val alarmManager = activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val safeTriggerAt = if (triggerAtMillis < System.currentTimeMillis()) System.currentTimeMillis() + 1 else triggerAtMillis
            val alarmIntent = Intent(activity, AnvilAlarmReceiver::class.java).apply {
                putExtra("notification_id", id)
                putExtra("title", title)
                putExtra("body", body)
                putExtra("repeat", repeatDaily)
            }
            val pending = PendingIntent.getBroadcast(
                activity,
                id,
                alarmIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            if (repeatDaily) {
                val interval = AlarmManager.INTERVAL_DAY
                alarmManager.setInexactRepeating(
                    AlarmManager.RTC_WAKEUP,
                    safeTriggerAt,
                    interval,
                    pending
                )
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, safeTriggerAt, pending)
                } else {
                    alarmManager.setExact(AlarmManager.RTC_WAKEUP, safeTriggerAt, pending)
                }
            }
            true
        } catch (e: Exception) {
            Log.e(tag, "scheduleNotification failed", e)
            false
        }
    }

    @JavascriptInterface
    fun cancelNotification(id: Int): Boolean {
        return try {
            val alarmManager = activity.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pending = PendingIntent.getBroadcast(
                activity,
                id,
                Intent(activity, AnvilAlarmReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            alarmManager.cancel(pending)
            true
        } catch (e: Exception) {
            Log.e(tag, "cancelNotification failed", e)
            false
        }
    }

    @JavascriptInterface
    fun startAudioCapture(name: String): String {
        if (activeAudioPath.isNotBlank() && recorderMap.containsKey("weekly")) {
            return activeAudioPath
        }
        if (activeAudioPath.isNotBlank() && !recorderMap.containsKey("weekly")) {
            activeAudioPath = ""
        }
        return try {
            if (recorderMap.containsKey("weekly")) {
                return "already-running"
            }
            val safeName = name.ifBlank { "weekly-reflection" }
                .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                .trim('_', '.')
                .ifEmpty { "weekly-reflection" }
            val fileName = safeName + "_" + System.currentTimeMillis() + ".m4a"
            val cacheFile = File(activity.cacheDir, fileName)
            activeAudioPath = cacheFile.absolutePath

            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(activity)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }

            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setOutputFile(cacheFile.absolutePath)
            recorder.prepare()
            recorder.start()
            recorderMap["weekly"] = recorder
            cacheFile.absolutePath
        } catch (e: Exception) {
            activeAudioPath = ""
            Log.e(tag, "startAudioCapture failed", e)
            ""
        }
    }

    @JavascriptInterface
    fun stopAudioCapture(): String {
        val path = activeAudioPath
        return try {
            val recorder = recorderMap.remove("weekly")
            if (recorder == null) {
                activeAudioPath = ""
                ""
            } else {
                recorder.stop()
                recorder.release()
                activeAudioPath = ""
                path
            }
        } catch (e: Exception) {
            activeAudioPath = ""
            Log.e(tag, "stopAudioCapture failed", e)
            path
        }
    }

    @JavascriptInterface
    fun exportData(jsonPayload: String, csvPayload: String): String {
        return try {
            val date = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val downloads = activity.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                ?: activity.filesDir
            val jsonFile = File(downloads, "anvil-export-$date.json")
            val csvFile = File(downloads, "anvil-export-$date.csv")

            FileOutputStream(jsonFile).use { it.write(jsonPayload.toByteArray()) }
            FileOutputStream(csvFile).use { it.write(csvPayload.toByteArray()) }

            val response = JSONObject()
            response.put("json", jsonFile.absolutePath)
            response.put("csv", csvFile.absolutePath)
            response.toString()
        } catch (e: Exception) {
            Log.e(tag, "exportData failed", e)
            "{}"
        }
    }
}
