// Ambient declarations for third-party packages that ship without published
// TypeScript types. Kept intentionally minimal (the exact call shapes we
// actually use are already typed correctly at the call sites via our own
// wrapper functions in modules/files/*.service.ts) rather than vendoring a
// full type definition for a library we only touch in one place each.

declare module 'clamscan' {
  interface ClamScanOptions {
    clamdscan?: { host?: string; port?: number; timeout?: number };
  }
  interface ScanResult {
    isInfected: boolean;
    viruses: string[];
  }
  export default class NodeClam {
    init(options: ClamScanOptions): Promise<NodeClam>;
    scanStream(stream: NodeJS.ReadableStream): Promise<ScanResult>;
  }
}

declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages?: number;
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
