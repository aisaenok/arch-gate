import { formatApplicationId } from "../shared/http/client.js";

export const load = (id: string) =>
  formatApplicationId(id);
