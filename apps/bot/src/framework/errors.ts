/** A problem the user can act on. The router shows them this message instead of a generic one. */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}
