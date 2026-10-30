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

@fragment fn fs_black(v: VertexOut) -> @location(0) vec4<f32> {
    let alpha = textureSample(source, source_sampler, v.uv).a * v.alpha;
    if alpha == 0. { return vec4<f32>(0.); }
    // The Canvas reference truncates each black layer on the 8-bit destination.
    // Reverse-subtract a near-half-byte bias to counter hardware nearest rounding.
    // The 255/256 factor matches its integer attenuation on dark backgrounds;
    // this is not a general replacement for colored-image source-over.
    let bias = (0.5 - 1. / 512.) / 255.;
    return vec4<f32>(vec3<f32>(bias), alpha * (255. / 256.));
}
