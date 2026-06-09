import { access } from "node:fs/promises";
import { join } from "node:path";

type StoredFilePath = {
  volumeName: string;
  relativePath: string;
  absolutePathSnapshot: string;
};

export async function resolveStoredFilePath(file: StoredFilePath): Promise<string> {
  const volumePath = candidateFromVolume(file.volumeName, file.relativePath);

  if (volumePath) {
    try {
      await access(volumePath);
      return volumePath;
    } catch {
      // Fall back to scan-time snapshot below.
    }
  }

  return file.absolutePathSnapshot;
}

function candidateFromVolume(volumeName: string, relativePath: string): string | null {
  if (!volumeName || volumeName === "local") {
    return null;
  }

  return join("/Volumes", volumeName, relativePath);
}
