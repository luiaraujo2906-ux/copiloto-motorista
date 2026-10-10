package com.copiloto

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityService.ScreenshotResult
import android.graphics.Bitmap
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
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
  private val maxNodes = 500
  private var analysisSequence = 0L
  private var pendingAnalysis: Runnable? = null
  private var recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private var lastFingerprint: String? = null

  override fun onServiceConnected() {
    super.onServiceConnected()
    serviceInfo = serviceInfo.apply {
      flags = flags or
        android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
        android.accessibilityservice.AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (!ScreenMonitorSettings.isMonitoring(this)) {
      analysisSequence += 1
      pendingAnalysis?.let(handler::removeCallbacks)
      pendingAnalysis = null
      lastFingerprint = null
      return
    }
    if (event == null) return
    val eventPackage = event.packageName?.toString() ?: return
    if (eventPackage == packageName || !isRelevantEvent(event.eventType)) return

    analysisSequence += 1
    val sequence = analysisSequence
    val epoch = ScreenMonitorSettings.epoch(this)
    pendingAnalysis?.let(handler::removeCallbacks)
    pendingAnalysis = Runnable { analyze(sequence, epoch, eventPackage) }
    handler.postDelayed(pendingAnalysis!!, DEBOUNCE_MILLIS)
  }

  private fun isRelevantEvent(eventType: Int): Boolean =
    eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
      eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
      eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED ||
      eventType == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED ||
      eventType == AccessibilityEvent.TYPE_VIEW_CLICKED

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
    if (root == null || foregroundPackage.isNullOrBlank() || foregroundPackage == packageName) {
      return
    }

    val accessibilityElements = collectAccessibilityElements(root)
    val displayMetrics = DisplayMetrics()
    getSystemService(DisplayManager::class.java)
      .getDisplay(Display.DEFAULT_DISPLAY)
      ?.getRealMetrics(displayMetrics)
    val payload = ScreenPayload(
      packageName = foregroundPackage.ifBlank { eventPackage },
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
            !ScreenMonitorSettings.isMonitoring(this@AccessibilityScreenService)
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
      payload.packageName == packageName
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

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    pendingAnalysis?.let(handler::removeCallbacks)
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
    private const val DEBOUNCE_MILLIS = 350L
  }
}
