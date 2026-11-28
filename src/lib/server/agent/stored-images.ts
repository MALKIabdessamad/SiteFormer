/**
 * Screenshots and generated images are stored per project as "<project>/<run>/<file>". The server
 * reads storage with full access, so a path the model hands back must name exactly one of this
 * project's files: a ".." segment would be resolved by the storage URL into another project's
 * folder.
 */
const STORED_IMAGE =
  /^[A-Za-z0-9_-]{8,100}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\.(?:jpe?g|png|webp|gif)$/

/** Whether `path` points into this project's stored images (it may still not exist). */
export const isStoredImagePath = (projectId: string, path: string) =>
  path.startsWith(`${projectId}/`)

/** Whether `path` is a well-formed stored image of this project (nothing outside its folder). */
export const isValidStoredImagePath = (projectId: string, path: string) =>
  isStoredImagePath(projectId, path) && STORED_IMAGE.test(path.slice(projectId.length + 1))
