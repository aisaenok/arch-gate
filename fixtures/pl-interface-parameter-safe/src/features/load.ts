import type { HttpClient } from "../shared/http/HttpClient.js";

export const load = (
  client: HttpClient,
  url: string
) => client.get(url);
