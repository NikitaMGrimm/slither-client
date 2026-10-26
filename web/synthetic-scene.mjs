// Entirely synthetic protocol-19 scene. No captured packets or external assets.
const u16 = value => [value >>> 8 & 255, value & 255];
const u24 = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];
const center = 32550;
const absolute = value => u24(Math.round((center + value) * 5));

export function bundle(...commands) {
  return Uint8Array.from(commands.flatMap(command => [...u16(command.length), ...command]));
}

export function syntheticSetup() {
  return Uint8Array.from([97, ...u24(center), ...u16(430), ...u16(300), ...u16(217),
    48, ...u16(539), ...u16(40), ...u16(1400), ...u16(33), ...u16(28), ...u16(430),
    19, 42, ...u16(1), ...u24(1000)]);
}

function snake(id, skin, x, y, angle) {
  const name = [...new TextEncoder().encode(`Synthetic ${id}`)];
  const heading = u24(Math.round(angle / (Math.PI * 2) * 16777215));
  return [115, ...u16(id), ...heading, 48, ...heading, ...u16(128), ...u24(0), skin,
    ...absolute(x), ...absolute(y), name.length, ...name, 0, 0,
    ...absolute(x - Math.cos(angle) * 122), ...absolute(y - Math.sin(angle) * 122),
    ...Array.from({ length: 10 }, () => [Math.round(127 + Math.cos(angle) * 16), Math.round(127 + Math.sin(angle) * 16)]).flat(),
    ...u16(Math.round(angle / (Math.PI * 2) * 65536))];
}

export function syntheticScene(skin = 0) {
  const food = [70, 108, 108];
  for (let index = 0; index < 28; index++) {
    food.push(index % 3, 40 + index * 37 % 180, 40 + index * 61 % 180, 20 + index % 4 * 5);
  }
  return bundle(syntheticSetup(), snake(0, skin, 0, 0, 0),
    snake(7, 1, 115, -105, Math.PI / 2), snake(8, 2, -100, 95, Math.PI / 4), food);
}

export function syntheticStep(index) {
  // Absolute self front-anchor update; each step advances 8 units.
  return Uint8Array.from([61, ...u16(0), ...u16(center + 8 * index), ...u16(center)]);
}
