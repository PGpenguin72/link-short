import { describe, expect, it } from 'vitest'
import { hasExpectedOrigin, isAllowedTargetUrl, requiresOriginCheck } from '../src-worker/security'

describe('cookie-authenticated mutation security', () => {
  it('allows only the configured same origin for unsafe methods', () => {
    expect(requiresOriginCheck('POST')).toBe(true)
    expect(requiresOriginCheck('PUT')).toBe(true)
    expect(requiresOriginCheck('DELETE')).toBe(true)
    expect(requiresOriginCheck('GET')).toBe(false)
    expect(hasExpectedOrigin('https://link.pg72.tw', 'https://link.pg72.tw')).toBe(true)
    expect(hasExpectedOrigin(undefined, 'https://link.pg72.tw')).toBe(false)
    expect(hasExpectedOrigin('https://evil.example', 'https://link.pg72.tw')).toBe(false)
  })

  it('accepts only HTTP(S) redirect targets', () => {
    expect(isAllowedTargetUrl('https://example.com/path')).toBe(true)
    expect(isAllowedTargetUrl('http://example.com/path')).toBe(true)
    expect(isAllowedTargetUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedTargetUrl('data:text/html,hello')).toBe(false)
    expect(isAllowedTargetUrl('ftp://example.com/file')).toBe(false)
  })
})
