import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

export interface LoRaPacket {
  type: "lora_packet";
  timestamp: number;
  rssi: number;
  snr: number;
  payload: string;
}

export class LoRaBridge extends EventEmitter {
  attach(input: Readable): void {
    const lines = createInterface({ input });
    lines.on("line", (line) => {
      const packet = JSON.parse(line) as LoRaPacket;
      this.emit("packet", packet);
    });
  }
}
