// Placeholder — Mobile Runtime pillar (LiteParse WASM document parser)
export interface ParsedDocument {
  text: string;
  metadata: Record<string, string>;
  chunks: string[];
}

export class DocumentParser {
  async parse(_blob: Blob): Promise<ParsedDocument> {
    // LiteParse WASM integration pending
    throw new Error('DocumentParser.parse — not implemented (placeholder)');
  }
}
