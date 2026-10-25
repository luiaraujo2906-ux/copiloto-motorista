package com.copiloto

internal object TargetAppPackages {
  val packages: Set<String> = setOf(
    "com.app99.driver",
    "com.sec.android.gallery3d"
  )

  fun contains(packageName: String): Boolean = packageName in packages
}
