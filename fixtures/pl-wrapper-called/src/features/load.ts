import { get } from "../shared/http/client.js";

export const load = (id: string) =>
  get(`/api/applications/${id}`);
