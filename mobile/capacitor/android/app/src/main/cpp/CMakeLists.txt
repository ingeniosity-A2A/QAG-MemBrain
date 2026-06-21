# AMOS v2.1 Mobile Runtime — native C++ build
# Builds qnn_jni + arrow_jni shared libraries from rust/ outputs

cmake_minimum_required(VERSION 3.22.1)
project(ava007_amos_native)

# QNN SDK path (set via -DQNN_SDK_DIR=...)
# ${QNN_SDK_DIR}/lib/aarch64-android/libQnnNetRun.so

# Arrow C Data Interface (vendored or system)
# ${ARROW_SDK_DIR}/lib/libarrow_cdata.so

# Native libs are built from rust/ via cargo-ndk; this CMakeLists wraps
# the JNI shims that call into the Rust crates.

# Placeholder — actual build setup pending Rust crate implementation.
