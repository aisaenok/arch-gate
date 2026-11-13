import { getApplication } from "../../shared/api/generated/runtime.js";

export const loadApplication = (id: string) => getApplication(id);
