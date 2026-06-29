export interface LoRaPacket {
  nodeId: string;
  rssi: number;
  snr: number;
  payload: any;
}

export class LoRaBridge {
  isActive: boolean;
  isMockMode: boolean;

  constructor(
    serialPort: string,
    baudRate: number,
    isMock: boolean = false
  ) {
    this.isActive = false;
    this.isMockMode = isMock;
  }

  async open(): Promise<void> {
    this.isActive = true;
  }

  async stop(): Promise<void> {
    this.isActive = false;
  }

  async attach(callback: (data: any) => void): Promise<void> {
    // This would normally read from serial port
    // For now, it's a placeholder
  }

  async start(): Promise<void> {
    this.isActive = true;
  }

  onPacket(callback: (packet: LoRaPacket) => void): void {
    // This would normally read from serial port
    // For now, it's a placeholder
  }

  async close(): Promise<void> {
    this.isActive = false;
  }
}
