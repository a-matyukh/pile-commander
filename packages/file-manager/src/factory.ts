import type { FileManager } from "./types"
import createMockFileManager from "./mock"
import createLocalFileManager, { type LocalFileManagerOptions } from "./local"
import { createDemoFileManager } from "./demo"

export
type FileManagerType = "local" | "cloud" | "demo"

export
function createFileManager(type: FileManagerType, options?: LocalFileManagerOptions): FileManager {
	if (type === "local") {
		return createLocalFileManager(options)
	}
	if (type === "demo") {
		return createDemoFileManager()
	}
	return createMockFileManager()
}
