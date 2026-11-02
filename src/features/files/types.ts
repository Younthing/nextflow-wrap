export interface FsEntry { name: string; path: string; kind: "file" | "directory"; size?: number }
export interface FsListing { path: string; parent?: string; entries: FsEntry[]; home: string }
