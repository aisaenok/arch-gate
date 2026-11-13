import { mapApplication } from "../../entities/application/mapper.js";
import { getApplication } from "../../shared/api/generated/runtime.js";

export async function loadApplication(id: string) {
  return mapApplication(await getApplication(id));
}
