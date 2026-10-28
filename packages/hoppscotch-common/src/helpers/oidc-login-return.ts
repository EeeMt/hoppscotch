const KEY = "oidc_device_login_return"
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">

export function isOIDCLoopbackUri(uri: string) {
  try {
    const url = new URL(uri)
    return (
      url.protocol === "http:" &&
      !url.username &&
      !url.password &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  } catch {
    return false
  }
}

export function validateOIDCLoginReturn(
  value: string,
  appBase: string
): string | null {
  try {
    if (!/^https?:\/\//.test(value)) return null
    const base = new URL(appBase)
    const url = new URL(value)
    const path = base.pathname.replace(/\/+$/, "") + "/device-login"
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== path ||
      [...url.searchParams.keys()].some((key) => key !== "redirect_uri") ||
      url.searchParams.getAll("redirect_uri").length !== 1 ||
      !isOIDCLoopbackUri(url.searchParams.get("redirect_uri")!)
    )
      return null
    return url.href
  } catch {
    return null
  }
}

export function saveOIDCLoginReturn(
  storage: Storage,
  value: string,
  appBase: string
) {
  const target = validateOIDCLoginReturn(value, appBase)
  storage.removeItem(KEY)
  if (target) storage.setItem(KEY, target)
}

export function consumeOIDCLoginReturn(storage: Storage, appBase: string) {
  const value = storage.getItem(KEY)
  storage.removeItem(KEY)
  return value ? validateOIDCLoginReturn(value, appBase) : null
}
