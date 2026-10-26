/** Desktop backing dimensions for a positive viewport, with no UI insets or DPR multiplier. */
export function desktopBackingSize(areaWidth, areaHeight) {
  if (!Number.isFinite(areaWidth) || !Number.isFinite(areaHeight) || areaWidth <= 0 || areaHeight <= 0) {
    throw new Error('Desktop viewport dimensions must be positive finite numbers');
  }
  const width = Math.ceil(areaWidth), height = Math.ceil(areaHeight);
  const diagonal = Math.sqrt(width * width + height * height);
  if (!Number.isFinite(diagonal) || diagonal === 0) throw new Error('Desktop viewport diagonal is invalid');
  let backingWidth = Math.ceil(width * 1800 / diagonal);
  let backingHeight = Math.ceil(height * 1800 / diagonal);
  if (backingWidth > 1500) {
    backingHeight = Math.ceil(backingHeight * 1500 / backingWidth);
    backingWidth = 1500;
  }
  if (backingHeight > 1500) {
    backingWidth = Math.ceil(backingWidth * 1500 / backingHeight);
    backingHeight = 1500;
  }
  return { width: backingWidth, height: backingHeight };
}
