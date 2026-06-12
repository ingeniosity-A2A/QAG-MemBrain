import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface EdgeCustomer {
  id: string;
  did: string;
  displayName: string;
  metadata: Record<string, unknown>;
}

export class EdgeCustomerVault {
  constructor(private readonly filePath = "./data/customers.edge.jsonl") {}

  async add(customer: EdgeCustomer): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(customer)}\n`, "utf8");
  }

  async all(): Promise<EdgeCustomer[]> {
    const content = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as EdgeCustomer);
  }
}
