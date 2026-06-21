// Placeholder — QNN JNI shim
// Calls into rust/qnn-bridge crate via libqnn_jni.so
#include <jni.h>
#include <android/log.h>

extern "C" JNIEXPORT jboolean JNICALL
Java_com_ava007_mobile_QNNPlugin_nativeIsAvailable(JNIEnv* env, jobject thiz) {
    // TODO: delegate to rust/qnn-bridge
    return JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_ava007_mobile_QNNPlugin_nativeLoadModel(JNIEnv* env, jobject thiz, jstring model_path) {
    // TODO: delegate to rust/qnn-bridge
}

extern "C" JNIEXPORT jfloatArray JNICALL
Java_com_ava007_mobile_QNNPlugin_nativeInfer(JNIEnv* env, jobject thiz, jfloatArray input) {
    // TODO: delegate to rust/qnn-bridge
    return env->NewFloatArray(0);
}
