import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

import { DataSource,IndexDocument } from '../types';

@Injectable()
export class FileSaverService {
    private readonly logger = new Logger(FileSaverService.name);
    private readonly outputDir: string;

    constructor(private configService: ConfigService) {
        this.outputDir = this.configService.get<string>('OUTPUT_DIR', './data');
        this.ensureDirectoryExists(this.outputDir);
    }

    private ensureDirectoryExists(dirPath: string) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    async saveDocuments(source: DataSource, documents: IndexDocument[]): Promise<void> {
        const sourceDir = path.join(this.outputDir, source);
        this.ensureDirectoryExists(sourceDir);

        for (const doc of documents) {
            await this.saveDocument(sourceDir, doc);
        }
    }

    private async saveDocument(sourceDir: string, doc: IndexDocument): Promise<void> {
        const safeId = doc.id.replace(/[^a-zA-Z0-9-_]/g, '_');
        const filename = `${safeId}.md`;
        const filePath = path.join(sourceDir, filename);

        const content = this.formatDocument(doc);

        try {
            await fs.promises.writeFile(filePath, content, 'utf8');
        } catch (error) {
            this.logger.error(`Failed to write file ${filePath}: ${error.message}`);
            throw error;
        }
    }

    async deleteDocument(source: DataSource, documentId: string): Promise<void> {
        const sourceDir = path.join(this.outputDir, source);
        const safeId = documentId.replace(/[^a-zA-Z0-9-_]/g, '_');
        const filename = `${safeId}.md`;
        const filePath = path.join(sourceDir, filename);

        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
                this.logger.log(`Deleted file: ${filePath}`);
            }
        } catch (error) {
            this.logger.error(`Failed to delete file ${filePath}: ${error.message}`);
        }
    }

    private formatDocument(doc: IndexDocument): string {
        const metadataYaml = this.createYamlFrontmatter(doc.metadata);

        return `---
${metadataYaml}
---

# ${doc.metadata.title || 'Untitled'}

${doc.content}
`;
    }

    private createYamlFrontmatter(metadata: any): string {
        try {
            // Filter out internal fields or complex objects if needed
            const safeMetadata = {
                ...metadata,
                generated_at: new Date().toISOString()
            };

            // Simple YAML serialization
            return Object.entries(safeMetadata)
                .map(([key, value]) => {
                    if (value === undefined || value === null) return null;
                    if (Array.isArray(value)) {
                        return `${key}: [${value.map(v => JSON.stringify(v)).join(', ')}]`;
                    }
                    if (typeof value === 'object') {
                        return `${key}: ${JSON.stringify(value)}`;
                    }
                    return `${key}: ${JSON.stringify(value)}`;
                })
                .filter(Boolean)
                .join('\n');
        } catch (e) {
            return `error_serializing_metadata: ${e.message}`;
        }
    }
}
