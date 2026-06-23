#version 460
#extension GL_KHR_vulkan_glsl : enable

// AMOS v2.7 — Vulkan Compute Shader POC
//
// Minimal 4x4 matrix multiplication. Proves GPU access via Vulkan
// compute shaders WITHOUT any Qualcomm SDK or Knox trip.
//
// This is a proof-of-concept only. Real inference will use llama.cpp's
// ggml-vulkan backend (which has its own optimized compute shaders for
// attention, matmul, etc.).
//
// Compile: glslangValidator -V matmul.glsl -o matmul.comp.spv
// (or let the host code compile at runtime via shaderc)

layout(local_size_x = 4, local_size_y = 4, local_size_z = 1) in;

// Input matrices A and B (4x4 = 16 floats each)
layout(set = 0, binding = 0) readonly buffer MatrixA {
    float a[16];
};

layout(set = 0, binding = 1) readonly buffer MatrixB {
    float b[16];
};

// Output matrix C (4x4 = 16 floats)
layout(set = 0, binding = 2) buffer MatrixC {
    float c[16];
};

void main() {
    // Each invocation computes one element of C
    // gl_GlobalInvocationID.x = column (0..3)
    // gl_GlobalInvocationID.y = row (0..3)
    uint col = gl_GlobalInvocationID.x;
    uint row = gl_GlobalInvocationID.y;

    if (col >= 4 || row >= 4) return;

    float sum = 0.0;
    for (uint k = 0; k < 4; k++) {
        // 4x4 matrix stored row-major: index = row * 4 + col
        sum += a[row * 4 + k] * b[k * 4 + col];
    }
    c[row * 4 + col] = sum;
}
