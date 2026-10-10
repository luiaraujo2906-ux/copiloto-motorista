package com.copiloto

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

internal object ScreenMonitorSettings {
  private const val PREFERENCES = "screen_monitor"
  private const val MONITORING = "monitoring"
  private const val EPOCH = "monitoring_epoch"

  fun isMonitoring(context: Context): Boolean =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getBoolean(MONITORING, false)

  fun epoch(context: Context): Long =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getLong(EPOCH, 0)

  fun setMonitoring(context: Context, enabled: Boolean) {
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    preferences.edit()
      .putBoolean(MONITORING, enabled)
      .putLong(EPOCH, preferences.getLong(EPOCH, 0) + 1)
      .apply()
  }
}

internal object ScreenMonitorEventEmitter {
  private var contextReference: WeakReference<ReactApplicationContext>? = null

  @Synchronized
  fun attach(context: ReactApplicationContext) {
    contextReference = WeakReference(context)
  }

  @Synchronized
  fun detach(context: ReactApplicationContext) {
    if (contextReference?.get() === context) {
      contextReference = null
    }
  }

  fun emit(payload: com.facebook.react.bridge.WritableMap) {
    val context = synchronized(this) { contextReference?.get() } ?: return
    if (!context.hasActiveReactInstance()) return

    context.runOnJSQueueThread {
      if (context.hasActiveReactInstance()) {
        context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("screenData", payload)
      }
    }
  }
}

class ScreenMonitorModule(
  private val appContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(appContext) {
  override fun getName() = "ScreenMonitor"

  override fun initialize() {
    super.initialize()
    ScreenMonitorEventEmitter.attach(appContext)
  }

  override fun invalidate() {
    ScreenMonitorEventEmitter.detach(appContext)
    super.invalidate()
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      val accessibilityManager =
        appContext.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
      val serviceName = AccessibilityScreenService::class.java.name
      val accessibilityEnabled =
        accessibilityManager
          .getEnabledAccessibilityServiceList(
            android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK,
          )
          .any {
            it.resolveInfo.serviceInfo.packageName == appContext.packageName &&
              it.resolveInfo.serviceInfo.name == serviceName
          }
      promise.resolve(
        Arguments.createMap().apply {
          putBoolean("accessibilityEnabled", accessibilityEnabled)
          putBoolean("monitoring", ScreenMonitorSettings.isMonitoring(appContext))
          putArray(
            "targetPackages",
            Arguments.createArray().apply {
              TargetAppPackages.packages.forEach(::pushString)
            },
          )
        },
      )
    } catch (error: Exception) {
      promise.reject("E_SCREEN_MONITOR_STATUS", "Could not read monitoring status", error)
    }
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    try {
      appContext.startActivity(
        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject(
        "E_ACCESSIBILITY_SETTINGS",
        "Could not open Android accessibility settings",
        error,
      )
    }
  }

  @ReactMethod
  fun setMonitoring(enabled: Boolean, promise: Promise) {
    try {
      ScreenMonitorSettings.setMonitoring(appContext, enabled)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_SCREEN_MONITOR_TOGGLE", "Could not update monitoring", error)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit
}
