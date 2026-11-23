/**
 * Development only. In production the bot and web connect as scrimbot_bot and scrimbot_web, whose
 * passwords the bot sets from Podman secrets (prepareDatabase). In dev everything would otherwise run as the
 * owner, which can do anything, so a missing permission would only show up after deploying.
 * These helpers give the two roles a fixed local password, so dev runs under the same grants.
 * Lives outside the built code, so none of it is in the production image.
 */
export type AppRole = "scrimbot_bot" | "scrimbot_web";

export const devPassword = (role: AppRole) => `${role}-dev-only`;

/** The owner's connection URL, rewritten to log in as one of the app roles. */
export function devRoleUrl(ownerUrl: string, role: AppRole): string {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = devPassword(role);
  return url.toString();
}
