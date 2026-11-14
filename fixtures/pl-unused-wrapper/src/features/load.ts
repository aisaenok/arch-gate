import { get } from "../shared/http/client.js";

export const load = (id: string) => ({
  id,
  load: get
});
