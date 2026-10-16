export function fileFingerprint(
  file: Pick<File, 'name' | 'size' | 'lastModified' | 'webkitRelativePath'>,
  originalFilename = file.name,
): string {
  const pathParts = (file.webkitRelativePath || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
  const sourceName = pathParts.length > 2
    ? pathParts.slice(1).join('/')
    : originalFilename
  return `${file.size}:${file.lastModified}:${sourceName.toLocaleLowerCase()}`
}
