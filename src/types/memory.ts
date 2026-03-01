export interface Memory {
    id: string;
    text: string;
    tags: string[];
    createdAt: string;
    embedding: number[];
}

export interface MemorySearchResult {
    memory: Memory;
    score: number;
}

export interface MemoryStoreData {
    memories: Memory[];
    version: number;
}
