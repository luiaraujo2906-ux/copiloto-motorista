package com.copiloto

internal object TargetAppPackages {
  val packages: Set<String> = setOf(
    "com.app99.driver",
  )

  fun contains(packageName: String): Boolean = packageName in packages
}
