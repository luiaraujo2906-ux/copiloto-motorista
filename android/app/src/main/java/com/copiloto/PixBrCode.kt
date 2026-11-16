package com.copiloto

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.QRCodeWriter
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.util.EnumMap
import java.util.Locale

internal object PixBrCode {
  fun createPayload(
    key: String,
    name: String,
    city: String,
    amount: Double? = null,
  ): String {
    val trimmedKey = key.trim()
    val compactNumericKey = trimmedKey.replace(Regex("[\\s()./-]"), "")
    val normalizedKey = if (compactNumericKey.matches(Regex("^\\+?\\d+$"))) {
      compactNumericKey
    } else {
      trimmedKey
    }
    val normalizedName = normalizeDisplayField(name)
    val normalizedCity = normalizeDisplayField(city)
    require(normalizedKey.isNotBlank()) { "Configure a chave Pix nas configurações." }
    require(normalizedName.isNotBlank()) { "Configure o nome do recebedor nas configurações." }
    require(normalizedCity.isNotBlank()) { "Configure a cidade do recebedor nas configurações." }
    require(utf8Length(normalizedKey) <= 77) { "A chave Pix deve ter no máximo 77 bytes." }
    require(utf8Length(normalizedName) <= 25) { "O nome do recebedor deve ter no máximo 25 bytes." }
    require(utf8Length(normalizedCity) <= 15) { "A cidade deve ter no máximo 15 bytes." }

    val merchantAccount = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", normalizedKey)
    var payload = tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", merchantAccount) +
      tlv("52", "0000") +
      tlv("53", "986")

    if (amount != null) {
      require(amount.isFinite() && amount > 0.0) { "Informe um valor válido para o Pix." }
      payload += tlv(
        "54",
        String.format(Locale.US, "%.2f", amount),
      )
    }

    payload += tlv("58", "BR") +
      tlv("59", normalizedName) +
      tlv("60", normalizedCity) +
      tlv("62", tlv("05", "***")) +
      "6304"
    return payload + crc16(payload)
  }

  fun createQrBitmap(payload: String, size: Int): Bitmap {
    val hints = EnumMap<EncodeHintType, Any>(EncodeHintType::class.java).apply {
      put(EncodeHintType.MARGIN, 4)
      put(EncodeHintType.CHARACTER_SET, StandardCharsets.UTF_8.name())
      put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M)
    }
    val matrix = QRCodeWriter().encode(
      payload,
      BarcodeFormat.QR_CODE,
      size,
      size,
      hints,
    )
    return Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).apply {
      for (y in 0 until size) {
        for (x in 0 until size) {
          setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
        }
      }
    }
  }

  private fun tlv(id: String, value: String): String {
    val byteLength = utf8Length(value)
    require(byteLength <= 99) { "Pix field is too long." }
    return id + String.format(Locale.US, "%02d", byteLength) + value
  }

  private fun utf8Length(value: String) =
    value.toByteArray(StandardCharsets.UTF_8).size

  private fun normalizeDisplayField(value: String): String =
    Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
      .replace(Regex("\\p{M}+"), "")
      .uppercase(Locale.ROOT)
      .replace(Regex("[^\\x20-\\x7E]"), " ")
      .replace(Regex("\\s+"), " ")
      .trim()

  private fun crc16(value: String): String {
    var crc = 0xFFFF
    value.toByteArray(StandardCharsets.UTF_8).forEach { byte ->
      crc = crc xor ((byte.toInt() and 0xFF) shl 8)
      repeat(8) {
        crc = if (crc and 0x8000 != 0) {
          (crc shl 1) xor 0x1021
        } else {
          crc shl 1
        }
        crc = crc and 0xFFFF
      }
    }
    return String.format(Locale.US, "%04X", crc)
  }
}
