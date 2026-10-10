package com.copiloto

internal object TargetAppPackages {
  val packages: Set<String> = setOf(
    "com.taxis99.driver",
  )

  fun contains(packageName: String): Boolean = packageName in packages
}
