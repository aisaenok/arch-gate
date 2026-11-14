import axios from "axios";

const client = axios.create();
const get = client.get;

export async function getApplication(id: string) {
  return get(`/api/applications/${id}`);
}
