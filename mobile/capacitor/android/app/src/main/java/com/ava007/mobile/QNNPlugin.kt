// Placeholder — QNN (Qualcomm Neural Network) Capacitor plugin
// Bridges TypeScript NPUBridge.ts to native QNN SDK
package com.ava007.mobile

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "QNN")
class QNNPlugin : Plugin() {
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        // TODO: query QNN SDK for Hexagon NPU availability
        call.resolve(mapOf("available" to false))
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val modelPath = call.getString("modelPath") ?: ""
        // TODO: load QNN model from modelPath
        call.reject("QNN.loadModel — not implemented (placeholder)")
    }

    @PluginMethod
    fun infer(call: PluginCall) {
        val input = call.getArray("input") ?: com.getcapacitor.JSArray()
        // TODO: run QNN inference
        call.reject("QNN.infer — not implemented (placeholder)")
    }
}
