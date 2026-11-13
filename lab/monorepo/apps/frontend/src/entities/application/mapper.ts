import type { ApplicationResponse } from "../../shared/api/generated/models.js";
import type { Application } from "./model.js";

export function mapApplication(response: ApplicationResponse): Application {
  return {
    id: response.id,
    approved: response.status === "APPROVED"
  };
}
