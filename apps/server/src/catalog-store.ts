import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CatalogItem } from './types';

export class CatalogStore {
  constructor(private readonly filePath: string) {}

  list(): CatalogItem[] {
    return this.readItems().sort((left, right) => {
      return right.uploadedAt.localeCompare(left.uploadedAt);
    });
  }

  findByOriginalName(originalName: string): CatalogItem | undefined {
    return this.readItems().find((item) => item.originalName === originalName);
  }

  addUploadedItem(input: {
    originalName: string;
    storedName: string;
    sizeBytes: number;
    relativePath: string;
  }): CatalogItem {
    const items = this.readItems();
    const item: CatalogItem = {
      id: randomUUID(),
      originalName: input.originalName,
      storedName: input.storedName,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
      relativePath: input.relativePath
    };

    items.push(item);
    this.writeItems(items);
    return item;
  }

  private readItems(): CatalogItem[] {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CatalogItem[]) : [];
  }

  private writeItems(items: CatalogItem[]): void {
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2) + '\n', 'utf8');
  }
}
