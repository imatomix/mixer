import { constants } from 'node:fs'

// O_NOFOLLOW: never follow a symbolic link put in place after the checks. O_NONBLOCK: a named pipe or device
// would otherwise make open wait (and hold a file system worker) until something writes to it; regular files are
// not affected, and the descriptor is checked to be a regular file right after opening
export const OPEN_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0)

export function isNotFound(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}
