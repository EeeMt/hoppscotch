export function parseAdditionalAuthProviders(
  providers: string[],
  itemId: string
) {
  return [...new Set(providers)].flatMap((id) => {
    if (id === itemId) return [{ id }]
    if (itemId === "OIDC" && id.startsWith("OIDC:") && id.slice(5).trim()) {
      return [{ id, name: id.slice(5) }]
    }
    return []
  }) as { id: string; name?: string }[]
}

export function supportsEmailVerification(auth: {
  supportsEmailVerification?: boolean
}) {
  return auth.supportsEmailVerification !== false
}
