import { File, Directory } from '@bjorn3/browser_wasi_shim';

/**
 * The packed sysroot image: a 4-byte little-endian manifest length, the JSON manifest,
 * then every file's bytes concatenated.
 *
 * Built by toolchain/ci/pack-sysroot.mjs. Files are handed out as subarray views over the
 * single ArrayBuffer, so materialising the tree copies nothing - which matters when it is
 * 1,361 files and 22 MB.
 */
interface SysrootManifest {
  /** virtual path -> [offset, length] */
  readonly files: Record<string, [number, number]>;
  readonly directories: readonly string[];
}

export interface Sysroot {
  readonly root: Directory;
  readonly fileCount: number;
}

/** Walks to a directory, creating any missing links on the way. */
function ensureDirectory(root: Directory, segments: readonly string[]): Directory {
  let current = root;
  for (const segment of segments) {
    if (segment === '') continue;
    const existing = current.contents.get(segment);
    if (existing instanceof Directory) {
      current = existing;
    } else {
      const created = new Directory(new Map());
      current.contents.set(segment, created);
      current = created;
    }
  }
  return current;
}

/**
 * Turns the packed image into a directory tree the WASI shim can preopen.
 *
 * Every path in the manifest is absolute and starts with the mount point, so the leading
 * segment is stripped: the tree returned here is mounted *as* /sysroot.
 */
export function parseSysroot(image: Uint8Array<ArrayBuffer>, mountPoint = 'sysroot'): Sysroot {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const manifestLength = view.getUint32(0, true);
  const manifestBytes = image.subarray(4, 4 + manifestLength);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SysrootManifest;

  const dataStart = 4 + manifestLength;
  const root = new Directory(new Map());

  // Directories first, so an empty one still exists for clang to stat during header search.
  for (const path of manifest.directories) {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== mountPoint) continue;
    ensureDirectory(root, segments.slice(1));
  }

  let fileCount = 0;
  for (const [path, [offset, length]] of Object.entries(manifest.files)) {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== mountPoint) continue;
    const name = segments[segments.length - 1]!;
    const parent = ensureDirectory(root, segments.slice(1, -1));
    const bytes = image.subarray(dataStart + offset, dataStart + offset + length);
    parent.contents.set(name, new File(bytes));
    fileCount++;
  }

  return { root, fileCount };
}
