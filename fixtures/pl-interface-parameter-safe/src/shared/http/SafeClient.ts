import type { HttpClient } from "./HttpClient.js";

export class SafeClient implements HttpClient {
  async get(url: string) {
    return { url };
  }
}
