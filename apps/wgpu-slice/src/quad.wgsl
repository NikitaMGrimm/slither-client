struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) alpha: f32,
};
@vertex fn vs(@location(0) pos: vec2<f32>, @location(1) uv: vec2<f32>, @location(2) alpha: f32) -> VertexOut {
    var out: VertexOut;
    out.position = vec4<f32>(pos, 0., 1.);
    out.uv = uv;
    out.alpha = alpha;
    return out;
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@fragment fn fs(v: VertexOut) -> @location(0) vec4<f32> {
    return textureSample(source, source_sampler, v.uv) * v.alpha;
}
