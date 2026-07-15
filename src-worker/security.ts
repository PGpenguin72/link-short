const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function hasExpectedOrigin(origin: string | undefined, appBaseUrl: string): boolean {
  if (!origin) return false
  try {
    const configured = new URL(appBaseUrl)
    return configured.origin === appBaseUrl && origin === configured.origin
  } catch {
    return false
  }
}

export function requiresOriginCheck(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

export function isAllowedTargetUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
