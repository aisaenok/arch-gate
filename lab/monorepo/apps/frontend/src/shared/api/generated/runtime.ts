// @generated from packages/api-contracts/openapi.yaml
import type { ApplicationResponse } from "./models.js";

export async function getApplication(id: string): Promise<ApplicationResponse> {
  const response = await fetch(`/api/applications/${id}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<ApplicationResponse>;
}
