export interface LoRaPacket { nodeId: string; rssi: number; snr: number; payload: string; ts: string; }
export type LoRaCallback = (packet: LoRaPacket) => void;

export class LoRaBridge {
  private port: any = null;
  private callback: LoRaCallback | null = null;
  private mockInterval: ReturnType<typeof setInterval> | null = null;
  private mockMode: boolean = true;

  constructor(private serialPath: string = '/dev/ttyUSB0', private baudRate: number = 115200) {}

  async open(): Promise<void> {
    const fs = await import('fs');
    if (!fs.existsSync(this.serialPath)) { this.mockMode = true; this._startMock(); return; }
    try {
      const { SerialPort } = await import('serialport');
      const { ReadlineParser } = await import('@serialport/parser-readline');
      this.port = new SerialPort({ path: this.serialPath, baudRate: this.baudRate });
      await new Promise<void>((resolve, reject) => {
        this.port!.on('open', () => resolve());
        this.port!.on('error', (err: Error) => reject(err));
      });
      const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line: string) => this._handleLine(line));
      this.mockMode = false;
    } catch { this.port = null; this.mockMode = true; this._startMock(); }
  }

  onPacket(cb: LoRaCallback): void { this.callback = cb; }

  async send(nodeId: string, payload: string): Promise<void> {
    if (this.mockMode) {
      this._emitPacket({ nodeId, rssi: -45 + Math.floor(Math.random() * 20), snr: 7 + Math.random() * 4, payload: `ACK:${payload}`, ts: new Date().toISOString() });
    } else if (this.port) { this.port.write(JSON.stringify({ target: nodeId, payload }) + '\n'); }
  }

  close(): void {
    if (this.mockInterval) { clearInterval(this.mockInterval); this.mockInterval = null; }
    if (this.port) { this.port.close(); this.port = null; }
  }

  get isMockMode(): boolean { return this.mockMode; }

  private _handleLine(line: string): void {
    try {
      const data = JSON.parse(line.trim());
      this._emitPacket({ nodeId: data.nodeId || 'unknown', rssi: data.rssi ?? -70, snr: data.snr ?? 5, payload: data.payload || '', ts: data.ts || new Date().toISOString() });
    } catch {}
  }

  private _emitPacket(packet: LoRaPacket): void { if (this.callback) this.callback(packet); }

  private _startMock(): void {
    let counter = 0;
    this.mockInterval = setInterval(() => {
      counter++;
      this._emitPacket({ nodeId: `esp32-node-${(counter % 5) + 1}`, rssi: -40 - Math.floor(Math.random() * 40), snr: 5 + Math.random() * 7, payload: `mock-packet-${counter}`, ts: new Date().toISOString() });
    }, 5000);
  }
}
