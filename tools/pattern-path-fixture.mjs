// Authored native-Path2D double for the logical real-Wasm Canvas recorders.
// Its rectangle payload is diagnostic geometry, not a raster/pixel oracle.
export class Path2D {
  static failure = null;
  static rectFailure = null;
  rectangles = [];
  constructor() { if (Path2D.failure !== null) throw Path2D.failure; }
  rect(...args) { if (Path2D.rectFailure !== null) throw Path2D.rectFailure; this.rectangles.push(args); }
}

export function recordPatternPath(context, path) {
  if (!(path instanceof Path2D)) return false;
  if (path.rectangles.length !== 1) throw new Error('One fresh rectangular path required');
  context.trace.push({ op: 'patternFill', args: path.rectangles[0].slice(), path,
    color: context.fillStyle, alpha: context.alpha, blend: context.blend,
    transforms: context.transforms.slice() });
  return true;
}
