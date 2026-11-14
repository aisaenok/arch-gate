import { get } from "../shared/http/client.js";

export const load = (urls: string[]) =>
  Promise.all(urls.map((url) => get(url)));
