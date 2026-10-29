/** Copy a captured Rust viewport projection. No numeric policy or JS fallback. */
export function desktopBackingSize(areaWidth, areaHeight, project) {
  if (typeof areaWidth !== 'number' || typeof areaHeight !== 'number') {
    throw new Error('Desktop viewport dimensions must be positive finite numbers');
  }
  if (typeof project !== 'function') throw new TypeError('Rust desktop layout projection required');
  const value = Reflect.apply(project, undefined, [areaWidth, areaHeight]);
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== 2) throw new TypeError('Copied desktop size required');
  const width = Object.getOwnPropertyDescriptor(value, 'width');
  const height = Object.getOwnPropertyDescriptor(value, 'height');
  if (![width, height].every(field => field && Object.hasOwn(field, 'value')
    && Number.isInteger(field.value) && field.value >= 1 && field.value <= 1500)) throw new TypeError('Desktop size data fields required');
  return { width: width.value, height: height.value };
}
