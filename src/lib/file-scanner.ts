import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, parse, relative, sep } from "node:path";

export type ScannedFileType = "excel" | "pdf" | "image" | "zip";

export type ScannedFile = {
  fileName: string;
  fileType: ScannedFileType;
  fileSize: bigint;
  folderName: string | null;
  factoryGuess: string | null;
  volumeName: string;
  relativePath: string;
  absolutePathSnapshot: string;
  modifiedAt: Date;
  scannedAt: Date;
};

export type ScanErrorReason =
  | "read_error"
  | "unsupported_type"
  | "hidden_file"
  | "symlink"
  | "too_large";

export type ScanError = {
  path: string;
  reason: ScanErrorReason;
  message: string;
};

export type ScanDirectoryOptions = {
  maxFileSizeBytes?: number;
  now?: Date;
};

export type ScanDirectoryResult = {
  rootPath: string;
  files: ScannedFile[];
  errors: ScanError[];
};

const DEFAULT_MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

const SUPPORTED_EXTENSIONS: Record<string, ScannedFileType> = {
  ".xls": "excel",
  ".xlsx": "excel",
  ".csv": "excel",
  ".pdf": "pdf",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
  ".gif": "image",
  ".bmp": "image",
  ".zip": "zip",
  ".rar": "zip",
  ".7z": "zip",
};

export async function scanDirectory(
  rootPath: string,
  options: ScanDirectoryOptions = {},
): Promise<ScanDirectoryResult> {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  const scannedAt = options.now ?? new Date();
  const normalizedRoot = rootPath.normalize("NFC");
  const files: ScannedFile[] = [];
  const errors: ScanError[] = [];

  await walk(normalizedRoot);

  return {
    rootPath: normalizedRoot,
    files,
    errors,
  };

  async function walk(currentPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      errors.push({
        path: currentPath,
        reason: "read_error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const entry of entries) {
      const normalizedName = entry.name.normalize("NFC");
      const absolutePath = join(currentPath, normalizedName);

      if (normalizedName.startsWith(".")) {
        if (entry.isFile()) {
          errors.push({
            path: absolutePath,
            reason: "hidden_file",
            message: "Hidden files are skipped.",
          });
        }
        continue;
      }

      if (entry.isSymbolicLink()) {
        errors.push({
          path: absolutePath,
          reason: "symlink",
          message: "Symlinks are skipped during MVP scanning.",
        });
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileType = classifyFile(normalizedName);
      if (!fileType) {
        errors.push({
          path: absolutePath,
          reason: "unsupported_type",
          message: "Unsupported file type.",
        });
        continue;
      }

      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch (error) {
        errors.push({
          path: absolutePath,
          reason: "read_error",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (stat.size > maxFileSizeBytes) {
        errors.push({
          path: absolutePath,
          reason: "too_large",
          message: `File size ${stat.size} exceeds limit ${maxFileSizeBytes}.`,
        });
        continue;
      }

      const relativePath = toPortableRelativePath(relative(normalizedRoot, absolutePath));
      const parentFolder = basename(dirname(absolutePath));

      files.push({
        fileName: normalizedName,
        fileType,
        fileSize: BigInt(stat.size),
        folderName: parentFolder === "." ? null : parentFolder,
        factoryGuess: guessFactoryName(relativePath),
        volumeName: getVolumeName(normalizedRoot),
        relativePath,
        absolutePathSnapshot: absolutePath,
        modifiedAt: stat.mtime,
        scannedAt,
      });
    }
  }
}

export function classifyFile(fileName: string): ScannedFileType | null {
  const lowerName = fileName.normalize("NFC").toLowerCase();
  const ext = lowerName.slice(lowerName.lastIndexOf("."));
  return SUPPORTED_EXTENSIONS[ext] ?? null;
}

function toPortableRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function getVolumeName(rootPath: string): string {
  const parsed = parse(rootPath);
  const parts = rootPath.split(sep).filter(Boolean);

  if (parts[0] === "Volumes" && parts[1]) {
    return parts[1];
  }

  if (parsed.root) {
    return parsed.root === sep ? "local" : parsed.root;
  }

  return "local";
}

function guessFactoryName(relativePath: string): string | null {
  const firstPart = relativePath.split("/")[0];
  if (!firstPart || firstPart === basename(relativePath)) {
    return null;
  }
  return firstPart;
}
