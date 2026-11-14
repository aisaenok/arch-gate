import type { HttpClient } from "./HttpClient.js";

export class FetchClient implements HttpClient {
  async get(url: string) {
    const response = await fetch(url);
    return response.json();
  }
}
