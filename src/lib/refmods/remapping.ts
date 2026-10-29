'use client'
let epoch = 0
let restoring = 0
export function beginReferenceRestore() {
  restoring++
  epoch++
}
export function endReferenceRestore() {
  restoring = Math.max(0, restoring - 1)
  epoch++
}
export function referenceRestoreState() {
  return { epoch, restoring: restoring > 0 }
}
