/// <reference types="node" />

// ---------------------------------------------------------------------------
// Ava · Nemotron ASR Streaming client
// ---------------------------------------------------------------------------
// Connects to a locally-running NVIDIA NIM for streaming speech-to-text.
//
// Start the NIM container before using this module:
//
//   export NGC_API_KEY=<your-ngc-api-key>
//
//   docker run -it --rm --name=nemotron-asr-streaming \
//     --runtime=nvidia \
//     --gpus '"device=0"' \
//     --shm-size=8GB \
//     -e NGC_API_KEY \
//     -e NIM_HTTP_API_PORT=9000 \
//     -e NIM_GRPC_API_PORT=50051 \
//     -p 9000:9000 \
//     -p 50051:50051 \
//     -e NIM_TAGS_SELECTOR=mode=str \
//     nvcr.io/nim/nvidia/nemotron-asr-streaming:latest
//
// Required env vars:
//   NGC_API_KEY          — NVIDIA NGC / NIM API key
//   ASR_HTTP_URL         — (optional) override HTTP base, default http://localhost:9000
// ---------------------------------------------------------------------------

const NGC_API_KEY = process.env.NGC_API_KEY;
const ASR_HTTP_URL = process.env.ASR_HTTP_URL ?? "http://localhost:9000";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ASROptions = {
  /** Audio content as a Buffer or base-64 encoded string. */
  audio: Buffer | string;
  /** MIME type of the audio payload, e.g. "audio/wav" or "audio/webm". */
  mimeType?: string;
  /** BCP-47 language code, e.g. "en-US". */
  language?: string;
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
};

export type ASRResponse = {
  transcript: string;
  /** Raw response body from the NIM service. */
  raw?: unknown;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(audio: Buffer | string): string {
  if (typeof audio === "string") return audio; // assume already base-64
  return audio.toString("base64");
}

// ---------------------------------------------------------------------------
// transcribe — send audio to the Nemotron ASR NIM and return transcript
// ---------------------------------------------------------------------------

export async function transcribe(options: ASROptions): Promise<ASRResponse> {
  if (!NGC_API_KEY) {
    throw new Error("NGC_API_KEY is required to use Nemotron ASR (see core/ai/audio.ts)");
  }

  const { audio, mimeType = "audio/wav", language = "en-US", signal } = options;

  const endpoint = `${ASR_HTTP_URL}/v1/audio/transcriptions`;

  // The NIM exposes an OpenAI-compatible /v1/audio/transcriptions endpoint.
  // Payload is multipart/form-data: file field + optional model / language.
  const formData = new FormData();
  const audioBase64 = toBase64(audio);
  // Convert base-64 back to binary blob for the multipart field
  const binaryBuffer = Buffer.from(audioBase64, "base64");
  const blob = new Blob([binaryBuffer], { type: mimeType });
  formData.append("file", blob, "audio.wav");
  formData.append("model", "nvidia/nemotron-asr-streaming");
  formData.append("language", language);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NGC_API_KEY}`,
    },
    body: formData,
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Nemotron ASR error ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { text?: string; transcript?: string };
  const transcript = json.text ?? json.transcript ?? "";

  return { transcript, raw: json };
}
