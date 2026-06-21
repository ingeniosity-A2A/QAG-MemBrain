// Placeholder — Apache Arrow zero-copy bridge
// Uses Arrow C Data Interface for zero-copy data exchange with rust/arrow-bridge
package com.ava007.mobile

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "ArrowBridge")
class ArrowBridge : Plugin() {
    @PluginMethod
    fun importRecordBatch(call: PluginCall) {
        // TODO: import Arrow RecordBatch via C Data Interface
        call.reject("ArrowBridge.importRecordBatch — not implemented (placeholder)")
    }

    @PluginMethod
    fun exportRecordBatch(call: PluginCall) {
        // TODO: export Arrow RecordBatch to JS
        call.reject("ArrowBridge.exportRecordBatch — not implemented (placeholder)")
    }
}
