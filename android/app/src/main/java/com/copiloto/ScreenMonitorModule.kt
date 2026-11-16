package com.copiloto

import android.app.DatePickerDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.provider.Settings
import android.util.Base64
import android.view.accessibility.AccessibilityManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.ByteArrayOutputStream
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.Calendar
import java.util.Locale

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

  fun emit(
    payload: com.facebook.react.bridge.WritableMap,
    eventName: String = "screenData",
  ) {
    val context = synchronized(this) { contextReference?.get() } ?: return
    if (!context.hasActiveReactInstance()) return

    context.runOnJSQueueThread {
      if (context.hasActiveReactInstance()) {
        context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(eventName, payload)
      }
    }
  }
}

internal data class PaymentRecord(
  val amount: Double,
  val timestamp: Long,
) {
  fun toWritableMap() = Arguments.createMap().apply {
    putDouble("amount", amount)
    putDouble("timestamp", timestamp.toDouble())
  }

  fun toJson() = JSONObject().apply {
    put("amount", amount)
    put("timestamp", timestamp)
  }
}

internal object PaymentHistoryStore {
  private const val PREFERENCES = "payment_history"
  private const val PRESETS = "presets"
  private const val PAYMENTS = "payments"
  private const val PIX_KEY = "pix_key"
  private const val PIX_NAME = "pix_name"
  private const val PIX_CITY = "pix_city"
  private val defaultPresets = listOf(6.0, 10.0, 15.0)

  fun presets(context: Context): List<Double> {
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    if (!preferences.contains(PRESETS)) return defaultPresets
    val saved = JSONArray(preferences.getString(PRESETS, "[]"))
    return List(saved.length()) { index -> saved.getDouble(index) }
  }

  fun payments(context: Context): List<PaymentRecord> {
    val saved = JSONArray(
      context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(PAYMENTS, "[]"),
    )
    return List(saved.length()) { index ->
      val payment = saved.getJSONObject(index)
      PaymentRecord(payment.getDouble("amount"), payment.getLong("timestamp"))
    }
  }

  fun savePresets(context: Context, values: List<Double>) {
    val saved = JSONArray().apply { values.forEach(::put) }
    val success = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString(PRESETS, saved.toString())
      .commit()
    if (!success) throw IllegalStateException("Could not save payment shortcuts.")
  }

  fun pixConfig(context: Context): Triple<String, String, String> {
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    return Triple(
      preferences.getString(PIX_KEY, "").orEmpty(),
      preferences.getString(PIX_NAME, "").orEmpty(),
      preferences.getString(PIX_CITY, "SAO PAULO").orEmpty(),
    )
  }

  fun savePixConfig(context: Context, key: String, name: String, city: String) {
    val success = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString(PIX_KEY, key)
      .putString(PIX_NAME, name)
      .putString(PIX_CITY, city)
      .commit()
    if (!success) throw IllegalStateException("Could not save Pix configuration.")
  }

  fun record(context: Context, amount: Double): PaymentRecord {
    require(amount.isFinite() && amount > 0.0) {
      "Payment amount must be greater than zero."
    }
    val existingPayments = payments(context)
    val timestamp = maxOf(
      System.currentTimeMillis(),
      (existingPayments.firstOrNull()?.timestamp ?: 0L) + 1L,
    )
    val record = PaymentRecord(amount, timestamp)
    val saved = JSONArray().apply {
      put(record.toJson())
      existingPayments.forEach { put(it.toJson()) }
    }
    val success = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString(PAYMENTS, saved.toString())
      .commit()
    if (!success) throw IllegalStateException("Could not save the received payment.")
    return record
  }

  fun delete(context: Context, timestamp: Long): Boolean {
    val existingPayments = payments(context)
    if (existingPayments.none { it.timestamp == timestamp }) return false
    val saved = JSONArray().apply {
      existingPayments.filterNot { it.timestamp == timestamp }.forEach {
        put(it.toJson())
      }
    }
    val success = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putString(PAYMENTS, saved.toString())
      .commit()
    if (!success) throw IllegalStateException("Could not delete the payment.")
    return true
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
  fun getFareRatePerKm(promise: Promise) {
    try {
      promise.resolve(
        appContext
          .getSharedPreferences(FARE_SIGNAL_PREFERENCES, Context.MODE_PRIVATE)
          .getFloat(FARE_RATE_PER_KM, DEFAULT_FARE_RATE_PER_KM)
          .toDouble(),
      )
    } catch (error: Exception) {
      promise.reject("E_FARE_RATE_READ", "Could not read the fare rate", error)
    }
  }

  @ReactMethod
  fun setFareRatePerKm(rate: Double, promise: Promise) {
    if (!rate.isFinite() || rate <= 0.0 || rate > MAX_FARE_RATE_PER_KM) {
      promise.reject(
        "E_FARE_RATE_INVALID",
        "Fare rate must be greater than zero and at most $MAX_FARE_RATE_PER_KM R$/km",
      )
      return
    }

    try {
      val saved = appContext
        .getSharedPreferences(FARE_SIGNAL_PREFERENCES, Context.MODE_PRIVATE)
        .edit()
        .putFloat(FARE_RATE_PER_KM, rate.toFloat())
        .commit()
      if (!saved) {
        promise.reject("E_FARE_RATE_WRITE", "Could not save the fare rate")
      } else {
        promise.resolve(null)
      }
    } catch (error: Exception) {
      promise.reject("E_FARE_RATE_WRITE", "Could not save the fare rate", error)
    }
  }

  @ReactMethod
  fun getPaymentData(promise: Promise) {
    try {
      promise.resolve(Arguments.createMap().apply {
        putArray(
          "presets",
          Arguments.createArray().apply {
            PaymentHistoryStore.presets(appContext).forEach(::pushDouble)
          },
        )
        putArray(
          "payments",
          Arguments.createArray().apply {
            PaymentHistoryStore.payments(appContext).forEach {
              pushMap(it.toWritableMap())
            }
          },
        )
        val (pixKey, pixName, pixCity) = PaymentHistoryStore.pixConfig(appContext)
        putString("pixKey", pixKey)
        putString("pixName", pixName)
        putString("pixCity", pixCity)
      })
    } catch (error: Exception) {
      promise.reject("E_PAYMENT_DATA_READ", "Could not read payment data", error)
    }
  }

  @ReactMethod
  fun showDatePicker(initialDate: String, promise: Promise) {
    val parts = initialDate.split("-")
    if (parts.size != 3) {
      promise.reject("E_DATE_PICKER_INVALID", "Initial date must use YYYY-MM-DD format.")
      return
    }

    val year = parts[0].toIntOrNull()
    val month = parts[1].toIntOrNull()
    val day = parts[2].toIntOrNull()
    val calendar = Calendar.getInstance()
    if (year == null || month == null || day == null) {
      promise.reject("E_DATE_PICKER_INVALID", "Initial date is invalid.")
      return
    }
    calendar.isLenient = false
    try {
      calendar.set(year, month - 1, day)
      calendar.time
    } catch (error: Exception) {
      promise.reject("E_DATE_PICKER_INVALID", "Initial date is invalid.", error)
      return
    }

    val activity = appContext.currentActivity
    if (activity == null || activity.isFinishing) {
      promise.reject("E_DATE_PICKER_ACTIVITY", "The app is not active.")
      return
    }

    activity.runOnUiThread {
      try {
        val dialog = DatePickerDialog(
          activity,
          { _, selectedYear, selectedMonth, selectedDay ->
            promise.resolve(
              String.format(
                Locale.US,
                "%04d-%02d-%02d",
                selectedYear,
                selectedMonth + 1,
                selectedDay,
              ),
            )
          },
          year,
          month - 1,
          day,
        )
        dialog.setOnCancelListener { promise.resolve(null) }
        dialog.show()
      } catch (error: Exception) {
        promise.reject("E_DATE_PICKER_SHOW", "Could not open the date picker.", error)
      }
    }
  }

  @ReactMethod
  fun setPaymentPresets(values: ReadableArray, promise: Promise) {
    try {
      val presets = (0 until values.size()).map { index ->
        if (values.getType(index) != ReadableType.Number) {
          throw IllegalArgumentException("Payment shortcuts must be numbers.")
        }
        values.getDouble(index)
      }
      if (presets.any { !it.isFinite() || it <= 0.0 } ||
        presets.distinct().size != presets.size
      ) {
        promise.reject(
          "E_PAYMENT_PRESETS_INVALID",
          "Payment shortcuts must be unique amounts greater than zero.",
        )
        return
      }

      PaymentHistoryStore.savePresets(appContext, presets)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_PAYMENT_PRESETS_WRITE", "Could not save payment shortcuts", error)
    }
  }

  @ReactMethod
  fun setPixConfig(key: String, name: String, city: String, promise: Promise) {
    val normalizedKey = key.trim()
    val normalizedName = name.trim()
    val normalizedCity = city.trim()
    if (
      normalizedKey.isBlank() ||
      normalizedKey.toByteArray(Charsets.UTF_8).size > 77 ||
      normalizedName.isBlank() ||
      normalizedName.toByteArray(Charsets.UTF_8).size > 25 ||
      normalizedCity.isBlank() ||
      normalizedCity.toByteArray(Charsets.UTF_8).size > 15
    ) {
      promise.reject(
        "E_PIX_CONFIG_INVALID",
        "Pix requires a key of 1-77 bytes, a name of 1-25 bytes, and a city of 1-15 bytes.",
      )
      return
    }

    try {
      PaymentHistoryStore.savePixConfig(
        appContext,
        normalizedKey,
        normalizedName,
        normalizedCity,
      )
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_PIX_CONFIG_WRITE", "Could not save Pix configuration", error)
    }
  }

  @ReactMethod
  fun deletePayment(timestamp: Double, promise: Promise) {
    if (!timestamp.isFinite() || timestamp <= 0.0 || timestamp % 1.0 != 0.0) {
      promise.reject("E_PAYMENT_ID_INVALID", "Payment timestamp is invalid.")
      return
    }

    try {
      if (!PaymentHistoryStore.delete(appContext, timestamp.toLong())) {
        promise.reject("E_PAYMENT_NOT_FOUND", "Payment was not found.")
      } else {
        promise.resolve(null)
      }
    } catch (error: Exception) {
      promise.reject("E_PAYMENT_DELETE", "Could not delete payment", error)
    }
  }

  @ReactMethod
  fun bringToForeground(promise: Promise) {
    val launchIntent = appContext.packageManager
      .getLaunchIntentForPackage(appContext.packageName)
    if (launchIntent == null) {
      promise.reject("E_PAYMENT_APP_LAUNCH", "Could not find the app launch activity.")
      return
    }

    try {
      launchIntent
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val context = AccessibilityScreenService.currentService ?: appContext
      context.startActivity(launchIntent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("E_PAYMENT_APP_LAUNCH", "Could not open the payment screen.", error)
    }
  }

  @ReactMethod
  fun generatePixQr(amount: Double, includeAmount: Boolean, promise: Promise) {
    try {
      val (key, name, city) = PaymentHistoryStore.pixConfig(appContext)
      val payload = PixBrCode.createPayload(
        key,
        name,
        city,
        if (includeAmount) amount else null,
      )
      val bitmap = PixBrCode.createQrBitmap(payload, 1024)
      val output = ByteArrayOutputStream()
      if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
        throw IllegalStateException("Could not encode the Pix QR code.")
      }
      promise.resolve(
        "data:image/png;base64," +
          Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP),
      )
    } catch (error: Exception) {
      promise.reject("E_PIX_QR_GENERATION", "Could not generate the Pix QR code.", error)
    }
  }

  @ReactMethod
  fun recordPayment(amount: Double, promise: Promise) {
    try {
      promise.resolve(PaymentHistoryStore.record(appContext, amount).toWritableMap())
    } catch (error: Exception) {
      promise.reject("E_PAYMENT_RECORD", "Could not record the payment.", error)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  private companion object {
    const val FARE_SIGNAL_PREFERENCES = "fare_signal"
    const val FARE_RATE_PER_KM = "fare_rate_per_km"
    const val DEFAULT_FARE_RATE_PER_KM = 1.5f
    const val MAX_FARE_RATE_PER_KM = 1_000.0
  }
}
