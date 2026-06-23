/**
 * AMOS v2.7 — Vulkan Compute Shader POC Host Code
 *
 * Proves GPU access via Vulkan compute shaders WITHOUT any Qualcomm SDK
 * or Knox trip. Standard Android Vulkan API (API 24+).
 *
 * This POC:
 *   1. Initializes Vulkan
 *   2. Finds a GPU with compute support (Adreno on S25 Ultra)
 *   3. Creates a compute pipeline from a SPIR-V shader (matmul.comp.spv)
 *   4. Allocates 3 buffers (matrix A, matrix B, output C)
 *   5. Dispatches a 4x4 matmul compute shader
 *   6. Reads back the result and verifies against CPU reference
 *
 * Build (NDK):
 *   $NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang++ \
 *     -std=c++17 -fPIC -shared -o libvulkan_matmul.so matmul.cpp \
 *     -lvulkan -llog
 *
 * Run:
 *   Load via JNI from Kotlin (QNNPlugin.kt pattern) or run from a native
 *   Activity binary directly.
 *
 * Real inference will use llama.cpp's ggml-vulkan backend (which has its
 * own optimized compute shaders for attention, matmul, etc.). This POC
 * is the smallest possible proof that the SDK-free path works.
 */

#include <vulkan/vulkan.h>
#include <android/log.h>
#include <vector>
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdlib>

#define LOG_TAG "amos-vulkan-poc"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// SPIR-V shader bytecode for matmul.comp.
// In production, this is loaded from assets or compiled at build time via shaderc.
// For the POC, we expect it to be loaded from a file or embedded as a header.
// Placeholder: real SPIR-V bytes would go here.
// Compile from matmul.glsl:
//   glslangValidator -V matmul.glsl -o matmul.comp.spv
// Then either:
//   (a) embed via xxd -i matmul.comp.spv > matmul_spv.h
//   (b) load from Android assets at runtime
static std::vector<uint32_t> loadShaderSpv(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) {
        LOGE("Failed to open shader: %s", path);
        return {};
    }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    std::vector<uint32_t> spv(size / sizeof(uint32_t));
    fread(spv.data(), 1, size, f);
    fclose(f);
    LOGI("Loaded SPIR-V shader: %s (%ld bytes, %zu words)", path, size, spv.size());
    return spv;
}

// Helper macro for Vulkan result checking
#define VK_CHECK(call) \
    do { \
        VkResult _r = (call); \
        if (_r != VK_SUCCESS) { \
            LOGE("Vulkan error %d at %s:%d", _r, __FILE__, __LINE__); \
            return false; \
        } \
    } while (0)

struct VulkanContext {
    VkInstance instance = VK_NULL_HANDLE;
    VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    uint32_t computeQueueFamily = 0;
    VkQueue computeQueue = VK_NULL_HANDLE;
    VkCommandPool commandPool = VK_NULL_HANDLE;
    VkDescriptorSetLayout descriptorSetLayout = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout = VK_NULL_HANDLE;
    VkPipeline pipeline = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet = VK_NULL_HANDLE;
    VkBuffer bufferA = VK_NULL_HANDLE;
    VkBuffer bufferB = VK_NULL_HANDLE;
    VkBuffer bufferC = VK_NULL_HANDLE;
    VkDeviceMemory memoryA = VK_NULL_HANDLE;
    VkDeviceMemory memoryB = VK_NULL_HANDLE;
    VkDeviceMemory memoryC = VK_NULL_HANDLE;
};

static uint32_t findMemoryType(VkPhysicalDevice phys, uint32_t typeBits, VkMemoryPropertyFlags props) {
    VkPhysicalDeviceMemoryProperties memProps;
    vkGetPhysicalDeviceMemoryProperties(phys, &memProps);
    for (uint32_t i = 0; i < memProps.memoryTypeCount; i++) {
        if ((typeBits & (1 << i)) &&
            (memProps.memoryTypes[i].propertyFlags & props) == props) {
            return i;
        }
    }
    return 0xFFFFFFFF;
}

static bool createBuffer(VulkanContext& ctx, VkDeviceSize size, VkBufferUsageFlags usage,
                          VkMemoryPropertyFlags props, VkBuffer& buffer, VkDeviceMemory& memory) {
    VkBufferCreateInfo bufInfo = {};
    bufInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    bufInfo.size = size;
    bufInfo.usage = usage;
    bufInfo.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
    VK_CHECK(vkCreateBuffer(ctx.device, &bufInfo, nullptr, &buffer));

    VkMemoryRequirements memReqs;
    vkGetBufferMemoryRequirements(ctx.device, buffer, &memReqs);

    VkMemoryAllocateInfo allocInfo = {};
    allocInfo.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
    allocInfo.allocationSize = memReqs.size;
    allocInfo.memoryTypeIndex = findMemoryType(ctx.physicalDevice, memReqs.memoryTypeBits, props);
    if (allocInfo.memoryTypeIndex == 0xFFFFFFFF) {
        LOGE("Failed to find memory type");
        return false;
    }
    VK_CHECK(vkAllocateMemory(ctx.device, &allocInfo, nullptr, &memory));
    VK_CHECK(vkBindBufferMemory(ctx.device, buffer, memory, 0));
    return true;
}

/**
 * Run the 4x4 matrix multiplication POC.
 *
 * Returns true if the GPU result matches the CPU reference (within epsilon).
 * Logs detailed progress via Android logcat (tag: amos-vulkan-poc).
 *
 * shaderPath: path to the compiled SPIR-V shader (matmul.comp.spv).
 *             On Android, this would typically be in the app's data directory.
 */
extern "C" bool amos_vulkan_matmul_poc(const char* shaderPath) {
    VulkanContext ctx = {};
    bool success = false;

    LOGI("=== AMOS v2.7 Vulkan Compute Shader POC ===");

    // 1. Create Vulkan instance
    VkInstanceCreateInfo instInfo = {};
    instInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    VkResult r = vkCreateInstance(&instInfo, nullptr, &ctx.instance);
    if (r != VK_SUCCESS) {
        LOGE("vkCreateInstance failed: %d (Vulkan not available on this device?)", r);
        return false;
    }
    LOGI("Vulkan instance created");

    // 2. Pick first physical device (Adreno on S25 Ultra)
    uint32_t gpuCount = 0;
    vkEnumeratePhysicalDevices(ctx.instance, &gpuCount, nullptr);
    if (gpuCount == 0) {
        LOGE("No Vulkan-capable GPUs found");
        goto cleanup;
    }
    std::vector<VkPhysicalDevice> gpus(gpuCount);
    vkEnumeratePhysicalDevices(ctx.instance, &gpuCount, gpus.data());
    ctx.physicalDevice = gpus[0];

    VkPhysicalDeviceProperties devProps;
    vkGetPhysicalDeviceProperties(ctx.physicalDevice, &devProps);
    LOGI("Using GPU: %s (Vulkan %d.%d.%d)", devProps.deviceName,
         VK_VERSION_MAJOR(devProps.apiVersion),
         VK_VERSION_MINOR(devProps.apiVersion),
         VK_VERSION_PATCH(devProps.apiVersion));

    // 3. Find compute queue family
    uint32_t qfCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice, &qfCount, nullptr);
    std::vector<VkQueueFamilyProperties> qfProps(qfCount);
    vkGetPhysicalDeviceQueueFamilyProperties(ctx.physicalDevice, &qfCount, qfProps.data());
    bool found = false;
    for (uint32_t i = 0; i < qfCount; i++) {
        if (qfProps[i].queueFlags & VK_QUEUE_COMPUTE_BIT) {
            ctx.computeQueueFamily = i;
            found = true;
            break;
        }
    }
    if (!found) {
        LOGE("No compute queue family found");
        goto cleanup;
    }
    LOGI("Compute queue family: %u", ctx.computeQueueFamily);

    // 4. Create logical device + queue
    float queuePriority = 1.0f;
    VkDeviceQueueCreateInfo qInfo = {};
    qInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    qInfo.queueFamilyIndex = ctx.computeQueueFamily;
    qInfo.queueCount = 1;
    qInfo.pQueuePriorities = &queuePriority;

    VkDeviceCreateInfo devInfo = {};
    devInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    devInfo.queueCreateInfoCount = 1;
    devInfo.pQueueCreateInfos = &qInfo;
    VK_CHECK(vkCreateDevice(ctx.physicalDevice, &devInfo, nullptr, &ctx.device));
    vkGetDeviceQueue(ctx.device, ctx.computeQueueFamily, 0, &ctx.computeQueue);
    LOGI("Logical device + queue created");

    // 5. Load SPIR-V shader
    auto spv = loadShaderSpv(shaderPath);
    if (spv.empty()) {
        LOGE("SPIR-V shader load failed — compile matmul.glsl first: glslangValidator -V matmul.glsl -o matmul.comp.spv");
        goto cleanup;
    }

    // 6. Create shader module
    VkShaderModuleCreateInfo shaderInfo = {};
    shaderInfo.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    shaderInfo.codeSize = spv.size() * sizeof(uint32_t);
    shaderInfo.pCode = spv.data();
    VkShaderModule shaderModule;
    VK_CHECK(vkCreateShaderModule(ctx.device, &shaderInfo, nullptr, &shaderModule));
    LOGI("Shader module created");

    // 7. Descriptor set layout (3 bindings: A, B, C storage buffers)
    VkDescriptorSetLayoutBinding bindings[3] = {};
    bindings[0].binding = 0;
    bindings[0].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[0].descriptorCount = 1;
    bindings[0].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    bindings[1].binding = 1;
    bindings[1].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[1].descriptorCount = 1;
    bindings[1].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;
    bindings[2].binding = 2;
    bindings[2].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    bindings[2].descriptorCount = 1;
    bindings[2].stageFlags = VK_SHADER_STAGE_COMPUTE_BIT;

    VkDescriptorSetLayoutCreateInfo dslInfo = {};
    dslInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
    dslInfo.bindingCount = 3;
    dslInfo.pBindings = bindings;
    VK_CHECK(vkCreateDescriptorSetLayout(ctx.device, &dslInfo, nullptr, &ctx.descriptorSetLayout));

    VkPipelineLayoutCreateInfo plInfo = {};
    plInfo.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    plInfo.setLayoutCount = 1;
    plInfo.pSetLayouts = &ctx.descriptorSetLayout;
    VK_CHECK(vkCreatePipelineLayout(ctx.device, &plInfo, nullptr, &ctx.pipelineLayout));

    // 8. Compute pipeline
    VkComputePipelineCreateInfo pipeInfo = {};
    pipeInfo.sType = VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO;
    pipeInfo.stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    pipeInfo.stage.stage = VK_SHADER_STAGE_COMPUTE_BIT;
    pipeInfo.stage.module = shaderModule;
    pipeInfo.stage.pName = "main";
    pipeInfo.layout = ctx.pipelineLayout;
    VK_CHECK(vkCreateComputePipelines(ctx.device, VK_NULL_HANDLE, 1, &pipeInfo, nullptr, &ctx.pipeline));
    LOGI("Compute pipeline created");

    // 9. Create buffers (4x4 = 16 floats each = 64 bytes)
    VkDeviceSize bufSize = 16 * sizeof(float);
    if (!createBuffer(ctx, bufSize,
                       VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                       VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                       ctx.bufferA, ctx.memoryA)) goto cleanup;
    if (!createBuffer(ctx, bufSize,
                       VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
                       VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                       ctx.bufferB, ctx.memoryB)) goto cleanup;
    if (!createBuffer(ctx, bufSize,
                       VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
                       VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                       ctx.bufferC, ctx.memoryC)) goto cleanup;
    LOGI("Buffers created (3 x 64 bytes)");

    // 10. Fill input matrices A and B
    float* pDataA;
    float* pDataB;
    vkMapMemory(ctx.device, ctx.memoryA, 0, bufSize, 0, (void**)&pDataA);
    vkMapMemory(ctx.device, ctx.memoryB, 0, bufSize, 0, (void**)&pDataB);
    // A = identity * 2, B = identity * 3, so C should = identity * 6
    for (int i = 0; i < 16; i++) {
        pDataA[i] = (i % 5 == 0) ? 2.0f : 0.0f;  // 2 * I
        pDataB[i] = (i % 5 == 0) ? 3.0f : 0.0f;  // 3 * I
    }
    vkUnmapMemory(ctx.device, ctx.memoryA);
    vkUnmapMemory(ctx.device, ctx.memoryB);
    LOGI("Input matrices filled (A = 2*I, B = 3*I)");

    // 11. Descriptor pool + set
    VkDescriptorPoolSize poolSize = {};
    poolSize.type = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    poolSize.descriptorCount = 3;
    VkDescriptorPoolCreateInfo dpInfo = {};
    dpInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    dpInfo.maxSets = 1;
    dpInfo.poolSizeCount = 1;
    dpInfo.pPoolSizes = &poolSize;
    VK_CHECK(vkCreateDescriptorPool(ctx.device, &dpInfo, nullptr, &ctx.descriptorPool));

    VkDescriptorSetAllocateInfo dsInfo = {};
    dsInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
    dsInfo.descriptorPool = ctx.descriptorPool;
    dsInfo.descriptorSetCount = 1;
    dsInfo.pSetLayouts = &ctx.descriptorSetLayout;
    VK_CHECK(vkAllocateDescriptorSets(ctx.device, &dsInfo, &ctx.descriptorSet));

    VkDescriptorBufferInfo bufInfoA = { ctx.bufferA, 0, VK_WHOLE_SIZE };
    VkDescriptorBufferInfo bufInfoB = { ctx.bufferB, 0, VK_WHOLE_SIZE };
    VkDescriptorBufferInfo bufInfoC = { ctx.bufferC, 0, VK_WHOLE_SIZE };
    VkWriteDescriptorSet writes[3] = {};
    for (int i = 0; i < 3; i++) {
        writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        writes[i].dstSet = ctx.descriptorSet;
        writes[i].dstBinding = i;
        writes[i].descriptorCount = 1;
        writes[i].descriptorType = VK_DESCRIPTOR_TYPE_STORAGE_BUFFER;
    }
    writes[0].pBufferInfo = &bufInfoA;
    writes[1].pBufferInfo = &bufInfoB;
    writes[2].pBufferInfo = &bufInfoC;
    vkUpdateDescriptorSets(ctx.device, 3, writes, 0, nullptr);

    // 12. Command pool + buffer
    VkCommandPoolCreateInfo cpInfo = {};
    cpInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    cpInfo.queueFamilyIndex = ctx.computeQueueFamily;
    VK_CHECK(vkCreateCommandPool(ctx.device, &cpInfo, nullptr, &ctx.commandPool));

    VkCommandBufferAllocateInfo cbInfo = {};
    cbInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    cbInfo.commandPool = ctx.commandPool;
    cbInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    cbInfo.commandBufferCount = 1;
    VkCommandBuffer cmdBuf;
    VK_CHECK(vkAllocateCommandBuffers(ctx.device, &cbInfo, &cmdBuf));

    VkCommandBufferBeginInfo beginInfo = {};
    beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    VK_CHECK(vkBeginCommandBuffer(cmdBuf, &beginInfo));

    vkCmdBindPipeline(cmdBuf, VK_PIPELINE_BIND_POINT_COMPUTE, ctx.pipeline);
    vkCmdBindDescriptorSets(cmdBuf, VK_PIPELINE_BIND_POINT_COMPUTE, ctx.pipelineLayout,
                            0, 1, &ctx.descriptorSet, 0, nullptr);
    // 4x4 matrix, 4x4 workgroup = 1 dispatch
    vkCmdDispatch(cmdBuf, 1, 1, 1);
    VK_CHECK(vkEndCommandBuffer(cmdBuf));

    // 13. Submit + wait
    VkSubmitInfo submitInfo = {};
    submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submitInfo.commandBufferCount = 1;
    submitInfo.pCommandBuffers = &cmdBuf;
    VK_CHECK(vkQueueSubmit(ctx.computeQueue, 1, &submitInfo, VK_NULL_HANDLE));
    VK_CHECK(vkQueueWaitIdle(ctx.computeQueue));
    LOGI("Compute shader dispatched + completed");

    // 14. Read back result
    float* pDataC;
    vkMapMemory(ctx.device, ctx.memoryC, 0, bufSize, 0, (void**)&pDataC);
    LOGI("Result matrix C (expected = 6 * I):");
    bool match = true;
    for (int row = 0; row < 4; row++) {
        LOGI("  [%6.2f %6.2f %6.2f %6.2f]",
             pDataC[row*4+0], pDataC[row*4+1], pDataC[row*4+2], pDataC[row*4+3]);
        for (int col = 0; col < 4; col++) {
            float expected = (row == col) ? 6.0f : 0.0f;
            if (std::abs(pDataC[row*4+col] - expected) > 0.001f) {
                match = false;
            }
        }
    }
    vkUnmapMemory(ctx.device, ctx.memoryC);

    if (match) {
        LOGI("✓ POC SUCCESS: GPU result matches CPU reference");
        success = true;
    } else {
        LOGE("✗ POC FAILED: GPU result does not match CPU reference");
    }

    vkDestroyShaderModule(ctx.device, shaderModule, nullptr);

cleanup:
    if (ctx.commandPool) vkDestroyCommandPool(ctx.device, ctx.commandPool, nullptr);
    if (ctx.descriptorPool) vkDestroyDescriptorPool(ctx.device, ctx.descriptorPool, nullptr);
    if (ctx.pipeline) vkDestroyPipeline(ctx.device, ctx.pipeline, nullptr);
    if (ctx.pipelineLayout) vkDestroyPipelineLayout(ctx.device, ctx.pipelineLayout, nullptr);
    if (ctx.descriptorSetLayout) vkDestroyDescriptorSetLayout(ctx.device, ctx.descriptorSetLayout, nullptr);
    if (ctx.bufferA) vkDestroyBuffer(ctx.device, ctx.bufferA, nullptr);
    if (ctx.bufferB) vkDestroyBuffer(ctx.device, ctx.bufferB, nullptr);
    if (ctx.bufferC) vkDestroyBuffer(ctx.device, ctx.bufferC, nullptr);
    if (ctx.memoryA) vkFreeMemory(ctx.device, ctx.memoryA, nullptr);
    if (ctx.memoryB) vkFreeMemory(ctx.device, ctx.memoryB, nullptr);
    if (ctx.memoryC) vkFreeMemory(ctx.device, ctx.memoryC, nullptr);
    if (ctx.device) vkDestroyDevice(ctx.device, nullptr);
    if (ctx.instance) vkDestroyInstance(ctx.instance, nullptr);

    return success;
}
