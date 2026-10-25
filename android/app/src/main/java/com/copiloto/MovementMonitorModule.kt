package com.copiloto

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.ArrayDeque

class MovementMonitorModule(
  private val appContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(appContext), SensorEventListener, LocationListener {
  private val handler = Handler(Looper.getMainLooper())
  private val sensorManager =
    appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val locationManager =
    appContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private val stepTimes = ArrayDeque<Long>()
  private val gpsSpeeds = ArrayDeque<Float>()
  private var stepSensor: Sensor? = null
  private var running = false
  private var gpsStarted = false
  private var gpsSamplesAboveThreshold = 0
  private var gpsSamplesBelowThreshold = 0
  private var state = "unknown"
  private var source = "none"

  override fun getName() = "MovementMonitor"

  override fun invalidate() {
    running = false
    handler.removeCallbacks(gpsFallbackCheck)
    handler.removeCallbacks(stepTimeout)
    sensorManager.unregisterListener(this)
    stopGps()
    super.invalidate()
  }

  @ReactMethod
  fun start(promise: com.facebook.react.bridge.Promise) {
    if (running) {
      promise.resolve(null)
      return
    }
    if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
      promise.reject("E_MOVEMENT_PERMISSION", "Location permission is required for GPS fallback.")
      return
    }

    try {
      running = true
      state = "unknown"
      source = "none"
      stepTimes.clear()
      gpsSpeeds.clear()
      gpsSamplesAboveThreshold = 0
      gpsSamplesBelowThreshold = 0
      stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
      if (
        stepSensor != null &&
        (android.os.Build.VERSION.SDK_INT < 29 ||
          hasPermission(Manifest.permission.ACTIVITY_RECOGNITION))
      ) {
        sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_NORMAL)
        handler.postDelayed(gpsFallbackCheck, GPS_FALLBACK_DELAY_MILLIS)
      } else {
        startGps()
      }
      emitState()
      promise.resolve(null)
    } catch (error: Exception) {
      running = false
      stopGps()
      sensorManager.unregisterListener(this)
      promise.reject("E_MOVEMENT_START", "Could not start movement detection.", error)
    }
  }

  @ReactMethod
  fun stop(promise: com.facebook.react.bridge.Promise) {
    running = false
    handler.removeCallbacks(gpsFallbackCheck)
    handler.removeCallbacks(stepTimeout)
    sensorManager.unregisterListener(this)
    stopGps()
    stepTimes.clear()
    gpsSpeeds.clear()
    state = "unknown"
    source = "none"
    emitState()
    promise.resolve(null)
  }

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  override fun onSensorChanged(event: SensorEvent?) {
    if (!running || event?.sensor?.type != Sensor.TYPE_STEP_DETECTOR) return

    val now = android.os.SystemClock.elapsedRealtime()
    stepTimes.addLast(now)
    while (true) {
      val firstStep = stepTimes.peekFirst() ?: break
      if (now - firstStep <= STEP_WINDOW_MILLIS) break
      stepTimes.removeFirst()
    }
    if (stepTimes.size >= REQUIRED_STEPS && walkingTestMode) {
      updateState("moving", "motion_sensor")
    }
    handler.removeCallbacks(stepTimeout)
    handler.postDelayed(stepTimeout, STEP_QUIET_TIMEOUT_MILLIS)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onLocationChanged(location: Location) {
    if (
      !running ||
      !location.hasAccuracy() ||
      location.accuracy > MAX_GPS_ACCURACY_METERS
    ) {
      return
    }

    val speedKmh = if (location.hasSpeed()) {
      location.speed * METERS_PER_SECOND_TO_KMH
    } else {
      return
    }
    gpsSpeeds.addLast(speedKmh)
    while (gpsSpeeds.size > GPS_SMOOTHING_SAMPLE_COUNT) gpsSpeeds.removeFirst()
    val filteredSpeed = gpsSpeeds.sorted()[gpsSpeeds.size / 2]
    val now = android.os.SystemClock.elapsedRealtime()
    val stepsRecent = walkingTestMode &&
      (stepTimes.peekLast()?.let { now - it < STEP_QUIET_TIMEOUT_MILLIS } ?: false)

    if (filteredSpeed >= MOVEMENT_THRESHOLD_KMH) {
      gpsSamplesAboveThreshold += 1
      gpsSamplesBelowThreshold = 0
      if (gpsSamplesAboveThreshold >= GPS_CONFIRMATION_SAMPLES && !stepsRecent) {
        updateState("moving", "gps")
      }
    } else {
      gpsSamplesBelowThreshold += 1
      gpsSamplesAboveThreshold = 0
      if (gpsSamplesBelowThreshold >= GPS_CONFIRMATION_SAMPLES) {
        if (stepsRecent) {
          updateState("moving", "motion_sensor")
        } else {
          updateState("stopped", "gps")
        }
      }
    }
  }

  @Deprecated("Deprecated in Android")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

  override fun onProviderEnabled(provider: String) = Unit

  override fun onProviderDisabled(provider: String) {
    if (provider == LocationManager.GPS_PROVIDER && running) {
      updateState("unknown", "gps")
    }
  }

  private val gpsFallbackCheck: Runnable = object : Runnable {
    override fun run() {
      if (!running) return
      val lastStep = stepTimes.peekLast()
      val sensorQuiet = !walkingTestMode ||
        (lastStep?.let {
          android.os.SystemClock.elapsedRealtime() - it >= GPS_FALLBACK_DELAY_MILLIS
        } ?: true)
      if (sensorQuiet) startGps()
      if (!gpsStarted) handler.postDelayed(this, GPS_FALLBACK_DELAY_MILLIS)
    }
  }

  private val stepTimeout: Runnable = Runnable {
    if (!running || stepTimes.isEmpty()) return@Runnable
    val lastStep = stepTimes.peekLast() ?: return@Runnable
    val elapsed = android.os.SystemClock.elapsedRealtime() - lastStep
    if (elapsed >= STEP_QUIET_TIMEOUT_MILLIS) {
      stepTimes.clear()
      gpsSamplesAboveThreshold = 0
      if (state == "moving" && source == "motion_sensor") {
        updateState("stopped", "motion_sensor")
      }
    } else {
      handler.postDelayed(stepTimeout, STEP_QUIET_TIMEOUT_MILLIS - elapsed)
    }
  }

  private fun startGps() {
    if (!running || gpsStarted) return
    if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
      updateState("unknown", "gps")
      return
    }
    try {
      locationManager.requestLocationUpdates(
        LocationManager.GPS_PROVIDER,
        GPS_UPDATE_INTERVAL_MILLIS,
        0f,
        this,
        Looper.getMainLooper(),
      )
      gpsStarted = true
    } catch (error: SecurityException) {
      updateState("unknown", "gps")
    } catch (error: IllegalArgumentException) {
      updateState("unknown", "gps")
    }
  }

  private fun stopGps() {
    if (!gpsStarted) return
    locationManager.removeUpdates(this)
    gpsStarted = false
  }

  private fun hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(appContext, permission) == PackageManager.PERMISSION_GRANTED

  private val walkingTestMode: Boolean
    get() = MOVEMENT_THRESHOLD_KMH <= WALKING_TEST_MAX_THRESHOLD_KMH

  private fun updateState(nextState: String, nextSource: String) {
    if (state == nextState && source == nextSource) return
    state = nextState
    source = nextSource
    emitState()
  }

  private fun emitState() {
    if (!appContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("state", state)
      putString("source", source)
    }
    appContext.runOnJSQueueThread {
      if (appContext.hasActiveReactInstance()) {
        appContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("movementChanged", payload)
      }
    }
  }

  companion object {
    private const val MOVEMENT_THRESHOLD_KMH = 1.0f
    private const val WALKING_TEST_MAX_THRESHOLD_KMH = 5.0f
    private const val METERS_PER_SECOND_TO_KMH = 3.6f
    private const val MAX_GPS_ACCURACY_METERS = 25f
    private const val GPS_UPDATE_INTERVAL_MILLIS = 3_000L
    private const val GPS_FALLBACK_DELAY_MILLIS = 8_000L
    private const val GPS_SMOOTHING_SAMPLE_COUNT = 3
    private const val GPS_CONFIRMATION_SAMPLES = 3
    private const val REQUIRED_STEPS = 3
    private const val STEP_WINDOW_MILLIS = 4_000L
    private const val STEP_QUIET_TIMEOUT_MILLIS = 4_000L
  }
}
