export type AcceleratorType = "CPU" | "GPU" | "NPU" | "QPU";

export interface AcceleratorTask<TInput = unknown, TOutput = unknown> {
  id: string;
  type: AcceleratorType;
  input: TInput;
}

export interface AcceleratorFabric {
  execute<TInput, TOutput>(task: AcceleratorTask<TInput, TOutput>): Promise<TOutput>;
}
