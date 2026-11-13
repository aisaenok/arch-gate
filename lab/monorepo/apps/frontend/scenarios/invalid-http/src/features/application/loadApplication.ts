import axios from "axios";

export async function loadApplication(id: string) {
  const response = await axios.get(`/api/applications/${id}`);
  return response.data;
}
