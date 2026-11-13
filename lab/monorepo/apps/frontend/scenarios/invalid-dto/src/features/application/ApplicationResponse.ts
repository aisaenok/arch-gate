// Intentionally wrong: this wire DTO is already owned by api-contracts.
export interface ApplicationResponse {
  id: string;
  status: "DRAFT" | "APPROVED";
}
