package com.copiloto

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityService.ScreenshotResult
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.security.MessageDigest
import java.util.ArrayDeque
import java.util.concurrent.Executor

class AccessibilityScreenService : AccessibilityService() {
  private val handler = Handler(Looper.getMainLooper())
  private val mainExecutor: Executor = Executor { command -> handler.post(command) }
  private val windowManager by lazy { getSystemService(WindowManager::class.java) }
  private val maxNodes = 500
  private var analysisSequence = 0L
  private var pendingAnalysis: Runnable? = null
  private var recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private var lastFingerprint: String? = null
  private var fareSignalView: FrameLayout? = null
  private var fareSignalDismiss: Runnable? = null

  override fun onServiceConnected() {
    super.onServiceConnected()
    currentService = this
    serviceInfo = serviceInfo.apply {
      flags = flags or
        android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
        android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !isRelevantEvent(event.eventType)) return

    if (!ScreenMonitorSettings.isMonitoring(this)) {
      hideFareSignal()
      lastFingerprint = null
      return
    }
    val eventPackage = event.packageName?.toString()
    if (eventPackage == null || !TargetAppPackages.contains(eventPackage)) {
      if (eventPackage == packageName) {
        return
      }

      val foregroundPackage = rootInActiveWindow?.packageName?.toString()
      if (foregroundPackage != null && TargetAppPackages.contains(foregroundPackage)) {
        return
      }

      analysisSequence += 1
      pendingAnalysis?.let(handler::removeCallbacks)
      pendingAnalysis = null
      hideFareSignal()
      lastFingerprint = null
      return
    }

    analysisSequence += 1
    val sequence = analysisSequence
    pendingAnalysis?.let(handler::removeCallbacks)
    pendingAnalysis = null

    val epoch = ScreenMonitorSettings.epoch(this)
    pendingAnalysis = Runnable { analyze(sequence, epoch, eventPackage) }
    handler.postDelayed(pendingAnalysis!!, SCREEN_SETTLE_DELAY_MILLIS)
  }

  fun showFareSignal(
    fare: String,
    distance: String,
    time: String,
    rate: String,
    suggestedFare: String,
    classification: String,
    backgroundColor: String,
    onComplete: (Exception?) -> Unit,
  ) {
    handler.post {
      try {
        fareSignalDismiss?.let(handler::removeCallbacks)
        fareSignalView?.let(windowManager::removeView)

        val card = LinearLayout(this).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(dp(16), dp(12), dp(16), dp(12))
          background = GradientDrawable().apply {
            setColor(Color.parseColor(backgroundColor))
            cornerRadius = dp(14).toFloat()
          }
          elevation = dp(8).toFloat()
        }
        val offerDetails = LinearLayout(this).apply {
          orientation = LinearLayout.VERTICAL
          addView(
            TextView(this@AccessibilityScreenService).apply {
              text = "FAROL DE VALORES · ${classification.uppercase()}"
              setTextColor(Color.WHITE)
              textSize = 14f
              setTypeface(typeface, Typeface.BOLD)
            },
          )
          addView(signalText(fare, 22f, true))
          addView(signalText("$distance · $time", 15f))
          addView(signalText("$rate", 15f, true))
        }
        card.addView(
          offerDetails,
          LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f),
        )
        card.addView(
          View(this@AccessibilityScreenService).apply {
            setBackgroundColor(Color.argb(110, 255, 255, 255))
          },
          LinearLayout.LayoutParams(dp(1), dp(64)).apply {
            marginStart = dp(12)
            marginEnd = dp(12)
          },
        )
        card.addView(
          LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            addView(
              TextView(this@AccessibilityScreenService).apply {
                text = "VALOR SUGERIDO"
                setTextColor(Color.WHITE)
                textSize = 11f
                setTypeface(typeface, Typeface.BOLD)
                gravity = Gravity.END
              },
            )
            addView(
              TextView(this@AccessibilityScreenService).apply {
                text = suggestedFare
                setTextColor(Color.WHITE)
                textSize = 20f
                setTypeface(typeface, Typeface.BOLD)
                gravity = Gravity.END
                maxLines = 1
              },
            )
          },
        )

        val overlay = FrameLayout(this).apply {
          setPadding(dp(16), dp(8), dp(16), dp(8))
          addView(
            card,
            FrameLayout.LayoutParams(
              FrameLayout.LayoutParams.MATCH_PARENT,
              FrameLayout.LayoutParams.WRAP_CONTENT,
            ),
          )
        }
        val layoutParams = WindowManager.LayoutParams(
          WindowManager.LayoutParams.MATCH_PARENT,
          WindowManager.LayoutParams.WRAP_CONTENT,
          WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
          WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
          android.graphics.PixelFormat.TRANSLUCENT,
        ).apply {
          gravity = Gravity.TOP
          y = dp(24)
        }
        windowManager.addView(overlay, layoutParams)
        fareSignalView = overlay

        val dismiss = Runnable { removeFareSignalView() }
        fareSignalDismiss = dismiss
        handler.postDelayed(dismiss, FARE_SIGNAL_DURATION_MILLIS)
        onComplete(null)
      } catch (error: Exception) {
        removeFareSignalView()
        onComplete(error)
      }
    }
  }

  fun hideFareSignal() {
    handler.post { removeFareSignalView() }
  }

  private fun signalText(text: String, size: Float, bold: Boolean = false) =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      textSize = size
      if (bold) setTypeface(typeface, Typeface.BOLD)
      setPadding(0, dp(2), 0, dp(2))
    }

  private fun removeFareSignalView() {
    fareSignalDismiss?.let(handler::removeCallbacks)
    fareSignalDismiss = null
    fareSignalView?.let { view ->
      if (view.isAttachedToWindow) {
        windowManager.removeView(view)
      }
    }
    fareSignalView = null
  }

  private fun dp(value: Int): Int =
    (value * resources.displayMetrics.density).toInt()

  private fun isRelevantEvent(eventType: Int): Boolean =
    eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
      eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED ||
      eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED ||
      eventType == AccessibilityEvent.TYPE_VIEW_CLICKED ||
      eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED ||
      eventType == AccessibilityEvent.TYPE_VIEW_SELECTED

  private fun analyze(sequence: Long, epoch: Long, eventPackage: String) {
    if (
      sequence != analysisSequence ||
      epoch != ScreenMonitorSettings.epoch(this) ||
      !ScreenMonitorSettings.isMonitoring(this)
    ) {
      return
    }

    val root = rootInActiveWindow
    val foregroundPackage = root?.packageName?.toString()
    if (
      root == null ||
      foregroundPackage.isNullOrBlank() ||
      foregroundPackage != eventPackage ||
      !TargetAppPackages.contains(foregroundPackage)
    ) {
      return
    }

    val accessibilityElements = collectAccessibilityElements(root)
    val displayMetrics = DisplayMetrics()
    getSystemService(DisplayManager::class.java)
      .getDisplay(Display.DEFAULT_DISPLAY)
      ?.getRealMetrics(displayMetrics)
    val payload = ScreenPayload(
      packageName = foregroundPackage,
      capturedAt = System.currentTimeMillis(),
      accessibilityElements = accessibilityElements,
      screenWidth = displayMetrics.widthPixels,
      screenHeight = displayMetrics.heightPixels,
      monitoringEpoch = epoch,
    )

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      emitIfChanged(sequence, payload, emptyList(), "unavailable", null)
      return
    }

    takeScreenshot(sequence, payload)
  }

  private fun collectAccessibilityElements(root: AccessibilityNodeInfo): List<ScreenElementData> {
    val elements = mutableListOf<ScreenElementData>()
    val pendingNodes = ArrayDeque<AccessibilityNodeInfo>()
    var visitedNodes = 0
    pendingNodes.add(root)

    while (pendingNodes.isNotEmpty() && visitedNodes < maxNodes) {
      val node = pendingNodes.removeFirst()
      visitedNodes += 1
      val bounds = Rect()
      node.getBoundsInScreen(bounds)

      if (!bounds.isEmpty) {
        val common = ScreenElementData(
          text = "",
          bounds = bounds,
          source = "accessibility",
          className = node.className?.toString(),
          resourceId = node.viewIdResourceName,
        )
        node.text?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let {
          elements.add(common.copy(text = it))
        }
        node.contentDescription?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let {
          if (it != node.text?.toString()?.trim()) {
            elements.add(common.copy(text = it))
          }
        }
      }

      for (index in 0 until node.childCount) {
        if (visitedNodes + pendingNodes.size >= maxNodes) break
        node.getChild(index)?.let(pendingNodes::addLast)
      }
    }
    return elements
  }

  private fun takeScreenshot(sequence: Long, payload: ScreenPayload) {
    takeScreenshot(
      Display.DEFAULT_DISPLAY,
      mainExecutor,
      object : AccessibilityService.TakeScreenshotCallback {
        override fun onSuccess(screenshot: ScreenshotResult) {
          if (
            sequence != analysisSequence ||
            payload.monitoringEpoch != ScreenMonitorSettings.epoch(this@AccessibilityScreenService) ||
            !ScreenMonitorSettings.isMonitoring(this@AccessibilityScreenService) ||
            !isTargetForeground(payload.packageName)
          ) {
            screenshot.hardwareBuffer.close()
            return
          }

          val bitmap = try {
            Bitmap.wrapHardwareBuffer(screenshot.hardwareBuffer, screenshot.colorSpace)
              ?.copy(Bitmap.Config.ARGB_8888, false)
          } finally {
            screenshot.hardwareBuffer.close()
          }

          if (bitmap == null) {
            emitIfChanged(sequence, payload, emptyList(), "failed", "Could not read screenshot")
            return
          }

          payload.screenWidth = bitmap.width
          payload.screenHeight = bitmap.height
          processOcr(sequence, payload, bitmap)
        }

        override fun onFailure(errorCode: Int) {
          emitIfChanged(
            sequence,
            payload,
            emptyList(),
            "failed",
            "Screenshot capture failed (code $errorCode)",
          )
        }
      },
    )
  }

  private fun processOcr(sequence: Long, payload: ScreenPayload, bitmap: Bitmap) {
    val task: Task<Text> = recognizer.process(InputImage.fromBitmap(bitmap, 0))
    task
      .addOnSuccessListener { result ->
        val elements = result.textBlocks.flatMap { block ->
          block.lines.mapNotNull { line ->
            val bounds = line.boundingBox ?: return@mapNotNull null
            val text = line.text.trim()
            if (text.isEmpty()) return@mapNotNull null
            ScreenElementData(
              text = text,
              bounds = bounds,
              source = "ocr",
              confidence = line.confidence.takeIf { it >= 0f },
            )
          }
        }
        emitIfChanged(sequence, payload, elements, "complete", null)
      }
      .addOnFailureListener { error ->
        emitIfChanged(
          sequence,
          payload,
          emptyList(),
          "failed",
          error.localizedMessage ?: "Text recognition failed",
        )
      }
      .addOnCompleteListener {
        bitmap.recycle()
      }
  }

  private fun emitIfChanged(
    sequence: Long,
    payload: ScreenPayload,
    ocrElements: List<ScreenElementData>,
    ocrStatus: String,
    ocrError: String?,
  ) {
    if (
      sequence != analysisSequence ||
      payload.monitoringEpoch != ScreenMonitorSettings.epoch(this) ||
      !ScreenMonitorSettings.isMonitoring(this) ||
      !isTargetForeground(payload.packageName)
    ) {
      return
    }

    val elements = payload.accessibilityElements + ocrElements
    val fingerprint = fingerprint(payload.packageName, elements, ScreenMonitorSettings.epoch(this))
    if (fingerprint == lastFingerprint) return
    lastFingerprint = fingerprint

    ScreenMonitorEventEmitter.emit(
      Arguments.createMap().apply {
        putString("packageName", payload.packageName)
        putDouble("capturedAt", payload.capturedAt.toDouble())
        putInt("screenWidth", payload.screenWidth)
        putInt("screenHeight", payload.screenHeight)
        putArray("accessibilityElements", payload.accessibilityElements.toWritableArray())
        putArray("ocrElements", ocrElements.toWritableArray())
        putString("ocrStatus", ocrStatus)
        if (ocrError != null) putString("ocrError", ocrError)
      },
    )
  }

  private fun fingerprint(
    packageName: String,
    elements: List<ScreenElementData>,
    epoch: Long,
  ): String {
    val content = buildString {
      append(packageName)
      append('|')
      append(epoch)
      elements.forEach { element ->
        append('|')
        append(element.source)
        append(':')
        append(element.text)
        append(':')
        append(element.bounds.coordinateKey())
      }
    }
    return MessageDigest.getInstance("SHA-256")
      .digest(content.toByteArray())
      .joinToString("") { "%02x".format(it) }
  }

  private fun isTargetForeground(expectedPackage: String): Boolean =
    TargetAppPackages.contains(expectedPackage) &&
      rootInActiveWindow?.packageName?.toString() == expectedPackage

  override fun onInterrupt() {
    hideFareSignal()
  }

  override fun onDestroy() {
    pendingAnalysis?.let(handler::removeCallbacks)
    removeFareSignalView()
    if (currentService === this) currentService = null
    recognizer.close()
    super.onDestroy()
  }

  private data class ScreenPayload(
    val packageName: String,
    val capturedAt: Long,
    val accessibilityElements: List<ScreenElementData>,
    var screenWidth: Int = 0,
    var screenHeight: Int = 0,
    val monitoringEpoch: Long,
  )

  private data class ScreenElementData(
    val text: String,
    val bounds: Rect,
    val source: String,
    val confidence: Float? = null,
    val className: String? = null,
    val resourceId: String? = null,
  ) {
    fun toWritableMap(): WritableMap = Arguments.createMap().apply {
      putString("text", text)
      putMap("bounds", Arguments.createMap().apply {
        putInt("left", bounds.left)
        putInt("top", bounds.top)
        putInt("right", bounds.right)
        putInt("bottom", bounds.bottom)
      })
      putString("source", source)
      confidence?.let { putDouble("confidence", it.toDouble()) }
      className?.let { putString("className", it) }
      resourceId?.let { putString("resourceId", it) }
    }
  }

  private fun List<ScreenElementData>.toWritableArray(): WritableArray =
    Arguments.createArray().apply {
      forEach { pushMap(it.toWritableMap()) }
    }

  private fun Rect.coordinateKey() = "$left,$top,$right,$bottom"

  companion object {
    private const val SCREEN_SETTLE_DELAY_MILLIS = 800L
    private const val FARE_SIGNAL_DURATION_MILLIS = 10_000L

    @Volatile
    var currentService: AccessibilityScreenService? = null
      private set
  }
}
