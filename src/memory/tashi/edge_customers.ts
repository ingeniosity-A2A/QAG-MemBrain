import { appendAtom, readAtoms } from "./atomic_memory.js";
import { assertCanWrite } from "../../contract/enforcement.js";
import { AtomicMemory } from "../../shared/types.js";

export interface EdgeCustomer {
  id: string;
  did: string;
  name: string;
  preferredTech?: string;
  lastContact?: string;
  edgeOnly: true;
}

export class EdgeCustomerStore {
  private customers: Map<string, EdgeCustomer> = new Map();

  constructor(private memoryPath: string = "./data/customers.edge.jsonl") {
    void this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    for await (const atom of readAtoms(this.memoryPath)) {
      if (atom.type === "memory" && atom.metadata.edge_only === true) {
        try {
          const cust = JSON.parse(atom.content) as EdgeCustomer;
          this.customers.set(cust.id, cust);
        } catch {
          // ignore malformed legacy records
        }
      }
    }
  }

  async addCustomer(cust: EdgeCustomer, layer: string): Promise<void> {
    assertCanWrite(layer);
    this.customers.set(cust.id, cust);
    const atom: AtomicMemory = {
      id: `cust_${cust.id}`,
      type: "memory",
      source: "system",
      timestamp: Date.now(),
      title: `Customer: ${cust.name}`,
      content: JSON.stringify(cust),
      tags: ["customer", "edge_only"],
      embedding: null,
      metadata: {
        confidence: 1,
        importance: "high",
        customer_did: cust.did,
        edge_only: true,
        risk_level: "low",
      },
    };
    await appendAtom(atom, this.memoryPath);
  }

  getCustomer(did: string): EdgeCustomer | undefined {
    for (const customer of this.customers.values()) {
      if (customer.did === did) return customer;
    }
    return undefined;
  }

  listCustomers(): EdgeCustomer[] {
    return [...this.customers.values()];
  }
}
