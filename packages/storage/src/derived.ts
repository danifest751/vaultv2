import path from "node:path";

export type DerivedKind = "thumb" | "poster";

export interface DerivedLayout {
  root: string;
}

export function derivedPathForMedia(layout: DerivedLayout, mediaId: string, kind: DerivedKind): string {
  const ext = kind === "thumb" ? ".jpg" : ".jpg";
  return path.join(layout.root, mediaId.slice(0, 2), `${mediaId}.${kind}${ext}`);
}
