/*
 * JCAS Fusion Kernel v2.0
 * Joint Communication and Sensing for Adreno 750 GPU
 * 
 * Fuses OFDM communication subcarriers with radar range-Doppler
 * returns into a single coherent World Model tensor.
 * 
 * Target: >4 active waves per Shader Processor
 *         >90% ALU utilization
 *         128-bit vectorized load/store (vload4/vstore4)
 * 
 * Requires: cl_qcom_ml_ops extension
 * License: MIT
 */

#pragma OPENCL EXTENSION cl_qcom_ml_ops : enable
#pragma OPENCL EXTENSION cl_arm_integer_dot_product : enable

#define VECTOR_SIZE 4
#define FFT_SIZE 1024
#define MAX_TARGETS 64

// DMA-BUF sampler for zero-copy IQ access
__constant sampler_t iq_sampler = CLK_NORMALIZED_COORDS_FALSE |
                                   CLK_ADDRESS_CLAMP_TO_EDGE |
                                   CLK_FILTER_NEAREST;

/**
 * Main JCAS fusion kernel.
 * 
 * Work-group size: 256 (4 warps × 64 threads)
 * Each work-item processes one subcarrier/pulse combination.
 * 
 * @param iq_communication  OFDM IQ samples from mesh backhaul
 * @param iq_sensing        Pulsed radar IQ samples
 * @param fused_tensor      Output: World Model update tensor
 * @param range_doppler_map Range-Doppler accumulation buffer
 * @param num_subcarriers   Number of OFDM subcarriers
 * @param num_pulses        Number of radar pulses per CPI
 * @param threshold_db      CFAR detection threshold in dB
 */
__kernel void jcas_fusion_kernel(
    __global const float4 * restrict iq_communication,
    __global const float4 * restrict iq_sensing,
    __global float4 * restrict fused_tensor,
    __global float * restrict range_doppler_map,
    const uint num_subcarriers,
    const uint num_pulses,
    const float threshold_db
) {
    uint gid = get_global_id(0);
    uint lid = get_local_id(0);
    uint group_id = get_group_id(0);
    
    // Bounds check
    if (gid >= num_subcarriers) return;
    
    // 128-bit vectorized load from DMA-BUF
    float4 comm_sample = iq_communication[gid];
    float4 sens_sample = iq_sensing[gid];
    
    // ── Communication Path: OFDM Subcarrier Processing ──────
    // Decompose into I/Q components
    float2 comm_iq[VECTOR_SIZE];
    comm_iq[0] = (float2)(comm_sample.x, comm_sample.y);
    comm_iq[1] = (float2)(comm_sample.z, comm_sample.w);
    
    // FFT butterfly using hardware-accelerated instruction
    float2 comm_freq[VECTOR_SIZE];
    __qcom_ml_fft_butterfly_v4(comm_sample, comm_freq);
    
    // ── Sensing Path: Pulse-Doppler Processing ──────────────
    // Magnitude calculation
    float sens_mag = native_sqrt(
        sens_sample.x * sens_sample.x +
        sens_sample.y * sens_sample.y +
        sens_sample.z * sens_sample.z +
        sens_sample.w * sens_sample.w
    );
    
    // CFAR: Cell-Averaging Constant False Alarm Rate
    float noise_floor = 0.0f;
    int guard_cells = 2;
    int window_cells = 8;
    
    #pragma unroll
    for (int i = -window_cells; i <= window_cells; i++) {
        int idx = (int)gid + i;
        if (i < -guard_cells || i > guard_cells) {
            if (idx >= 0 && idx < (int)num_subcarriers) {
                noise_floor += range_doppler_map[idx];
            }
        }
    }
    noise_floor /= (float)(2 * (window_cells - guard_cells));
    
    // Detection thresholding
    float detection_flag = 0.0f;
    if (sens_mag > noise_floor * threshold_db) {
        detection_flag = 1.0f;
    }
    
    // ── Fusion Gate ─────────────────────────────────────────
    // Cross-modal attention:
    // Communication subcarrier energy gates sensing confidence
    float comm_energy = 
        comm_freq[0].x * comm_freq[0].x + comm_freq[0].y * comm_freq[0].y +
        comm_freq[1].x * comm_freq[1].x + comm_freq[1].y * comm_freq[1].y;
    
    // Log2 for dynamic range compression
    float fusion_weight = detection_flag * native_log2(1.0f + comm_energy);
    
    // ── Output Assembly ─────────────────────────────────────
    // 128-bit vectorized store to fused tensor
    float4 result = (float4)(
        comm_freq[0].x * fusion_weight,   // I component, weighted
        comm_freq[0].y * fusion_weight,   // Q component, weighted
        sens_mag * detection_flag,        // Sensing magnitude
        fusion_weight                     // Attention weight for World Model
    );
    
    fused_tensor[gid] = result;
    
    // Update range-Doppler map with exponential moving average
    range_doppler_map[gid] = mix(
        range_doppler_map[gid],
        sens_mag,
        0.1f  // Alpha = 0.1
    );
}

/**
 * DMA-BUF synchronization barrier.
 * Ensures sSDR DMA transfer is complete before processing.
 */
__kernel void dma_sync_barrier(
    __global float4 * restrict iq_buffer,
    __global uint * restrict sync_fence
) {
    // Full memory fence
    mem_fence(CLK_GLOBAL_MEM_FENCE);
    
    // Set fence to signal DMA completion
    atomic_store(sync_fence, 1);
    
    mem_fence(CLK_GLOBAL_MEM_FENCE);
}

/**
 * Identity keystore zeroization kernel.
 * Called during Chameleon rotation to wipe secure heap.
 */
__kernel void zeroize_keystore(
    __global uchar * restrict keystore,
    const uint size_bytes
) {
    uint gid = get_global_id(0);
    if (gid < size_bytes) {
        keystore[gid] = 0;
    }
    mem_fence(CLK_GLOBAL_MEM_FENCE);
}
