export function meshResolution(width) {
  return width <= 512 ? { columns: 96, rows: 144 } : { columns: 160, rows: 240 };
}

export function buildDepthMesh({ data, width, height }, columns, rows) {
  if ((columns + 1) * (rows + 1) > 65536) throw new RangeError('Depth mesh exceeds WebGL 1 index capacity');
  const vertices = new Float32Array((columns + 1) * (rows + 1) * 5);
  const indices = new Uint16Array(columns * rows * 6);
  let vertex = 0, index = 0;
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    const u = x / columns, v = y / rows;
    const dx = Math.round(u * (width - 1)), dy = Math.round(v * (height - 1));
    vertices.set([u * 2 - 1, 1 - v * 2, u, v, data[(dy * width + dx) * 4] / 255], vertex);
    vertex += 5;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const i = y * (columns + 1) + x;
    indices.set([i, i + 1, i + columns + 1, i + 1, i + columns + 2, i + columns + 1], index);
    index += 6;
  }
  return { vertices, indices };
}
