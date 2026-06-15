import { access } from "node:fs/promises";
import { join } from "node:path";

type StoredFilePath = {
  volumeName: string;
  relativePath: string;
  absolutePathSnapshot: string;
};

export async function resolveStoredFilePath(file: StoredFilePath): Promise<string> {
  for (const volumePath of candidatePaths(file)) {
    try {
      await access(volumePath);
      return volumePath;
    } catch {
      // Try the next candidate below.
    }
  }

  return file.absolutePathSnapshot;
}

function candidatePaths(file: StoredFilePath): string[] {
  const candidates = [
    candidateFromVolume(file.volumeName, file.relativePath),
    candidateFromLocalSnapshot(file.volumeName, file.absolutePathSnapshot),
    file.absolutePathSnapshot,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return Array.from(new Set(candidates));
}

function candidateFromVolume(volumeName: string, relativePath: string): string | null {
  if (!volumeName) {
    return null;
  }

  if (volumeName === "local") {
    return join(process.cwd(), relativePath);
  }

  return join("/Volumes", volumeName, relativePath);
}

function candidateFromLocalSnapshot(volumeName: string, absolutePathSnapshot: string): string | null {
  if (volumeName !== "local") {
    return null;
  }

  const normalizedSnapshot = absolutePathSnapshot.replace(/\\/g, "/");
  const localMarkers = ["/data/source-archive/", "/sample-data/", "/sample data/"];

  for (const marker of localMarkers) {
    const markerIndex = normalizedSnapshot.indexOf(marker);
    if (markerIndex >= 0) {
      return join(process.cwd(), normalizedSnapshot.slice(markerIndex + 1));
    }
  }

  return null;
}
