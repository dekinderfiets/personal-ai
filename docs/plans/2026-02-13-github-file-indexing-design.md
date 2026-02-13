# GitHub File Indexing + Shared FileProcessorService

## Problem

The GitHub connector has file indexing infrastructure but it doesn't work in practice due to a cursor state bug. Additionally, file processing logic (PDF/DOCX conversion, chunking) is duplicated between Drive and GitHub connectors.

## Changes

### 1. Fix: Cursor state overrides `indexFiles` setting

When resuming from a saved cursor, `state.indexFiles` from the old cursor is never updated with the current `request.indexFiles` value. After deserializing the cursor state, always sync with the incoming request:

```typescript
if (cursor?.syncToken) {
    state = JSON.parse(cursor.syncToken);
    state.indexFiles = request.indexFiles !== false; // always respect current setting
}
```

### 2. Remove the 500 file limit

Remove `MAX_FILES_PER_REPO` constant and the `.slice(0, MAX_FILES_PER_REPO)` call. All files passing `isIndexableFile()` get indexed.

Paginate file fetching: instead of fetching all files in one `fetch()` call, process files in chunks (e.g. 50 per call) and use the cursor to track progress within the files phase. This yields documents incrementally like the issues phase.

### 3. `FileProcessorService` — shared file content extraction

New service at `collector/src/indexing/file-processor.service.ts`.

```typescript
interface ProcessedFile {
    content: string;        // extracted text
    chunks?: string[];      // pre-chunked if large enough
    language?: string;      // detected language for code files
}

@Injectable()
class FileProcessorService {
    constructor(private chunkingService: ChunkingService) {}

    async process(content: string | Buffer, filePath: string, mimeType?: string): Promise<ProcessedFile | null>
    private async convertToText(content: string | Buffer, mimeType: string, fileName: string): Promise<string | null>
    private async chunk(text: string, filePath: string): Promise<{ chunks?: string[]; language?: string }>
}
```

**Moves into this service:**
- `extractTextFromPdf()` from Drive connector
- `usePandoc()` from Drive connector
- Binary/unsupported MIME type detection from Drive connector
- Code vs text chunking decision from GitHub connector

**Stays in connectors:**
- Drive: Google API calls, OAuth, file listing, Google Apps export (API-specific)
- GitHub: GitHub API calls, tree listing, raw file fetching (API-specific)

**Connector usage:**
- Drive: `const result = await fileProcessor.process(responseData, file.name, file.mimeType)` replaces `getFileContent()` body (after Google Apps export)
- GitHub: `const result = await fileProcessor.process(rawContent, item.path)` replaces chunking logic in `fetchFileContent()`
