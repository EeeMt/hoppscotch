import { describe, expect, it } from "vitest"
import {
  consumeOIDCLoginReturn,
  saveOIDCLoginReturn,
  validateOIDCLoginReturn,
} from "../oidc-login-return"

describe("fixed device login return", () => {
  const base = "https://hopp.internal/tools/"
  const target =
    base +
    "device-login?redirect_uri=" +
    encodeURIComponent("http://localhost:12345/device-token")
  it("accepts only the app device-login path and a valid existing loopback target", () => {
    expect(validateOIDCLoginReturn(target, base)).toBe(target)
    for (const value of [
      target.replace("hopp.internal", "evil.example"),
      "//evil.example/device-login",
      target.replace("/tools/device-login", "/device-login"),
      base + "device-login?redirect_uri=https://localhost:12345",
      base + "device-login?redirect_uri=http://user:pass@localhost:12345",
      target + "&redirect_uri=http://evil.example",
      target + "&token=secret",
    ])
      expect(validateOIDCLoginReturn(value, base)).toBeNull()
  })
  it("saves only a validated route, consumes it once and clears invalid storage", () => {
    const storage = new Map<string, string>()
    const store = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v)
      },
      removeItem: (k: string) => {
        storage.delete(k)
      },
    }
    saveOIDCLoginReturn(store, target, base)
    expect(consumeOIDCLoginReturn(store, base)).toBe(target)
    expect(consumeOIDCLoginReturn(store, base)).toBeNull()
    saveOIDCLoginReturn(store, "https://evil.example/", base)
    expect(consumeOIDCLoginReturn(store, base)).toBeNull()
  })
})
