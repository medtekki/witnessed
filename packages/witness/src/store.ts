import type { Receipt } from "@witnessed/core";

export interface ReceiptStore {
  put(receipt: Receipt): Promise<void>;
  get(id: string): Promise<Receipt | null>;
}

export class InMemoryStore implements ReceiptStore {
  private readonly map = new Map<string, Receipt>();

  async put(receipt: Receipt): Promise<void> {
    if (this.map.has(receipt.id)) {
      throw new Error(`append-only store: id already exists (${receipt.id})`);
    }
    this.map.set(receipt.id, receipt);
  }

  async get(id: string): Promise<Receipt | null> {
    return this.map.get(id) ?? null;
  }
}
