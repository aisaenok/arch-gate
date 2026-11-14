import type { HttpClient } from "../shared/http/HttpClient.js";
import { FetchClient } from "../shared/http/FetchClient.js";

const client: HttpClient = new FetchClient();

export const load = (url: string) =>
  client.get(url);
