/** Bounded review snapshots; one oversized entry may exceed the byte target. */
export class OperatorPrefetchCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  private generation = 0;
  epoch():number { return this.generation; }
  invalidateWhere(predicate:(value:T)=>boolean):void { this.generation++; for(const [key,entry] of this.entries)if(predicate(entry.value))this.delete(key); }
  setIfCurrent(key:string,value:T,epoch:number):boolean { if(epoch!==this.generation)return false;this.set(key,value);return true; }
  constructor(private readonly maxEntries = 20, private readonly maxBytes = 4 * 1024 * 1024) {}
  get(key: string): T | undefined { return this.entries.get(key)?.value; }
  set(key: string, value: T): void {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    this.delete(key);
    while (this.entries.size > 0 && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
  }
  delete(key: string): void { const entry = this.entries.get(key); if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); } }
  retain(keys: Set<string>): void { for (const key of this.entries.keys()) if (!keys.has(key)) this.delete(key); }
}
