import { describe, expect, it } from "vitest"
import {
  parseAdditionalAuthProviders,
  supportsEmailVerification,
} from "../auth-provider-login"

describe("OIDC login item selection", () => {
  it("shows one item for a bare OIDC provider", () => {
    expect(parseAdditionalAuthProviders(["OIDC", "OIDC"], "OIDC")).toEqual([
      { id: "OIDC" },
    ])
  })
  it("supports exact OIDC:name variants and rejects misleading prefixes", () => {
    expect(
      parseAdditionalAuthProviders(
        ["OIDC_BAD", "OIDC:", "OIDC:Company", "OIDC:Company"],
        "OIDC"
      )
    ).toEqual([{ id: "OIDC:Company", name: "Company" }])
    expect(parseAdditionalAuthProviders(["OTHER:Company"], "OIDC")).toEqual([])
  })
  it("preserves other exact additional item identifiers", () => {
    expect(
      parseAdditionalAuthProviders(["OTHER", "OTHER_BAD"], "OTHER")
    ).toEqual([{ id: "OTHER" }])
  })
  it("preserves cloud verification by default and respects selfhost capability", () => {
    expect(supportsEmailVerification({})).toBe(true)
    expect(
      supportsEmailVerification({ supportsEmailVerification: false })
    ).toBe(false)
  })
})
