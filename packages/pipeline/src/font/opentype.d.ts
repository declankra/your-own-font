// The slice of opentype.js 2.0 this package uses (it ships no type declarations).
declare module "opentype.js" {
  export class Path {
    commands: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    close(): void;
    toPathData(decimalPlaces?: number): string;
  }
  export interface GlyphOptions {
    name: string;
    unicode?: number;
    unicodes?: number[];
    advanceWidth: number;
    path: Path;
  }
  export class Glyph {
    constructor(options: GlyphOptions);
    name: string;
    unicode: number;
    unicodes: number[];
    advanceWidth: number;
    index: number;
    path: Path;
    getPath(x?: number, y?: number, fontSize?: number): Path;
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  }
  export interface FontOptions {
    familyName: string;
    styleName: string;
    fullName?: string;
    postScriptName?: string;
    designer?: string;
    designerURL?: string;
    manufacturer?: string;
    manufacturerURL?: string;
    license?: string;
    licenseURL?: string;
    version?: string;
    description?: string;
    copyright?: string;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    weightClass?: number;
    glyphs: Glyph[];
    tables?: Record<string, unknown>;
  }
  export class Font {
    constructor(options: FontOptions);
    names: Record<string, Record<string, { en: string }>>;
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: { length: number; get(i: number): Glyph };
    tables: Record<string, any>;
    toArrayBuffer(): ArrayBuffer;
    charToGlyph(c: string): Glyph;
    hasChar(c: string): boolean;
    stringToGlyphs(s: string, options?: unknown): Glyph[];
    getEnglishName(name: string): string;
  }
  export function parse(buffer: ArrayBuffer, opt?: unknown): Font;
}
